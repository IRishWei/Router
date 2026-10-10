import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, lastAssistantStreamChunk, createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { descriptors, quoteSchema, budgetSchema, extensionSchema, acceptancePolicySchema, coordinationPolicySchema, takeoverPolicySchema, recoveryPolicySchema, recoveryActionSchema } from './protocol.mjs';
import { ledgerOf, reserveRecord, costOf, tokensOf, emptyBudget, budgetCheck, possiblyDispatched, normalizeBudgetConstraint } from './ledger.mjs';
import { ConnectionRegistry, identityOf, sameIdentity, sameRoute } from './connections.mjs';
import { isChatGptSubscription } from './subscription-reference.mjs';
import { runInitialAssessment, selectInitialRoute } from './routing.mjs';
import { AcceptanceCoordinator } from './acceptance.mjs';
import { createNodeProgramChecks } from './program-checks.mjs';
import { DeepSeekHost } from './deepseek-host.mjs';
import { ChatGptHost } from './chatgpt-host.mjs';
import { OpenCodeGoHost } from './opencode-go-host.mjs';
import { CompatibleHost } from './compatible-host.mjs';
import { mountChatGptRouterConnection } from './chatgpt-router.mjs';
import { scheduleDeepSeekDeadline } from './deepseek-deadline.mjs';
import { createHttpSourceEvidenceResolver, createResearchAcceptance } from './research-acceptance.mjs';
import { createImageAcceptance, validateImageContribution } from './image-acceptance.mjs';
import { validateResearchContribution } from './research-contribution.mjs';
import { coordinationSchema, recoverPendingCoordination, TaskCoordinationController } from './coordination.mjs';
import { TaskTakeoverController, takeoverSchema, recordTakeoverStage, recoverPendingTakeover, takeoverReason } from './takeover.mjs';
import { defaultRecoveryPolicy, RECOVERY_LIMITS, failureFacts, classifyFailure, recoveryForecast, recoverPendingRecovery } from './recovery.mjs';

export const inject = ['llm', 'profileContext', 'tools', 'sessionController'];
export const CONTROLLED_PROVIDER = 'router-controlled';
export const CONTROLLED_MODEL = 'controlled';
const GO_PROBE_SYSTEM_PROMPT = 'This is a connection probe. Follow the user reply instruction without using tools.';
export const CONTROLLED_TOOLS_MODEL = 'controlled-tools';
const catalog = [
  { model: CONTROLLED_MODEL, name: 'Controlled fixture', capability: { text: { supported: true, confidence: 'known' }, image: { supported: false, confidence: 'known' }, tools: { supported: true, confidence: 'known' } } },
  { model: CONTROLLED_TOOLS_MODEL, name: 'Controlled tools fixture', capability: { text: { supported: true, confidence: 'known' }, image: { supported: null, confidence: 'unknown' }, tools: { supported: true, confidence: 'declared' } } },
];
const defaultPool = () => catalog.map(model => ({ candidateId: model.model, ...selection({ provider: CONTROLLED_PROVIDER, model: model.model }), enabled: true }));
const ROUTING_OBJECTIVES = new Set(['balanced', 'cost', 'tokens', 'speed', 'quality']);
const MAX_ASSESSMENT_CONTEXT_BYTES = 16_384;
const DEEPSEEK_DETECTION_OUTPUT_TOKENS = 32;
const CHATGPT_DETECTION_OUTPUT_FORECAST_TOKENS = 2_048;
const RESPONSES_DETECTION_MAX_CALLS = 2;
const defaultAcceptancePolicy = () => ({ enabled: false, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
const defaultCoordinationPolicy = () => ({ enabled: false, candidateId: null, allowCrossModel: false, allowFixedModel: false, maxTokens: 256, maxAdviceChars: 4096, forecastTokens: 4096 });
const defaultTakeoverPolicy = () => ({ enabled: false, candidateId: null, allowCrossModel: false, allowFixedModel: false, maxTokens: 512, forecastTokens: 32768 });
const sameChoice = (left, right) => (!left && !right) || Boolean(left && right && sameRoute(left, right) && left.reasoningEffort === right.reasoningEffort);
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manualChanged = (step, current) => !(!current && step.pendingConsumed) && !sameChoice(step.pending, current);
function selection(config = { provider: CONTROLLED_PROVIDER, model: CONTROLLED_MODEL }) {
  const identity = config.provider === CONTROLLED_PROVIDER ? { connectionId: 'controlled-local', accountId: 'local', billingPath: 'controlled' } : { connectionId: `dsh-native:${config.provider}`, accountId: 'unknown', billingPath: 'unknown' };
  return { ...identity, provider: config.provider, model: config.model };
}
function legacyDispatchIsAmbiguous(call) {
  return call.dispatchState === 'header-confirmed' && (!call.dispatchProtocol || (call.dispatchProtocol === 'durable-intent-v1' && call.dispatchIntent === 'blocked'));
}
function recordOwnedChunk(owner, chunk) {
  if (chunk.type === 'usage') owner.usage = chunk.usage;
  if (chunk.type === 'finish') owner.finish = chunk.reason;
}
function contentRequirements(content = []) {
  const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  const contextBytes = new TextEncoder().encode(text).length;
  const requirements = {
    modalities: [...new Set(['text', ...content.some(part => part.type === 'image') ? ['image'] : []])],
    contextBytes,
  };
  if (text.includes('[router:tool]')) requirements.tools = true;
  const assessment = /\[router:assess:(image|tools)\]/u.exec(text)?.[1] ?? null;
  return { requirements, assessment };
}
function mergeTaskRequirements(current, next) {
  const merged = {
    modalities: [...new Set([...(current?.modalities ?? ['text']), ...(next.modalities ?? [])])],
    contextBytes: (current?.contextBytes ?? 0) + (next.contextBytes ?? 0),
  };
  if (current?.tools || next.tools) merged.tools = true;
  return merged;
}
function publicRequirements(task, history = []) {
  const historyModalities = history.some(message => message.content?.some(part => part.type === 'image')) ? ['image'] : [];
  const requirements = { modalities: [...new Set([...(task.requirements?.modalities ?? ['text']), ...historyModalities])] };
  if (task.requirements?.tools) requirements.tools = true;
  const historyBytes = history.reduce((sum, message) => sum + (message.content ?? []).filter(part => part.type === 'text').reduce((total, part) => total + new TextEncoder().encode(part.text).length, 0), 0);
  const contextTokens = historyBytes + (task.requirements?.contextBytes ?? 0);
  if (contextTokens > 8192) requirements.contextTokens = contextTokens;
  return requirements;
}
function assessmentPart(part) {
  if (part?.type === 'text') return { type: 'text', text: part.text };
  if (part?.type === 'image') return { type: 'image', mediaType: part.mediaType ?? null, binary: 'omitted' };
  if (part?.type === 'tool-call') return { type: 'tool-call', name: part.name, arguments: part.arguments };
  return { type: part?.type ?? 'unknown' };
}
function boundedAssessmentInput(requirements, history, inputs, requestedFocus) {
  if (!inputs.length) return { status: 'unavailable', reason: 'ASSESSMENT_CONTEXT_UNAVAILABLE' };
  const payload = {
    schemaVersion: 1,
    requirements,
    requestedFocus,
    recentContext: history.slice(-12).map(message => ({ role: message.role, content: (message.content ?? []).map(assessmentPart) })),
    taskInputs: inputs.map(input => ({ role: 'user', content: input.content.map(assessmentPart) })),
  };
  const text = `ROUTER_INITIAL_ASSESSMENT_V1\n${JSON.stringify(payload)}`;
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_ASSESSMENT_CONTEXT_BYTES) return { status: 'too-large', reason: 'ASSESSMENT_CONTEXT_TOO_LARGE', bytes };
  return { status: 'ready', text, bytes };
}
function assessmentRevision(task) {
  return createHash('sha256').update(JSON.stringify({ requirements: task.requirements, inputs: task.inputs.map(input => input.contentHash) })).digest('hex');
}
function workloadFingerprint(requirements, messages, inputs) {
  const workload = {
    version: 1,
    requirements,
    inputs: inputs.map(input => input.contentHash),
    messages: messages.map(message => ({ role: message.role, content: message.content })),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(workload)).digest('hex')}`;
}
function hasComparableAcceptance(task) {
  const acceptance = task.acceptance;
  return task.lifecycle === 'completed' && task.recovery?.state !== 'paused'
    && !(task.calls ?? []).some(call => ['failed', 'interrupted'].includes(call.status))
    && acceptance?.schemaVersion === 1
    && acceptance.version === 1
    && acceptance.phase === 'checked'
    && acceptance.scope === 'explicit-requirements'
    && acceptance.verdict === 'passed'
    && acceptance.artifact?.complete === true
    && Number.isSafeInteger(acceptance.coverage?.required)
    && acceptance.coverage.required > 0
    && acceptance.coverage.covered === acceptance.coverage.required
    && acceptance.coverage.failedIds?.length === 0
    && acceptance.coverage.uncoveredIds?.length === 0;
}
function routingPauseReason(decision) {
  const reason = decision.reasonCodes[0];
  if (decision.excluded.some(item => item.reasons.includes('CANDIDATE_UNAVAILABLE')) && ['FIXED_CANDIDATE_INELIGIBLE', 'NATIVE_PENDING_INELIGIBLE'].includes(reason)) return 'CONNECTION_REMOVED';
  if (decision.excluded.some(item => item.reasons.some(code => code.startsWith('IMAGE_CAPABILITY_'))) && ['NO_ELIGIBLE_CANDIDATE', 'FIXED_CANDIDATE_INELIGIBLE', 'NATIVE_PENDING_INELIGIBLE'].includes(reason)) return 'NO_COMPATIBLE_IMAGE_CANDIDATE';
  if (reason === 'FIXED_NATIVE_SELECTION_CONFLICT') return 'FIXED_MODEL_CONFLICT';
  if (reason === 'FIXED_CANDIDATE_NOT_IN_SNAPSHOT' || reason === 'FIXED_CANDIDATE_INELIGIBLE') return 'FIXED_MODEL_UNAVAILABLE';
  if (reason === 'NO_ELIGIBLE_CANDIDATE') return 'NO_ENABLED_CANDIDATE';
  return reason;
}
function selectionForecast(requirements, outputTokens = 512) {
  const inputTokens = Math.max(1, requirements.contextTokens ?? 1);
  return { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: inputTokens + outputTokens };
}
function freezeCoordinationPolicy(config, connections) {
  const policy = structuredClone(config.coordination);
  const frozen = { ...policy, objective: config.routingObjective, selectionBasis: null };
  if (!policy.candidateId) return frozen;
  const snapshot = connections.snapshot(config);
  const forecast = selectionForecast({ modalities: ['text'] }, policy.maxTokens);
  const forecastsByCandidate = Object.fromEntries(snapshot.candidates.map(candidate => [candidate.candidateId, forecast]));
  const decision = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot,
    objective: config.routingObjective,
    currentCandidateId: policy.candidateId,
    forecastsByCandidate,
  });
  if (decision.kind !== 'execute') return { ...frozen, candidateId: null };
  if (decision.selected.candidateId !== policy.candidateId) {
    const configuredWasExcluded = decision.excluded?.some(item => item.candidateId === policy.candidateId);
    return configuredWasExcluded ? { ...frozen, candidateId: null } : { ...frozen, selectionBasis: 'objective-mismatch' };
  }
  return { ...frozen, selectionBasis: 'objective-qualified' };
}
function conservativeRequestForecast(messages, tools, outputTokens = DEEPSEEK_DETECTION_OUTPUT_TOKENS, system) {
  const inputTokens = Math.max(1, new TextEncoder().encode(JSON.stringify({ messages, tools: tools ?? [], ...(system === undefined ? {} : { system }) })).length);
  return { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: inputTokens + outputTokens };
}
const detectionOf = task => task?.deepSeekDetection ?? task?.chatGptDetection ?? task?.openCodeGoDetection ?? task?.compatibleDetection ?? null;
function withOutputLimit(request, maxTokens) {
  const descriptors = Object.getOwnPropertyDescriptors(request);
  descriptors.maxTokens = { value: maxTokens, enumerable: true, configurable: true, writable: false };
  return Object.create(Object.getPrototypeOf(request), descriptors);
}
function routingObservations(tasks, candidateSnapshot, comparisonKey) {
  const candidates = new Map(candidateSnapshot.candidates.map(candidate => [candidate.candidateId, candidate]));
  const samples = new Map();
  for (const task of tasks) {
    if (!hasComparableAcceptance(task) || task.routing?.comparisonKey !== comparisonKey) continue;
    for (const call of task.calls ?? []) {
      const candidate = candidates.get(call.candidateId);
      if (!candidate || candidate.provider === CONTROLLED_PROVIDER || candidate.source === 'controlled-protocol-fixture' || call.purpose !== 'execution' || call.status !== 'completed') continue;
      const entry = samples.get(call.candidateId) ?? { totalTokens: [], latencyMs: [] };
      if (Number.isSafeInteger(call.usage?.totalTokens) && call.usage.totalTokens >= 0) entry.totalTokens.push(call.usage.totalTokens);
      if (Number.isFinite(call.elapsedMs) && call.elapsedMs >= 0) entry.latencyMs.push(call.elapsedMs);
      samples.set(call.candidateId, entry);
    }
  }
  return Object.fromEntries([...samples].map(([candidateId, metrics]) => [candidateId, Object.fromEntries(Object.entries(metrics).filter(([_name, values]) => values.length).map(([name, values]) => [name, { value: values.reduce((sum, value) => sum + value, 0) / values.length, sampleCount: values.length, source: 'measured', acceptance: 'passed', coverage: 'comparable' }]))]));
}

/** A local fixture: never reads credentials, opens a socket, or calls a model service. */
class ControlledAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Router · 本地可控模型（无付费请求）' }; }
  async listModels(provider) { return Promise.all(catalog.map(model => this.resolveModel(provider, model.model))); }
  async resolveModel(provider, model) {
    const entry = catalog.find(entry => entry.model === model);
    if (!entry) throw new LlmError('Unknown controlled model', 'MODEL_NOT_FOUND');
    return { provider, id: model, name: entry.name, contextWindow: 32768, maxTokens: 1024, ...(entry.capability.image.confidence === 'known' ? { inputModalities: ['text'] } : {}) };
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    const message = options.messages.findLast(item => item.role === 'user' && (item.source?.kind === 'user' || item.source === undefined));
    const prompt = message?.content.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? '';
    if (prompt.includes('[router:fail]')) throw new LlmError('Controlled connection failure; no provider request was sent', 'CONNECTION');
    if (prompt.startsWith('ROUTER_INITIAL_ASSESSMENT_V1')) {
      let requestedFocus = null;
      try { requestedFocus = JSON.parse(prompt.slice('ROUTER_INITIAL_ASSESSMENT_V1\n'.length)).requestedFocus; } catch { /* invalid fixture input stays insufficient */ }
      const requirement = requestedFocus === 'image' ? { modalities: ['image'] } : requestedFocus === 'tools' ? { tools: true } : null;
      const text = JSON.stringify(requirement ? { evidence: 'sufficient', requirements: requirement } : { evidence: 'insufficient' });
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 16 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    const toolId = `router-${message?.id}`;
    if (prompt.includes('[router:tool]') && !options.messages.some(item => item.role === 'tool' && item.source?.callId === toolId)) {
      if (!options.tools?.some(tool => tool.name === 'router_test_wait')) throw new LlmError('The controlled wait tool is unavailable', 'TOOL_NOT_FOUND');
      const block = { type: 'tool-call', id: toolId, name: 'router_test_wait', arguments: '{}' };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: toolId, name: block.name, argumentsDelta: '{}' };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = prompt.match(/^Reply\s+(.+)$/m)?.[1] ?? 'ROUTER_OK';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

/** Host-owned state and external task observation; native controller remains the route owner. */
export class RouterService extends TypertRemoteService {
  #state;
  #path;
  #files;
  #writes = Promise.resolve();
  #storageError;
  #active = new Map();
  #inflight = new Map();
  #nativeReservations = new WeakMap();
  #nativeConfigs = new WeakMap();
  #steps = new WeakMap();
  #waiters = new Map();
  #callSignals = new Map();
  #unboundAbortDisposers = new Map();
  #dispatchClaims = new WeakSet();
  #requestBindings = new WeakSet();
  #ownedRequests = new WeakMap();
  #ownedCalls = new Map();
  #automaticStreams = new WeakMap();
  #automaticOwners = new WeakMap();
  #publicStreamEntries = new WeakSet();
  #auxiliarySources = new Map();
  #assessmentInputs = new Map();
  #stableRouterSnapshots = new WeakSet();
  #connections;
  #deepSeek;
  #chatGpt;
  #deepSeekDetections = new Map();
  #chatGptDetections = new Map();
  #goDetections = new Map();
  #go;
  #compatible;
  #compatibleDetections = new Map();
  #deepSeekDeadlineTimers = new Map();
  #takeover;
  #recoveryWaiters = new Map();
  constructor(ctx, state, path, connections, files = { writeFile, rename }) {
    super(ctx, 'router');
    this.#state = state;
    this.#path = path;
    this.#files = files;
    this.#connections = connections;
    // Cordis traces service calls through a proxy; bind the public facade to its state owner.
    const methods = descriptors.map(descriptor => descriptor.method);
    for (const method of [...methods, 'flush', 'commitState', 'reserveCall', 'settleCall', 'persistDispatchIntent', 'streamReservedCall', 'streamReservedCallWithRecovery', 'registerOwned', 'captureCandidate', 'exactTask', 'publishAcceptance', 'publishCoordination', 'publishTakeover', 'planTakeover', 'completeTakeover', 'toolReceipt', 'recordToolReceipt', 'toolReceiptsForSession', 'pauseTakeover', 'pauseRecovery', 'attachDeepSeek', 'attachChatGpt']) this[method] = this[method].bind(this);
    this.#takeover = new TaskTakeoverController({ router: this, llm: ctx.llm, attachments: ctx.get('attachments'), tools: ctx.tools, sessionQuery: () => ctx.get('sessionQuery'), turnForAgent: agent => ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')?.lastTurn, manualForAgent: agent => ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending, live: candidateId => ({ automatic: this.#state.config.automatic, fixedCandidateId: this.#state.config.fixedCandidateId, policy: this.#state.config.takeover, capture: candidateId ? this.#connections.capture(candidateId) : null }) });
    ctx.on('tools/change', () => this.#takeover.toolsChanged());
    for (const method of methods) {
      Remote(this[method], { kind: 'method', name: method, static: false, private: false, addInitializer: fn => fn.call(this) });
    }
    ctx.on('session/event', (session, event) => {
      if (event.type === 'model/selection') this.#wakeTakeoverWaiters(session.id);
      if (event.type === 'session/title-llm-request') {
        const sourceIds = event.data.messageSeqs.map(seq => session.snapshotEvents().find(item => item.seq === seq && item.type === 'user/message')?.data.id);
        const task = [...this.#active.values()].find(task => task.sessionId === session.id && sourceIds.length && sourceIds.every(id => id && task.inputs.some(input => input.messageId === id)));
        if (task) this.#auxiliarySources.set(this.#sourceKey(session.id, 'session-title', event.data.messages), { task, sourceEventSeq: event.seq, messageSeqs: event.data.messageSeqs });
      }
      if (event.type === 'request/header') {
        const step = this.#steps.get(ctx.get('agents')?.get(session.id));
        if (step?.pending && sameChoice(step.pending, event.data.header.config)) step.pendingConsumed = true;
      }
      this.#observe(session, event);
    });
    ctx.on('tools/pre-execute', (exec, next) => { this.#takeover.bindTool(exec); return next(); }, { prepend: true });
    ctx.on('tools/result', (exec, result) => { this.#takeover.recordToolResult(exec, result); });
    ctx.on('agent/inbox/inserted', ({ agent, message }) => { if (message.source?.kind === 'user') this.#wakeTakeoverWaiters(agent.session.id); });
    ctx.tools.guard(exec => this.#takeover.guardTool(exec));
    // The public dispatch event precedes every waterfall listener/consumer delay.
    ctx.on('internal/dispatch', (mode, name, args) => {
      const request = args[0];
      if (mode === 'waterfall' && name === 'llm/stream' && !isAgentLoopRequest(request) && !this.#ownedRequests.has(request)) this.#automaticStreams.set(request, this.#auxiliaryStream(request));
    });
    // Public service-read interception surrounds the complete middleware chain.
    ctx.on('internal/get', (_caller, name, _error, next) => {
      const value = next();
      if (name !== 'llm' || !value) return value;
      const service = this;
      return new Proxy(value, { get(target, key, receiver) {
        if (key === 'prepareCall') {
          const prepare = Reflect.get(target, key, target);
          return (config, signal) => service.#watchPreparedCall(config, signal, () => Reflect.apply(prepare, target, [config, signal]));
        }
        if (key !== 'stream') return Reflect.get(target, key, receiver);
        const stream = Reflect.get(target, key, target);
        return request => service.#watchPublicStream(request, () => Reflect.apply(stream, target, [request]));
      } });
    });
    ctx.on('agent/inbox/claimed', ({ agent, turn, message }) => {
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      if (!task || message.source?.kind !== 'user') return;
      const inferred = contentRequirements(message.content);
      task.requirements = mergeTaskRequirements(task.requirements, inferred.requirements);
      task.assessmentHint ??= inferred.assessment;
      const inputs = this.#assessmentInputs.get(task.id) ?? [];
      inputs.push({ messageId: message.id, content: structuredClone(message.content) });
      this.#assessmentInputs.set(task.id, inputs);
      task.inputs.push({ messageId: message.id, requestId: message.source.rpcId ?? null, turn, contentHash: createHash('sha256').update(JSON.stringify(message.content)).digest('hex'), claimedAt: new Date().toISOString() });
      task.timeline.push({ kind: 'input-claimed', messageId: message.id, requestId: message.source.rpcId ?? null, turn });
      this.#persist();
    });
    ctx.on('system-prompt/assemble', async (_assembly, { agent, signal }, next) => {
      if (!agent) return next();
      await this.#refreshEligibility(signal);
      const turn = ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')?.lastTurn;
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      const config = structuredClone(this.#state.config);
      this.#stableRouterSnapshots.add(config);
      const pending = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection');
      const step = { config, pending: pending?.pending ? { ...pending.pending } : null, route: null };
      this.#steps.set(agent, step);
      let assembled = await next();
      // A connection probe has no coding work: avoid sending the desktop tool
      // catalog and its instructions while keeping the native runtime context.
      if (task?.openCodeGoDetection || task?.compatibleDetection) assembled = { ...assembled, tools: [], sections: [{ name: 'router:connection-probe', text: GO_PROBE_SYSTEM_PROMPT, interpolate: false }] };
      step.assembled = assembled;
      if (task?.takeover && task.routingPauseReason?.startsWith('TAKEOVER_')) step.blocked = task.routingPauseReason;
      let handoff;
      try { if (task?.takeover) handoff = await this.#takeover.route({ agent, signal, task }); }
      catch (error) { step.blocked = takeoverReason(error, signal); await this.#takeover.refuse(agent, step.blocked); }
      if (handoff && !step.blocked) {
        step.route = { candidateId: handoff.capture.candidateId, ...handoff.capture.identity };
        step.selectionSnapshot = handoff.capture;
        step.enforceCandidate = true;
        if (handoff.planId) step.takeover = handoff;
      }
      if (manualChanged(step, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) step.blocked = 'NATIVE_SELECTION_CHANGED';
      const detection = detectionOf(task);
      if (step.route && handoff) {
        // One same-Task handoff owns this assembled request; native pending wins below.
        if (step.pending) step.blocked = 'NATIVE_SELECTION_CHANGED';
      } else if (task && detection && !step.blocked) {
        const captured = await this.captureCandidate(detection.capture.candidateId, { config, signal });
        if (!sameIdentity(captured.identity, detection.capture.identity)
          || captured.authEpoch !== detection.capture.authEpoch
          || captured.connectionConfigRevision !== detection.capture.connectionConfigRevision
          || captured.registryEpoch < detection.capture.registryEpoch
          || !captured.enabled) step.blocked = 'CONNECTION_CHANGED';
        else {
          step.route = { candidateId: captured.candidateId, ...captured.identity };
          step.selectionSnapshot = captured;
          step.enforceCandidate = true;
          task.activeSelection = captured.identity;
          task.configVersion = config.version;
          const reason = task.compatibleDetection ? 'EXPLICIT_COMPATIBLE_DETECTION' : task.openCodeGoDetection ? 'EXPLICIT_OPENCODE_GO_DETECTION' : task.chatGptDetection ? 'EXPLICIT_CHATGPT_DETECTION' : 'EXPLICIT_DEEPSEEK_DETECTION';
          task.routing = { status: 'selected', objective: 'explicit-detection', snapshotEpoch: captured.registryEpoch, selected: structuredClone(captured), reasonCodes: [reason], excluded: [], requirements: { modalities: ['text'] } };
          task.timeline.push({ kind: 'routing-decision', candidateId: captured.candidateId, reasons: [reason], excluded: [], snapshotEpoch: captured.registryEpoch });
          this.#persist();
        }
      } else if (task && pending !== undefined && config.automatic && task.routing?.status === 'selected' && !step.blocked) {
        const fixedId = config.fixedCandidateId ?? config.fixedModel;
        const fixed = config.pool.find(candidate => (candidate.candidateId ?? candidate.model) === fixedId && candidate.enabled);
        if (fixedId && !fixed) step.blocked = 'FIXED_MODEL_UNAVAILABLE';
        else if (fixedId && step.pending && !sameRoute(step.pending, fixed)) step.blocked = 'FIXED_MODEL_CONFLICT';
        else if (!step.pending) {
          const previous = agent.session.requestHeader()?.config;
          const enabled = config.pool.filter(model => model.enabled);
          step.route = fixedId ? fixed : enabled.find(model => sameRoute(model, previous)) ?? enabled[0] ?? null;
          if (!step.route) step.blocked = fixedId ? 'FIXED_MODEL_UNAVAILABLE' : 'NO_ENABLED_CANDIDATE';
        }
      } else if (task && pending !== undefined && config.automatic && !step.blocked) {
        let decision;
        const candidateSnapshot = this.#connections.snapshot(config);
        const currentRoute = agent.session.requestHeader()?.config ?? agent.options;
        const current = this.#connections.candidateForRoute(currentRoute);
        const manual = step.pending ? this.#connections.candidateForRoute(step.pending) : null;
        const messages = agent.session.deriveMessages();
        const requirements = publicRequirements(task, messages);
        const comparisonKey = workloadFingerprint(requirements, messages, task.inputs);
        const forecastsByCandidate = Object.fromEntries(candidateSnapshot.candidates.map(candidate => [candidate.candidateId, selectionForecast(requirements)]));
        const input = {
          task: { requirements }, candidateSnapshot, objective: config.routingObjective,
          currentCandidateId: current?.candidateId ?? null,
          fixedCandidateId: config.fixedCandidateId ?? null,
          manualCandidateId: step.pending ? manual?.candidateId ?? '__missing-native-pending__' : null,
          forecastsByCandidate,
          observationsByCandidate: routingObservations(this.#state.tasks, candidateSnapshot, comparisonKey),
          assessmentRequest: task.assessmentRequested || task.assessmentHint ? { required: true, enabled: config.semanticAssessment, budgetApproved: config.semanticAssessment, maxOutputTokens: 128, budgetEstimate: selectionForecast(requirements, 128) } : null,
        };
        decision = selectInitialRoute(input);
        if (decision.kind === 'assessment-required') {
          task.routing = { status: 'assessing', objective: config.routingObjective, requirements, comparisonKey, snapshotEpoch: decision.snapshotEpoch, reasonCodes: decision.reasonCodes, excluded: decision.excluded, assessment: { status: 'running', budgetEstimate: decision.assessment.budgetEstimate } };
          this.#persist();
          let assessment;
          const capturedAssessor = await this.captureCandidate(decision.assessor.candidateId, { config, signal });
          if (!sameIdentity(capturedAssessor.identity, decision.assessor.identity)
            || capturedAssessor.authEpoch !== decision.assessor.authEpoch
            || capturedAssessor.connectionConfigRevision !== decision.assessor.connectionConfigRevision) {
            step.blocked = 'CONNECTION_CHANGED';
            assessment = { purpose: 'assessment', evidence: 'insufficient', callId: null, reason: 'ASSESSMENT_CANDIDATE_CHANGED' };
          } else {
            decision = { ...decision, assessor: capturedAssessor };
            const revision = assessmentRevision(task);
            const context = boundedAssessmentInput(requirements, messages, this.#assessmentInputs.get(task.id) ?? [], task.assessmentHint);
            if (context.status !== 'ready') {
              assessment = { purpose: 'assessment', evidence: 'insufficient', callId: null, reason: context.reason };
            } else {
              assessment = await runInitialAssessment({
                router: this, taskId: task.id, decision, signal,
                forecast: selectionForecast({ contextTokens: context.bytes }, decision.assessment.maxOutputTokens),
                routerSnapshot: config, configVersion: config.version,
                request: {
                  signal,
                  messages: [
                    { role: 'system', content: [{ type: 'text', text: 'Assess only the supplied Task context. Return strict JSON {"evidence":"sufficient","requirements":{"modalities":["text"|"image"],"tools":boolean,"contextTokens":number}}. Add only necessary requirements. If the context is insufficient, return {"evidence":"insufficient"}.' }] },
                    createUserMessage({ content: [{ type: 'text', text: context.text }] }),
                  ],
                },
              });
              if (assessmentRevision(task) !== revision) assessment = { ...assessment, evidence: 'insufficient', requirements: undefined, reason: 'ASSESSMENT_CONTEXT_CHANGED' };
            }
          }
          if (manualChanged(step, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) step.blocked = 'NATIVE_SELECTION_CHANGED';
          decision = step.blocked ? decision : selectInitialRoute({ ...input, assessmentResult: assessment });
          task.routing.assessment = { status: assessment.evidence === 'sufficient' ? 'completed' : 'insufficient', callId: assessment.callId, evidence: assessment.evidence, ...(assessment.reason ? { reason: assessment.reason } : {}) };
          if (step.blocked) task.routing.status = 'paused';
        }
        if (!step.blocked && decision.kind === 'execute') {
          const captured = await this.captureCandidate(decision.selected.candidateId, { config, signal });
          if (!sameIdentity(captured.identity, decision.selected.identity) || captured.authEpoch !== decision.selected.authEpoch || captured.connectionConfigRevision !== decision.selected.connectionConfigRevision) step.blocked = 'CONNECTION_CHANGED';
          else {
            step.route = { candidateId: captured.candidateId, ...captured.identity };
            step.selectionSnapshot = captured;
            step.enforceCandidate = true;
            task.routing = {
              ...task.routing,
              status: 'selected', objective: config.routingObjective,
              requirements: decision.appliedRequirements ?? requirements, comparisonKey,
              snapshotEpoch: decision.snapshotEpoch,
              selected: structuredClone(decision.selected), reasonCodes: structuredClone(decision.reasonCodes),
              excluded: structuredClone(decision.excluded), comparison: structuredClone(decision.comparison),
            };
            task.configVersion = config.version;
            task.timeline.push({ kind: 'routing-decision', candidateId: captured.candidateId, reasons: structuredClone(decision.reasonCodes), excluded: structuredClone(decision.excluded), snapshotEpoch: decision.snapshotEpoch });
            this.#persist();
          }
        } else if (!step.blocked) {
          step.blocked = routingPauseReason(decision);
          task.routing = { ...task.routing, status: 'paused', objective: config.routingObjective, requirements, comparisonKey, snapshotEpoch: decision.snapshotEpoch, reasonCodes: structuredClone(decision.reasonCodes), excluded: structuredClone(decision.excluded), ...(decision.assessment ? { assessment: { ...decision.assessment, status: 'required' } } : {}) };
          this.#persist();
        }
      }
      step.effectiveRoute = step.route ?? { provider: assembled.variables.provider, model: assembled.variables.model };
      if (!step.selectionSnapshot) {
        const candidate = step.route ? this.#connections.resolve(step.route.candidateId ?? step.route.model) : this.#connections.candidateForRoute(step.effectiveRoute);
        if (candidate) step.selectionSnapshot = this.#connections.capture(candidate.candidateId, config);
        step.enforceCandidate = Boolean(candidate && (step.route || candidate.managed || candidate.ownership === 'router-owned'));
      }
      if (step.selectionSnapshot?.identity?.billingPath === 'compatible-unconfirmed' && !step.selectionSnapshot.capability.tools.supported) { assembled = { ...assembled, tools: [] }; step.assembled = assembled; }
      return step.route ? { ...assembled, variables: { ...assembled.variables, provider: step.route.provider, model: step.route.model } } : assembled;
    }, { prepend: true });
    ctx.on('agent/pre-step', async ({ agent, signal, turn, step: index, messages }, next) => {
      const decision = await next();
      const step = this.#steps.get(agent);
      if (!step || decision.kind === 'reject' || signal.aborted) return decision;
      const detectionTask = this.#active.get(`${agent.session.id}:${turn}`);
      if (detectionTask && this.#detectionCallLimitReached(detectionTask)) {
        this.#pauseAtDetectionCallLimit(detectionTask);
        return { kind: 'reject' };
      }
      const detection = detectionOf(detectionTask);
      if (detection || step.selectionSnapshot?.identity?.billingPath === 'compatible-unconfirmed') {
        // Native system/message projection happens after prepareRequest reserves
        // the call. Include the probe section before that projection; duplicate
        // historical system text only makes this estimate more conservative.
        const system = detectionTask?.openCodeGoDetection ? GO_PROBE_SYSTEM_PROMPT : step.selectionSnapshot?.identity?.billingPath === 'compatible-unconfirmed' ? renderPrompt(step.assembled) : '';
        const currentSystem = system ? [{ role: 'system', content: [{ type: 'text', text: system }] }] : [];
        step.detectionForecast = conservativeRequestForecast([...agent.session.deriveMessages(), ...currentSystem, ...decision.messages], step.assembled?.tools, detection?.outputForecastTokens ?? detection?.outputTokens ?? 1024);
      }
      const hasImage = [...agent.session.deriveMessages(), ...messages].some(message => message.content.some(part => part.type === 'image'));
      const capability = step.selectionSnapshot?.capability;
      const incompatible = step.enforceCandidate && hasImage && capability?.image.supported !== true;
      const blocked = detectionTask?.recovery?.state === 'paused' ? detectionTask.recovery.reason : step.blocked ?? this.#restriction(step.effectiveRoute) ?? (incompatible ? 'NO_COMPATIBLE_IMAGE_CANDIDATE' : null);
      if (blocked) {
        const task = this.#active.get(`${agent.session.id}:${turn}`);
        if (task) task.routingPauseReason = blocked;
        return { kind: 'reject' };
      }
      const previous = agent.session.requestHeader()?.config;
      try { if (step.takeover) await this.#takeover.prepare({ agent, signal, task: detectionTask, step, decision }); }
      catch (error) { detectionTask.routingPauseReason = takeoverReason(error, signal); await this.#takeover.refuse(agent, detectionTask.routingPauseReason); return { kind: 'reject' }; }
      if (!step.route || step.pending || !previous || sameRoute(step.route, previous) || (decision.messages.length === 0 && (index === 1 || messages.length > 0))) return decision;
      return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `[model changed: assistant turns above this point were generated by ${previous.provider}/${previous.model}; the session continues with ${step.route.provider}/${step.route.model}]` }], source: { kind: 'model-selection', form: 'notice', summary: `${previous.model} → ${step.route.model}` } })] };
    }, { prepend: true });
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type === 'start') {
        const task = this.#active.get(`${agent.session.id}:${frame.turn}`);
        const reservation = this.#nativeReservations.get(agent);
        const call = reservation?.taskId === task?.id && reservation.turn === frame.turn && reservation.step === frame.step ? task.calls.find(item => item.id === reservation.callId && item.status === 'prepared' && !item.hostAttemptId) : null;
        if (!call) return;
        call.hostAttemptId = frame.attemptId;
        this.#inflight.set(agent.session.id, call);
        this.#confirm(task, agent.session.requestHeader().config, call);
        this.#persist();
      } else if (frame.type === 'end') {
        const call = this.#inflight.get(agent.session.id);
        if (call?.hostAttemptId !== frame.attemptId) return;
        if (frame.outcome.kind === 'abandoned' && call.status === 'prepared') call.status = 'failed';
        this.#inflight.delete(agent.session.id);
        this.#persist();
      }
    });
    ctx.on('agent/request', async ({ agent, turn, step, signal }, next) => {
      const resolved = await next();
      const stepSnapshot = this.#steps.get(agent);
      const config = stepSnapshot?.route ? { ...resolved, provider: stepSnapshot.route.provider, model: stepSnapshot.route.model } : resolved;
      if (stepSnapshot?.route && !sameRoute(resolved, stepSnapshot.route)) delete config.reasoningEffort;
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      if (task?.recoveryOwned && task.recovery?.state === 'paused') throw new LlmError('Recovery is paused', task.recovery.reason);
      const previousReservation = this.#nativeReservations.get(agent);
      if (task?.recoveryOwned && previousReservation?.taskId === task.id && previousReservation.turn === turn && previousReservation.step === step && task.recovery?.state !== 'ready') throw new LlmError('Router did not authorize a further attempt', task.recovery?.reason ?? 'RECOVERY_DISABLED');
      const recovery = task?.recovery?.state === 'ready' ? task.recovery : null;
      if (recovery) {
        this.#verifyRecoveryBoundary(agent, task, recovery, signal);
        const fresh = await this.captureCandidate(recovery.target.candidateId, { signal });
        this.#verifyRecoveryBoundary(agent, task, recovery, signal);
        if (!fresh.enabled || !sameIdentity(fresh.identity, recovery.target.identity) || fresh.authEpoch !== recovery.target.authEpoch || fresh.connectionConfigRevision !== recovery.target.connectionConfigRevision) throw new LlmError('Recovery candidate changed', 'RECOVERY_CANDIDATE_CHANGED');
        config.provider = fresh.identity.provider; config.model = fresh.identity.model; config.maxTokens = recovery.maxTokens;
        stepSnapshot.selectionSnapshot = fresh; stepSnapshot.recovery = { id: recovery.id, model: recovery.model };
      }
      if (stepSnapshot?.takeover?.planId && task.routingPauseReason?.startsWith('TAKEOVER_') && !(recovery?.safeTakeoverPlanId === stepSnapshot.takeover.planId && task.routingPauseReason === 'TAKEOVER_TARGET_RESPONSE_FAILED')) throw new LlmError('The interrupted takeover requires explicit resolution', task.routingPauseReason);
      if (task?.deepSeekDetection) config.maxTokens = DEEPSEEK_DETECTION_OUTPUT_TOKENS;
      if (task?.openCodeGoDetection) config.maxTokens = task.openCodeGoDetection.outputTokens;
      if (stepSnapshot?.selectionSnapshot?.identity?.billingPath === 'compatible-unconfirmed') config.maxTokens = recovery?.maxTokens ?? 1024;
      if (stepSnapshot?.takeover?.planId) config.maxTokens = recovery?.safeTakeoverPlanId === stepSnapshot.takeover.planId ? recovery.maxTokens : task.takeoverPolicy.maxTokens;
      const blocked = stepSnapshot && manualChanged(stepSnapshot, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending) ? 'NATIVE_SELECTION_CHANGED' : this.#restriction(config);
      if (blocked) {
        if (task) task.routingPauseReason = blocked;
        throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND');
      }
      if (task) {
        const candidate = stepSnapshot?.selectionSnapshot ?? (() => { const found = this.#connections.candidateForRoute(config); return found ? this.#connections.capture(found.candidateId, stepSnapshot?.config ?? this.#state.config) : null; })();
        task.activeSelection = candidate?.identity ?? selection(config);
        task.configVersion = stepSnapshot?.config.version ?? this.#state.config.version;
        if (candidate?.identity?.billingPath === 'compatible-unconfirmed' && (!Number.isSafeInteger(task.budget.limits.tokens) || task.budget.limits.tokens < 1 || !Number.isSafeInteger(task.budget.limits.durationMs) || task.budget.limits.durationMs < 1)) throw new LlmError('Set finite token and duration limits before using compatible connections', 'COMPATIBLE_BUDGET_REQUIRED');
        const forecast = recovery ? recoveryForecast(recovery.forecastTokens, recovery.maxTokens) : stepSnapshot?.takeover?.forecast ?? (detectionOf(task) || candidate?.identity?.billingPath === 'compatible-unconfirmed' ? stepSnapshot?.detectionForecast : config.provider === CONTROLLED_PROVIDER ? { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } : null);
        const reason = detectionOf(task) ? 'explicit-detection' : stepSnapshot?.pending ? 'native-pending' : stepSnapshot?.route ? (stepSnapshot.config.fixedCandidateId ?? stepSnapshot.config.fixedModel) ? 'fixed-model' : 'enabled-pool' : 'native-routing';
        task.timeline.push({ kind: 'selection', reason, provider: config.provider, model: config.model, configVersion: task.configVersion });
        const previous = this.#nativeReservations.get(agent);
        const before = task.calls.length;
        const purpose = detectionOf(task) ? 'detection' : previous?.taskId === task.id && previous.turn === turn && previous.step === step ? 'retry' : 'execution';
        const reservation = this.reserveCall(task.id, { purpose, step, selection: task.activeSelection, candidateId: candidate?.candidateId, selectionSnapshot: candidate, configVersion: task.configVersion, routerSnapshot: stepSnapshot?.config ?? this.#state.config, forecast }, signal);
        this.#bindCall(task.calls[before]);
        this.#nativeReservations.set(agent, { taskId: task.id, turn, step, callId: task.calls[before].id });
        if (recovery) {
          Object.assign(task.calls[before], { recoveryId: recovery.id, sourceCallId: recovery.sourceCallId, originatingPurpose: recovery.originatingPurpose, recoveryPhase: recovery.phase });
          recovery.callId = task.calls[before].id; recovery.state = 'call-reserved'; recovery.revision++; this.#persist();
        }
        if (stepSnapshot?.takeover?.planId) task.calls[before].takeoverPlanId = stepSnapshot.takeover.planId;
        await reservation;
        if (stepSnapshot?.takeover?.planId) {
          const call = task.calls[before];
          call.takeoverPlanId = stepSnapshot.takeover.planId;
          if (recovery) stepSnapshot.takeover.forecast = forecast;
          await this.#takeover.update(task.sessionId, task.turn, call.takeoverPlanId, { state: 'call-reserved', callId: call.id, ...(recovery ? { forecast } : {}) });
          this.#takeover.verifyBoundary(agent, signal, task.takeover.plan);
          if (recovery?.safeTakeoverPlanId === call.takeoverPlanId && task.routingPauseReason === 'TAKEOVER_TARGET_RESPONSE_FAILED') { delete task.routingPauseReason; this.#persist(); }
        }
        if (manualChanged(stepSnapshot, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) {
          task.routingPauseReason = 'NATIVE_SELECTION_CHANGED';
          throw new LlmError('Native selection changed while waiting for budget', 'MODEL_NOT_FOUND');
        }
      }
      // Return the entire downstream config, including native effort and token settings.
      if (stepSnapshot?.takeover?.planId || recovery) this.#nativeConfigs.set(config, { agent, step: stepSnapshot, call: task.calls.find(item => item.id === this.#nativeReservations.get(agent)?.callId), taskId: task.id });
      return config;
    }, { prepend: true });
    ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      const reservation = this.#nativeReservations.get(agent);
      const call = reservation?.taskId === task?.id && reservation.turn === turn && reservation.step === step ? task.calls.find(item => item.id === reservation.callId) : null;
      if (!call || call.settlementSeq === undefined || !call.hostAttemptId || call.selection.provider !== provider || call.status !== 'failed' || !task.recoveryOwned) return next();
      return this.#recoverFailure(agent, task, call, failure, signal);
    }, { prepend: true });
    const service = this;
    ctx.on('llm/stream', (request, next) => {
      const auxiliary = service.#ownedRequests.get(request);
      const native = isAgentLoopRequest(request);
      if (!native && !auxiliary) return service.#automaticStreams.get(request) ?? service.#auxiliaryStream(request);
      return (async function* () {
      // Check when consumed: outer request/budget middleware may have waited.
      // Revocation blocks dispatch; fixed/automatic changes await full assembly.
      const agent = ctx.get('agents')?.get(request.sessionId ?? auxiliary?.task.sessionId);
      const step = agent && service.#steps.get(agent);
      const call = auxiliary?.call ?? service.#inflight.get(request.sessionId);
      // A rejected entrant has no authority to clear another stream's durable marker.
      if (!call || service.#dispatchClaims.has(call)) throw new LlmError('Router call already has a dispatch owner', 'MODEL_NOT_FOUND');
      service.#dispatchClaims.add(call);
      const verify = () => {
        request.signal?.throwIfAborted();
        if (auxiliary?.task.budget.stopRequested) throw new LlmError('Router task has been stopped', 'ABORTED');
        const blocked = native && step && manualChanged(step, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending) ? 'NATIVE_SELECTION_CHANGED' : service.#restriction(call?.candidateId ? { ...request, candidateId: call.candidateId, selectionSnapshot: call.selectionSnapshot } : request);
        if (blocked) {
          const task = [...service.#active.values()].find(task => task.id === call.taskId);
          if (task) task.routingPauseReason = blocked;
          throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND');
        }
        const task = service.#active.get(`${request.sessionId}:${call.turn ?? service.#nativeReservations.get(agent)?.turn}`);
        if (native && task?.recoveryOwned && call.purpose === 'retry' && (!call.recoveryId || task.recovery?.id !== call.recoveryId || task.recovery.callId !== call.id || task.recovery.state !== 'call-reserved' || task.recovery.attempts > RECOVERY_LIMITS.attempts)) throw new LlmError('This attempt has no Task recovery grant', task.recovery?.reason ?? 'RECOVERY_ATTEMPT_LIMIT');
        if (call.recoveryId) service.#verifyRecoveryBoundary(agent, task ?? auxiliary.task, (task ?? auxiliary.task).recovery, request.signal);
      };
      try {
        verify();
        if (native && call.recoveryId) await service.#auditRecoveryFinal(request, agent, step, call);
        if (auxiliary && call.recoveryId) await service.#auditConsultationFinal(request, agent, auxiliary);
        if (native && step?.takeover) await service.#takeover.auditFinal(request, { agent, step, call });
        if (call) await service.persistDispatchIntent(call.taskId, call.id);
        // No await between this final signal/ownership/eligibility check and next().
        verify();
        const recoveryState = call.recoveryId ? service.#state.tasks.find(task => task.id === call.taskId)?.recovery : null;
        if (recoveryState && (agent.session.seq - 1 !== recoveryState.finalCursor || recoveryState.finalRequest?.callId !== call.id)) throw new LlmError('The final recovery cut changed', 'RECOVERY_FINAL_BOUNDARY_CHANGED');
        if (step?.takeover?.planId) service.#takeover.verifyFinal(request, { agent, step, call });
        if (call) { call.dispatchStarted = true; call.dispatchedAt = new Date().toISOString(); service.#persist(); }
        if (native && (step?.takeover?.planId || service.#state.tasks.find(task => task.id === call.taskId)?.recoveryOwned || service.#state.tasks.find(task => task.id === call.taskId)?.takeoverPolicy?.enabled)) {
          const task = service.#state.tasks.find(task => task.id === call.taskId);
          task.executionOwner = { candidateId: call.candidateId ?? null, identity: structuredClone(call.selection), callId: call.id, turn: task.turn, step: call.step, confidence: 'possible' };
          if (step?.takeover?.planId) recordTakeoverStage(task.takeover, 'dispatch-started');
          if (task.takeoverPolicy?.enabled) service.#persist();
        }
      } catch (error) {
        if (call) { call.dispatchIntent = 'blocked'; call.dispatchStarted = false; delete call.dispatchedAt; service.#persist(); }
        if (call?.recoveryId) {
          const task = service.#state.tasks.find(item => item.id === call.taskId);
          service.#pauseRecovery(task, task.calls.find(item => item.id === task.recovery.sourceCallId), task.recovery.failure, task.recovery.category, error.code?.replace(/^TAKEOVER_/u, 'RECOVERY_') ?? 'RECOVERY_PLUGIN_EXCEPTION');
          await service.flush();
        }
        if (native && step?.takeover?.planId) await service.#takeover.refuse(agent, takeoverReason(error, request.signal));
        throw error;
      }
      for await (const chunk of auxiliary ? service.#trackedDispatch(auxiliary, next) : next()) {
        if (!['usage', 'finish'].includes(chunk.type)) call.partialResponse = true;
        if (native && (chunk.type !== 'finish' || ['stop', 'tool-calls', 'max-tokens'].includes(chunk.reason?.kind))) {
          const task = service.#state.tasks.find(task => task.id === call.taskId);
          if (task.executionOwner?.callId === call.id && task.executionOwner.confidence !== 'response-observed') {
            task.executionOwner.confidence = 'response-observed';
            if (task.takeover?.plan.callId === call.id && task.takeover.plan.state === 'dispatch-started') recordTakeoverStage(task.takeover, 'dispatched');
            service.#persist();
          }
        }
        yield chunk;
      }
      })();
    });
    ctx.effect(() => () => {
      for (const timer of this.#deepSeekDeadlineTimers.values()) clearTimeout(timer);
      this.#deepSeekDeadlineTimers.clear();
      this.#deepSeekDetections.clear();
      this.#chatGptDetections.clear();
      this.#goDetections.clear();
      this.#compatibleDetections.clear();
      for (const waiter of this.#waiters.values()) waiter.reject(new LlmError('Router disabled during budget wait', 'MODEL_NOT_FOUND'));
      for (const waiter of this.#recoveryWaiters.values()) waiter.reject(new LlmError('Router disabled during recovery', 'ROUTER_DISABLED'));
      for (const task of this.#active.values()) for (const call of task.calls) this.#releaseUnboundCall(task, call, 'ROUTER_DISABLED', true);
      return this.flush();
    }, 'router: persist on dispose');
  }
  #auxiliaryStream(request) {
    // Capture ownership at stream construction, before an outer consumer may defer it.
    const key = this.#sourceKey(request.sessionId, request.purpose, request.messages);
    const source = this.#auxiliarySources.get(key);
    this.#auxiliarySources.delete(key);
    const task = source?.task;
    const active = task && this.#active.has(`${task.sessionId}:${task.turn}`) && !task.budget.stopRequested;
    const reason = !active ? 'AUXILIARY_TASK_UNAVAILABLE' : !this.#publicStreamEntries.has(request) ? 'AUXILIARY_LIFECYCLE_UNAVAILABLE' : null;
    if (reason) {
      this.#state.blockedRequests ??= [];
      this.#state.blockedRequests.push({ at: new Date().toISOString(), sessionId: request.sessionId ?? null, ...(active ? { taskId: task.id } : {}), provider: request.provider, model: request.model, nativePurpose: typeof request.purpose === 'string' ? request.purpose.slice(0, 100) : 'unknown', status: 'not-dispatched', reason });
      this.#state.blockedRequests = this.#state.blockedRequests.slice(-100); this.#persist();
      if (active) { task.auxiliaryPauseReason ??= reason; task.timeline.push({ kind: 'auxiliary-not-dispatched', sourceEventSeq: source.sourceEventSeq, reason }); this.#finishTask(task); this.#persist(); }
      return (async function* () { throw new LlmError(`Router cannot safely own this auxiliary request: ${reason}`, 'MODEL_NOT_FOUND'); })();
    }
    return this.#ownedCallStream(task, request, null, source);
  }
  #sourceKey(sessionId, purpose, messages) { return JSON.stringify([sessionId, purpose, messages?.map(message => message.id)]); }
  async #watchPreparedCall(config, signal, invoke) {
    const binding = this.#nativeConfigs.get(config);
    try {
      const prepared = await invoke();
      if (binding) {
        if (this.#steps.get(binding.agent) !== binding.step || this.#nativeReservations.get(binding.agent)?.callId !== binding.call.id) throw new LlmError('The native call owner changed during preparation', 'TAKEOVER_PREPARED_OWNER_CHANGED');
        if (binding.call.recoveryId) {
          const task = this.#active.get(`${binding.agent.session.id}:${this.#nativeReservations.get(binding.agent)?.turn}`);
          this.#verifyRecoveryBoundary(binding.agent, task, task.recovery, signal);
          binding.step.recovery.boundModel = this.#takeover.bindHandoffPrepared(prepared, task.recovery.target, binding.step.recovery.model, task.recovery.maxTokens);
        }
        if (binding.step.takeover) this.#takeover.bindPrepared(prepared, { ...binding, signal });
      }
      return prepared;
    } catch (error) {
      const task = binding && this.#state.tasks.find(task => task.id === binding.taskId);
      if (binding?.call.recoveryId) {
        this.#pauseRecovery(task, task.calls.find(item => item.id === task.recovery.sourceCallId), task.recovery.failure, task.recovery.category, error.code?.replace(/^TAKEOVER_/u, 'RECOVERY_') ?? 'RECOVERY_PLUGIN_EXCEPTION');
        await this.flush();
      } else if (binding?.step.takeover) {
        if (task) task.routingPauseReason = takeoverReason(error, signal);
        await this.#takeover.refuse(binding.agent, takeoverReason(error, signal));
      }
      throw error;
    }
  }
  #watchPublicStream(request, invoke) {
    if (isAgentLoopRequest(request) || this.#ownedRequests.has(request)) return invoke();
    this.#publicStreamEntries.add(request);
    try {
      const stream = invoke(), owner = this.#automaticOwners.get(request);
      return owner ? this.#watchOwnedStream(stream, owner) : stream;
    } catch (error) { this.#automaticOwners.get(request)?.close('AUXILIARY_STREAM_REJECTED'); throw error; }
    finally { this.#publicStreamEntries.delete(request); }
  }
  #watchOwnedStream(stream, owner) {
    const iterator = stream[Symbol.asyncIterator]();
    const advance = async (method, value) => {
      try {
        const result = iterator[method] ? await iterator[method](value) : method === 'throw' ? await Promise.reject(value) : { done: true, value };
        if (result.done) await owner.close('AUXILIARY_STREAM_CLOSED');
        return result;
      } catch (error) { try { await owner.close('AUXILIARY_STREAM_REJECTED'); } catch {} throw error; }
    };
    return {
      [Symbol.asyncIterator]() { return this; },
      next: value => advance('next', value),
      return: value => advance('return', value),
      throw: error => advance('throw', error),
      cancel: reason => owner.close(reason, false),
    };
  }
  #trackedDispatch(owner, next) {
    const stream = (async function* () {
      let iterator;
      try {
        iterator = next()[Symbol.asyncIterator]();
        while (true) {
          const result = await iterator.next();
          if (result.done) return;
          recordOwnedChunk(owner, result.value);
          yield result.value;
        }
      } finally {
        try { await iterator?.return?.(); }
        finally { owner.iterators.delete(stream); }
      }
    })();
    owner.iterators.add(stream);
    return stream;
  }
  /** Host-only exact request owner. Persists intent and settles this reserved call once. */
  streamReservedCall(taskId, callId, request) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    const signal = this.#callSignals.get(callId);
    if (!call || !signal || call.reservation.state !== 'reserved' || call.dispatchIntent || this.#requestBindings.has(call) || this.#dispatchClaims.has(call) || !sameRoute(call.selection, request) || (request.signal && request.signal !== signal)) throw new TypeError('The request does not own this reserved call');
    this.#bindCall(call);
    return this.#ownedCallStream(task, request, call);
  }
  /** One consultation intent, fresh reserved Call/handle per recovery; advice remains owned by the caller. */
  streamReservedCallWithRecovery(taskId, firstCallId, request) {
    const service = this;
    return (async function* () {
      let callId = firstCallId;
      const chain = [];
      while (true) {
        const task = [...service.#active.values()].find(item => item.id === taskId);
        const call = task?.calls.find(item => item.id === callId);
        if (!call || call.purpose !== 'consultation') throw new TypeError('Only the exact consultation intent can use this runner');
        chain.push(callId);
        call.consultationIntentCallId = firstCallId;
        let failure = null, caught;
        try {
          for await (const chunk of service.streamReservedCall(taskId, callId, request)) {
            if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) { failure = chunk.reason.failure; continue; }
            yield chunk;
          }
        } catch (error) { caught = error; failure = error.failure ?? { code: error.code ?? 'CONSULTATION_UNAVAILABLE' }; }
        if (call.status === 'completed') {
          if (chain.length > 1) {
            task.auxiliaryFaults = (task.auxiliaryFaults ?? []).filter(fault => !chain.includes(fault.callId));
            if (chain.includes(task.auxiliaryPauseCallId)) { task.auxiliaryPauseReason = task.auxiliaryFaults[0]?.reason; task.auxiliaryPauseCallId = task.auxiliaryFaults[0]?.callId; }
            service.#persist();
          }
          return;
        }
        const agent = service.ctx.get('agents')?.get(task.sessionId);
        const recovery = task.recoveryOwned && await service.#recoverFailure(agent, task, call, failure ?? call.failure ?? { code: call.failureCode ?? 'CONSULTATION_NOT_COMPLETED' }, request.signal, request);
        if (recovery?.kind !== 'retry') { if (caught) throw caught; yield { type: 'finish', reason: { kind: 'error', failure: { ...failure, message: 'The consultation did not complete' } } }; return; }
        const state = task.recovery, target = state.target;
        request = { ...request, provider: target.identity.provider, model: target.identity.model, maxTokens: state.maxTokens };
        service.#verifyRecoveryBoundary(agent, task, state, request.signal);
        const before = task.calls.length;
        const reserved = service.reserveCall(taskId, { purpose: 'consultation', step: call.step, selection: target.identity, candidateId: target.candidateId, selectionSnapshot: target, forecast: recoveryForecast(state.forecastTokens, state.maxTokens) }, request.signal);
        const retryCall = task.calls[before];
        Object.assign(retryCall, { recoveryId: state.id, sourceCallId: call.id, originatingPurpose: 'consultation', recoveryPhase: 'consultation' });
        state.callId = retryCall.id; state.state = 'call-reserved'; state.revision++; service.#persist();
        await reserved; service.#verifyRecoveryBoundary(agent, task, state, request.signal);
        callId = retryCall.id;
      }
    })();
  }
  #ownedCallStream(task, request, existingCall = null, source = null) {
    if (task.deepSeekDetection) request = withOutputLimit(request, DEEPSEEK_DETECTION_OUTPUT_TOKENS);
    if (task.openCodeGoDetection) request = withOutputLimit(request, task.openCodeGoDetection.outputTokens);
    if (request.provider?.startsWith('router-compatible-')) request = withOutputLimit(request, Math.min(request.maxTokens ?? 1024, 1024));
    const service = this, controller = new AbortController();
    const originalSignal = existingCall ? this.#callSignals.get(existingCall.id) : request.signal ?? new AbortController().signal;
    const owner = { task, call: existingCall, controller, started: false, iterators: new Set(), usage: null, finish: null, config: structuredClone(existingCall?.routerSnapshot ?? this.#state.config) };
    const owners = this.#ownedCalls.get(task.id) ?? new Set(); owners.add(owner); this.#ownedCalls.set(task.id, owners);
    const cleanup = () => {
      if (owner.closing && !owner.drained) return;
      originalSignal.removeEventListener('abort', abandon); controller.signal.removeEventListener('abort', abandon); owners.delete(owner); if (!owners.size) this.#ownedCalls.delete(task.id); this.#finishTask(task);
    };
    const abandon = () => {
      if (!owners.has(owner)) return;
      if (owner.started) { owner.close('ABORTED', false); return; }
      if (owner.call && !['settled', 'released'].includes(owner.call.reservation.state)) service.settleCall(task.id, owner.call.id, { status: 'not-dispatched', usage: null, finishReason: 'aborted', failureCode: 'ABORTED' });
      cleanup();
    };
    owner.close = (reason, fault = true) => {
      if (!owners.has(owner)) return;
      if (owner.closing) return owner.closing;
      if (fault) task.auxiliaryPauseReason ??= reason;
      if (owner.started) {
        owner.closeReason = reason;
        task.timeline.push({ kind: 'auxiliary-stream-close', callId: owner.call?.id ?? null, reason });
        const closing = Promise.withResolvers();
        owner.closing = closing.promise;
        // Event/synchronous-construction callers cannot await; the iterator facade can.
        owner.closing.catch(() => {});
        controller.abort(new LlmError('Router closed the owned auxiliary stream', reason));
        if (owner.call) service.#waiters.get(owner.call.id)?.resolve();
        Promise.resolve().then(async () => {
          const results = await Promise.allSettled([...owner.iterators].map(iterator => iterator.return()));
          owner.drained = true; cleanup();
          const failed = results.find(result => result.status === 'rejected');
          if (failed) throw failed.reason;
        }).then(closing.resolve, closing.reject);
        return owner.closing;
      }
      task.timeline.push({ kind: 'auxiliary-not-dispatched', nativePurpose: request.purpose ?? null, sourceEventSeq: source?.sourceEventSeq ?? null, reason });
      if (owner.call) service.settleCall(task.id, owner.call.id, { status: 'not-dispatched', usage: null, finishReason: 'unknown', failureCode: reason });
      controller.abort(new LlmError('Auxiliary stream closed before dispatch', reason));
      cleanup();
    };
    originalSignal.addEventListener('abort', abandon, { once: true }); controller.signal.addEventListener('abort', abandon, { once: true });
    if (originalSignal.aborted) abandon();
    if (!existingCall) this.#automaticOwners.set(request, owner);
    const stream = (async function* () {
      owner.started = true;
      let failureCode, caughtFailure;
      try {
        originalSignal.throwIfAborted(); controller.signal.throwIfAborted();
        if (!owner.call) {
          await service.#refreshEligibility(originalSignal);
          const candidate = service.#connections.candidateForRoute(request);
          const captured = candidate ? service.#connections.capture(candidate.candidateId, owner.config) : null;
          if (captured?.identity?.billingPath === 'compatible-unconfirmed' && (!Number.isSafeInteger(task.budget.limits.tokens) || task.budget.limits.tokens < 1 || !Number.isSafeInteger(task.budget.limits.durationMs) || task.budget.limits.durationMs < 1)) throw new LlmError('Compatible tasks require finite token and duration budgets', 'COMPATIBLE_BUDGET_REQUIRED');
          const before = task.calls.length;
          const detection = detectionOf(task);
          const forecast = detection || captured?.identity?.billingPath === 'compatible-unconfirmed'
            ? conservativeRequestForecast(request.messages, request.tools, detection?.outputForecastTokens ?? detection?.outputTokens ?? 1024, request.system)
            : request.provider === CONTROLLED_PROVIDER ? { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } : null;
          const reservation = service.reserveCall(task.id, { purpose: 'auxiliary', nativePurpose: typeof request.purpose === 'string' ? request.purpose.slice(0, 100) : 'unknown', selection: captured?.identity ?? selection(request), ...(captured ? { candidateId: captured.candidateId, selectionSnapshot: captured } : {}), configVersion: owner.config.version, routerSnapshot: owner.config, forecast }, originalSignal);
          owner.call = task.calls[before];
          owner.call.sourceEventSeq = source.sourceEventSeq;
          owner.call.sourceMessageSeqs = source.messageSeqs;
          service.#bindCall(owner.call);
          await reservation;
        }
        const signal = AbortSignal.any([originalSignal, controller.signal]); signal.throwIfAborted();
        const prepared = await service.ctx.llm.prepareCall(request, signal);
        if (owner.call.recoveryId) {
          service.#verifyRecoveryBoundary(service.ctx.get('agents')?.get(task.sessionId), task, task.recovery, signal);
          owner.recoveryBoundModel = service.#takeover.bindHandoffPrepared(prepared, task.recovery.target, task.recovery.model, task.recovery.maxTokens);
        }
        const options = Object.freeze({ ...request, ...prepared.config, signal });
        owner.call.snapshot = Object.fromEntries(['provider', 'model', 'temperature', 'maxTokens', 'reasoningEffort', 'stop'].filter(key => prepared.config[key] !== undefined).map(key => [key, structuredClone(prepared.config[key])]));
        owner.call.dispatchState = 'request-confirmed';
        service.#ownedRequests.set(options, owner);
        for await (const chunk of prepared.stream(options)) {
          recordOwnedChunk(owner, chunk);
          signal.throwIfAborted();
          yield chunk;
        }
      } catch (error) {
        failureCode = typeof error.code === 'string' ? error.code : 'AUXILIARY_CALL_FAILED'; caughtFailure = error.failure; throw error;
      } finally {
        try {
          // Prepared middleware may manually consume our dispatch and omit its return().
          // Close those exact children before settling or releasing task ownership.
          const children = [...owner.iterators].filter(iterator => iterator !== stream);
          if (children.length) {
            if (!originalSignal.aborted && !controller.signal.aborted) task.auxiliaryPauseReason ??= failureCode ?? 'AUXILIARY_CALL_FAILED';
            controller.abort(new LlmError('Router closed an abandoned prepared dispatch', failureCode ?? 'AUXILIARY_STREAM_CLOSED'));
            const results = await Promise.allSettled(children.map(iterator => iterator.return()));
            const rejected = results.find(result => result.status === 'rejected');
            if (rejected) failureCode ??= typeof rejected.reason?.code === 'string' ? rejected.reason.code : 'AUXILIARY_CALL_FAILED';
          }
          if (owner.call && owners.has(owner) && owner.call.reservation.state !== 'released') {
            const { usage, finish } = owner;
            const canceled = originalSignal.aborted || controller.signal.aborted;
            const status = canceled || finish?.kind === 'aborted' || finish?.kind === 'max-tokens' ? 'interrupted' : !failureCode && finish?.kind === 'stop' ? 'completed' : 'failed';
            if (status !== 'completed' && !canceled) {
              const reason = finish?.failure?.code ?? failureCode ?? (finish?.kind === 'max-tokens' ? 'AUXILIARY_MAX_TOKENS' : 'AUXILIARY_CALL_FAILED');
              if (!task.auxiliaryPauseReason) { task.auxiliaryPauseReason = reason; task.auxiliaryPauseCallId = owner.call.id; }
              task.auxiliaryFaults ??= []; task.auxiliaryFaults.push({ callId: owner.call.id, reason });
            }
            service.settleCall(task.id, owner.call.id, { status, usage, finishReason: canceled ? 'aborted' : finish?.kind ?? 'unknown', failureCode: finish?.failure?.code ?? failureCode ?? owner.closeReason, failure: finish?.failure ?? caughtFailure });
          }
        } finally { owner.iterators.delete(stream); cleanup(); }
      }
    })();
    owner.iterators.add(stream);
    return this.#watchOwnedStream(stream, owner);
  }
  #bindCall(call) {
    this.#unboundAbortDisposers.get(call.id)?.(); this.#unboundAbortDisposers.delete(call.id);
    this.#requestBindings.add(call);
  }
  #releaseUnboundCall(task, call, reason, fault = false) {
    if (this.#requestBindings.has(call) || this.#dispatchClaims.has(call) || !['waiting', 'reserved'].includes(call.reservation?.state)) return;
    if (fault) task.auxiliaryPauseReason ??= reason;
    this.settleCall(task.id, call.id, { status: possiblyDispatched(call) ? 'interrupted' : 'not-dispatched', usage: null, finishReason: 'aborted', failureCode: reason });
  }
  #cancelTaskCalls(task) {
    this.#recoveryWaiters.get(task.id)?.resolve();
    for (const owner of this.#ownedCalls.get(task.id) ?? []) owner.controller.abort(new LlmError('Router task stopped its auxiliary request', 'ABORTED'));
    for (const call of task.calls) this.#releaseUnboundCall(task, call, 'ABORTED');
    for (const call of task.calls) this.#waiters.get(call.id)?.resolve();
  }
  #detectionCallLimitReached(task) {
    return Boolean(detectionOf(task)?.maxCalls && task.calls.filter(call => possiblyDispatched(call) || !['released', 'settled'].includes(call.reservation?.state)).length >= detectionOf(task).maxCalls);
  }
  #pauseAtDetectionCallLimit(task) {
    task.routingPauseReason = 'CALL_LIMIT_REACHED';
    if (!task.timeline.some(item => item.kind === 'call-limit')) task.timeline.push({ kind: 'call-limit', limit: detectionOf(task).maxCalls });
    this.#persist();
  }
  #clearDetectionDeadline(taskId) {
    clearTimeout(this.#deepSeekDeadlineTimers.get(taskId));
    this.#deepSeekDeadlineTimers.delete(taskId);
  }
  #armDetectionDeadline(task) {
    this.#clearDetectionDeadline(task.id);
    const detection = detectionOf(task);
    if (!detection || task.budget.stopRequested) return;
    const expire = () => {
      const active = this.#active.get(`${task.sessionId}:${task.turn}`);
      if (active !== task || task.budget.stopRequested) return this.#clearDetectionDeadline(task.id);
      const remaining = Date.parse(task.startedAt) + task.budget.limits.durationMs - Date.now();
      // A persisted duration extension may race the earlier timer callback. Re-read the
      // Task-owned limit so elapsed time stays anchored to the original start.
      if (remaining > 0) {
        const timer = scheduleDeepSeekDeadline(expire, remaining);
        this.#deepSeekDeadlineTimers.set(task.id, timer);
        return;
      }
      this.#deepSeekDeadlineTimers.delete(task.id);
      detection.deadlineExpired = true;
      task.routingPauseReason = 'ABORTED';
      task.timeline.push({ kind: 'detection-deadline', code: 'ABORTED' });
      const agent = this.ctx.get('agents')?.get(task.sessionId);
      if (agent?.status === 'running') agent.cancel({ kind: 'user' }, { keepInbox: true });
      this.#cancelTaskCalls(task);
      this.#persist();
    };
    const remaining = Date.parse(task.startedAt) + task.budget.limits.durationMs - Date.now();
    const timer = scheduleDeepSeekDeadline(expire, remaining);
    this.#deepSeekDeadlineTimers.set(task.id, timer);
  }
  #finishTask(task) {
    if (!this.#active.has(`${task.sessionId}:${task.turn}`) || !task.nativeLifecycle || this.#ownedCalls.get(task.id)?.size || task.calls.some(call => ['waiting', 'reserved'].includes(call.reservation?.state))) return;
    task.lifecycle = this.#storageError || task.budget.stopRequested || task.routingPauseReason || task.auxiliaryPauseReason ? 'paused' : task.nativeLifecycle;
    if (task.lifecycle === 'paused') {
      task.pauseReason = this.#storageError ?? (task.budget.stopRequested ? 'BUDGET_STOPPED' : null) ?? task.nativePauseReason ?? task.routingPauseReason ?? task.auxiliaryPauseReason ?? 'UNKNOWN_TERMINAL';
      task.fault = { kind: ['CONNECTION', 'AUTH', 'RATE_LIMIT', 'NO_ADAPTER'].includes(task.pauseReason) ? 'connection' : 'execution', code: task.pauseReason, retryable: task.pauseReason === 'CONNECTION' || task.pauseReason === 'RATE_LIMIT' };
      if (task.recovery) task.fault = { kind: ['network', 'rate-limit', 'authorization', 'quota'].includes(task.recovery.category) ? 'connection' : 'execution', category: task.recovery.category, code: task.recovery.failure.code, reason: task.pauseReason, retryable: false };
    }
    task.endedAt = new Date().toISOString();
    task.timeline.push({ kind: 'terminal', lifecycle: task.lifecycle, reason: task.pauseReason ?? 'response-completed', acceptance: task.acceptance?.verdict ?? 'unconfirmed' });
    this.#active.delete(`${task.sessionId}:${task.turn}`);
    this.#clearDetectionDeadline(task.id);
    this.#assessmentInputs.delete(task.id);
    for (const call of task.calls) this.#callSignals.delete(call.id);
    this.#persist();
  }
  async snapshot() {
    await this.flush();
    const active = [...this.#active.values()].map(task => ({ taskId: task.id, sessionId: task.sessionId, appliedVersion: task.configVersion, desiredVersion: this.#state.config.version }));
    const application = { status: active.some(task => task.appliedVersion !== task.desiredVersion) ? 'pending' : 'applied', desiredVersion: this.#state.config.version, active };
    const candidateSnapshot = this.#connections.snapshot(this.#state.config);
    const deepSeek = this.#deepSeek ? await this.#deepSeek.snapshot() : undefined;
    const chatGpt = this.#chatGpt ? await this.#chatGpt.snapshot() : undefined;
    const openCodeGo = this.#go ? await this.#go.snapshot() : undefined;
    const compatible = this.#compatible ? await this.#compatible.snapshot() : undefined;
    return structuredClone({ ...this.#state, ...(deepSeek ? { deepSeek } : {}), ...(chatGpt ? { chatGpt } : {}), ...(openCodeGo ? { openCodeGo } : {}), ...(compatible ? { compatible } : {}), tasks: this.#state.tasks.map(task => task.startedAt ? { ...task, ledger: ledgerOf(task) } : task), application, candidateSnapshot, unsupportedProviders: candidateSnapshot.unsupported, storageError: this.#storageError ?? null, models: candidateSnapshot.candidates });
  }
  attachDeepSeek(host) { this.#deepSeek = host; }
  attachChatGpt(host) { this.#chatGpt = host; }
  attachOpenCodeGo(host) { this.#go = host; }
  attachCompatible(host) { this.#compatible = host; }
  async compatibleAdd(request) { await this.#compatible.add(request); return this.snapshot(); }
  async compatibleConnect(request) { await this.#compatible.connect(request); await this.refreshConnections(); return this.snapshot(); }
  async compatibleDisconnect(request) { await this.#compatible.disconnect(request); await this.refreshConnections(); return this.snapshot(); }
  async compatibleDiscover(request) { await this.#compatible.discover(request); return this.snapshot(); }
  async compatibleRunDetection(request) {
    if (!Number.isSafeInteger(request.budget?.tokens) || request.budget.tokens < 1 || request.budget.tokens > 32768 || !Number.isSafeInteger(request.budget?.durationMs) || request.budget.durationMs < 1 || request.budget.durationMs > 60000) throw new TypeError('Compatible detection requires a finite budget');
    const capture = await this.captureCandidate(request.candidateId);
    if (this.#compatible.requiresGoBalanceAttestation(capture.identity.connectionId) && request.useBalanceDisabled !== true) throw new TypeError('Confirm Go Use balance is disabled before detection');
    return this.#runResponsesDetection(request, { source: 'openai-compatible', host: this.#compatible, pending: this.#compatibleDetections, outputTokens: 1024, prompt: 'Reply exactly COMPATIBLE_CONNECTION_OK without using tools.' });
  }
  async openCodeGoSaveCredential(request) { await this.#go.saveCredential(request); return this.snapshot(); }
  async openCodeGoConnect() { await this.#go.connect(); await this.refreshConnections(); return this.snapshot(); }
  async openCodeGoDisconnect(request) { await this.#go.disconnect(request); await this.refreshConnections(); return this.snapshot(); }
  async openCodeGoRunDetection(request) {
    if (request.useBalanceDisabled !== true) throw new TypeError('Confirm Use balance is disabled before Go detection');
    if (!Number.isSafeInteger(request.budget?.tokens) || request.budget.tokens < 1 || request.budget.tokens > 32768 || !Number.isSafeInteger(request.budget?.durationMs) || request.budget.durationMs < 1 || request.budget.durationMs > 60000) throw new TypeError('Go detection requires a finite token and duration budget');
    return this.#runResponsesDetection(request, { source: 'opencode-go', host: this.#go, pending: this.#goDetections, outputTokens: 1024, prompt: 'Reply exactly OPENCODE_GO_CONNECTION_OK without using tools.' });
  }
  async deepSeekSaveCredential(request) {
    await this.#deepSeek.saveCredential(request);
    return this.snapshot();
  }
  async deepSeekDiscoverCatalog() {
    await this.#deepSeek.discoverCatalog();
    return this.snapshot();
  }
  async deepSeekConnect(request) {
    await this.#deepSeek.connect(request);
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async deepSeekDisconnect(request) {
    await this.#deepSeek.disconnect(request);
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async deepSeekRunDetection(request) {
    const capture = await this.captureCandidate(request.candidateId);
    if (!capture.enabled || capture.identity.provider === CONTROLLED_PROVIDER) throw new TypeError('DeepSeek detection requires an enabled owned candidate');
    const candidate = this.#connections.resolve(capture.candidateId, { allowLegacyControlled: false });
    if (candidate.ownership !== 'router-owned' || candidate.source !== 'deepseek-official-api') throw new TypeError('DeepSeek detection requires a DeepSeek owned candidate');
    const { sessionId } = await this.ctx.sessionController.create({ cwd: this.ctx.profileContext.home });
    const pending = { capture, budget: { tokens: request.budget.tokens, durationMs: request.budget.durationMs, money: [] }, taskId: null, startedAt: Date.now() };
    this.#deepSeekDetections.set(sessionId, pending);
    try {
      await this.ctx.sessionController.prompt({ sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Reply exactly DEEPSEEK_CONNECTION_OK' }] }, new AbortController().signal);
    } catch (error) {
      this.#deepSeekDetections.delete(sessionId);
      throw error;
    }
    const agent = this.ctx.get('agents')?.get(sessionId);
    while (true) {
      const task = pending.taskId && this.#state.tasks.find(item => item.id === pending.taskId);
      if (task && (task.lifecycle === 'waiting-budget' || ['completed', 'paused'].includes(task.lifecycle))) break;
      if (task?.deepSeekDetection?.deadlineExpired && agent?.status !== 'running' && !this.#ownedCalls.get(task.id)?.size) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    this.#deepSeekDetections.delete(sessionId);
    if (!pending.taskId) throw new Error('DeepSeek detection Task was not created');
    this.#deepSeek.setLastDetectionTask(pending.taskId);
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async chatGptStartAuthorization() { return this.#chatGpt.startAuthorization(); }
  async chatGptAddAccount() { return this.#chatGpt.startAuthorization({ newAccount: true }); }
  async chatGptSelectAccount(request) {
    await this.#chatGpt.selectAccount(request);
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async chatGptSignOut() {
    await this.#chatGpt.signOut();
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async chatGptCancelAuthorization() { await this.#chatGpt.cancelAuthorization(); return this.snapshot(); }
  async chatGptConnect() {
    await this.#chatGpt.connect();
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async chatGptDisconnect(request) {
    await this.#chatGpt.disconnect(request);
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async chatGptRunDetection(request) {
    return this.#runResponsesDetection(request, { source: 'openai-chatgpt-oauth', host: this.#chatGpt, pending: this.#chatGptDetections, prompt: 'Reply exactly CHATGPT_CONNECTION_OK without using tools.' });
  }
  async #runResponsesDetection(request, target) {
    const capture = await this.captureCandidate(request.candidateId);
    if (!capture.enabled || capture.identity.provider === CONTROLLED_PROVIDER) throw new TypeError('Responses validation requires an enabled owned candidate');
    const candidate = this.#connections.resolve(capture.candidateId, { allowLegacyControlled: false });
    if (candidate.ownership !== 'router-owned' || candidate.source !== target.source) throw new TypeError('Responses validation requires the selected connection');
    const claimId = await target.host.claimDetectionTask(capture.identity.connectionId);
    const { sessionId } = await this.ctx.sessionController.create({ cwd: this.ctx.profileContext.home });
    const pending = { capture, budget: { tokens: request.budget.tokens, durationMs: request.budget.durationMs, money: [] }, taskId: null, startedAt: Date.now(), maxCalls: RESPONSES_DETECTION_MAX_CALLS, outputForecastTokens: target.outputTokens ?? CHATGPT_DETECTION_OUTPUT_FORECAST_TOKENS, ...(target.outputTokens ? { outputTokens: target.outputTokens } : {}) };
    target.pending.set(sessionId, pending);
    try {
      await this.ctx.sessionController.prompt({ sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: target.prompt }] }, new AbortController().signal);
    } catch (error) {
      if (!pending.taskId) {
        target.pending.delete(sessionId);
        throw error;
      }
    }
    const agent = this.ctx.get('agents')?.get(sessionId);
    while (true) {
      const task = pending.taskId && this.#state.tasks.find(item => item.id === pending.taskId);
      if (task && (task.lifecycle === 'waiting-budget' || ['completed', 'paused'].includes(task.lifecycle))) break;
      if (detectionOf(task)?.deadlineExpired && agent?.status !== 'running' && !this.#ownedCalls.get(task.id)?.size) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    target.pending.delete(sessionId);
    if (!pending.taskId) throw new Error('Responses validation Task was not created');
    await target.host.finalizeDetectionTask(claimId, pending.taskId);
    return this.snapshot();
  }
  async refreshConnections() {
    await this.#connections.refresh();
    this.#persist(); await this.flush();
    this.#wakeTakeoverWaiters();
    return this.snapshot();
  }
  /** Host-only capture seam: callers receive registry-owned identity and revisions, never construct them. */
  async captureCandidate(candidateId, { config, signal } = {}) {
    if (config !== undefined && !this.#stableRouterSnapshots.has(config)) throw new TypeError('Candidate capture requires a Router-owned stable config snapshot');
    await this.#refreshEligibility(signal);
    signal?.throwIfAborted();
    return structuredClone(this.#connections.capture(candidateId, config ?? this.#state.config));
  }
  async #refreshEligibility(signal) {
    signal?.throwIfAborted();
    const epoch = this.#connections.epoch;
    await this.#connections.refresh({ signal });
    signal?.throwIfAborted();
    if (this.#connections.epoch !== epoch) { this.#persist(); await this.flush(); }
    if (this.#storageError) throw new LlmError('Router could not persist current Host connection eligibility', 'MODEL_NOT_FOUND');
  }
  #assertCallEligibility(task, call) {
    const blocked = this.#restriction(call.candidateId ? { ...call.selection, candidateId: call.candidateId, selectionSnapshot: call.selectionSnapshot } : call.selection);
    if (!blocked) return;
    task.routingPauseReason = blocked;
    throw new LlmError(`Router cannot use the captured candidate: ${blocked}`, 'MODEL_NOT_FOUND');
  }
  registerOwned(source) {
    const dispose = this.#connections.registerOwned(source);
    this.#persist();
    return () => { dispose(); this.#persist(); this.#wakeTakeoverWaiters(); };
  }
  exactTask(sessionId, turn) {
    const matches = this.#state.tasks.filter(task => task.sessionId === sessionId && task.turn === turn);
    if (matches.length !== 1) return null;
    const task = matches[0];
    return structuredClone({ ...task, ledger: task.startedAt ? ledgerOf(task) : undefined });
  }
  publishAcceptance(taskId, acceptance) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    if (!task || !acceptance || acceptance.schemaVersion !== 1 || !['passed', 'failed', 'unconfirmed'].includes(acceptance.verdict) || !Array.isArray(acceptance.evidence)) throw new TypeError('Invalid task acceptance publication');
    const detached = structuredClone(acceptance);
    JSON.stringify(detached);
    task.acceptance = detached;
    task.timeline.push({ kind: 'acceptance-published', verdict: detached.verdict, evidenceCount: detached.evidence.length });
    this.#persist();
    return structuredClone(detached);
  }
  async publishCoordination(taskId, expected, nextCoordination) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    const currentRevision = task?.coordination?.revision ?? 0;
    if (!task || task.acceptance?.revision !== expected?.acceptanceRevision || currentRevision !== expected?.coordinationRevision) {
      const error = new Error('Canonical Task acceptance or coordination changed');
      error.code = 'COORDINATION_STALE';
      throw error;
    }
    const detached = coordinationSchema.parse(structuredClone(nextCoordination));
    if (detached.acceptanceRevision !== expected.acceptanceRevision || detached.revision !== currentRevision + 1) throw new TypeError('Invalid coordination revision publication');
    JSON.stringify(detached);
    task.coordination = detached;
    task.timeline.push({ kind: 'coordination-published', revision: detached.revision, acceptanceRevision: detached.acceptanceRevision });
    this.#persist();
    await this.flush();
    if (this.#storageError) throw new Error('Router coordination publication was not persisted');
    return structuredClone(detached);
  }
  planTakeover(payload) { return this.#takeover.plan(payload); }
  toolReceipt(sessionId, callId) {
    const matches = this.#state.tasks.filter(task => task.sessionId === sessionId).flatMap(task => task.toolReceipts ?? []).filter(receipt => receipt.callId === callId);
    return matches.length === 1 ? structuredClone(matches[0]) : null;
  }
  toolReceiptsForSession(sessionId) { return structuredClone(this.#state.tasks.filter(task => task.sessionId === sessionId).flatMap(task => task.toolReceipts ?? [])); }
  pauseTakeover(taskId, planId, reason, stage) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    if (task?.takeover?.plan.id !== planId) return;
    task.routingPauseReason = reason;
    if (stage) recordTakeoverStage(task.takeover, stage, reason);
    this.#persist();
  }
  pauseRecovery(taskId, reason) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    if (!task?.recovery) return;
    this.#transitionRecoveryPause(task, reason);
  }
  recordToolReceipt(taskId, receipt) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.toolReceipts ??= [];
    task.toolReceipts.push(structuredClone(receipt));
    task.timeline.push({ kind: 'tool-receipt-recorded', callId: receipt.callId, outcome: receipt.outcome });
    this.#persist();
  }
  async publishTakeover(taskId, expected, nextState) {
    const task = this.#state.tasks.find(item => item.id === taskId);
    if (!task || task.acceptance?.revision !== expected.acceptanceRevision || task.coordination?.revision !== expected.coordinationRevision || (task.takeover?.revision ?? 0) !== expected.takeoverRevision) throw Object.assign(new Error('Task handoff changed'), { code: 'TAKEOVER_STALE' });
    const parsed = takeoverSchema.parse(structuredClone(nextState));
    if (parsed.revision !== expected.takeoverRevision + 1) throw new TypeError('Invalid handoff revision');
    task.takeover = parsed;
    task.plannedSelection = parsed.plan.target?.identity ?? null;
    task.timeline.push({ kind: 'takeover-published', revision: parsed.revision, state: parsed.plan.state, planId: parsed.plan.id, reason: parsed.plan.reason });
    this.#persist(); await this.flush();
    if (this.#storageError) throw new Error('Handoff was not persisted');
    return structuredClone(parsed);
  }
  completeTakeover(payload) { return this.#takeover.completed(payload); }
  async setPriceQuote(candidateId, quote, legacyQuote) {
    // Direct Host callers from 0.3.x may use the controlled provider/model pair.
    if (legacyQuote !== undefined && candidateId === CONTROLLED_PROVIDER) { candidateId = quote; quote = legacyQuote; }
    const candidate = this.#connections.resolve(candidateId);
    const parsed = quote === null ? null : quoteSchema().parse(quote);
    if (isChatGptSubscription(candidate) && parsed) throw new TypeError('ChatGPT subscription reference prices require a reviewed official model mapping');
    if (candidate.provider === CONTROLLED_PROVIDER && parsed && parsed.kind !== 'fixture-reference') throw new TypeError('Controlled prices are fixture reference values only');
    const prices = this.#state.config.prices.filter(item => item.candidateId !== candidate.candidateId && !sameIdentity(item, candidate));
    if (parsed) prices.push({ candidateId: candidate.candidateId, ...identityOf(candidate), quoteVersion: randomUUID(), quote: parsed });
    return this.#change({ prices });
  }
  async setBudgetDefaults(budget) {
    const parsed = budgetSchema().parse(budget);
    if (new Set(parsed.money.map(item => `${item.currency}:${item.kind}`)).size !== parsed.money.length) throw new TypeError('Duplicate money limits');
    return this.#change({ budget: parsed });
  }
  /** Host-only accounting seam. Future collaborators use this same gate; it grants no model authorization. */
  async reserveCall(taskId, details, signal) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    if (!task || !['assessment', 'execution', 'review', 'consultation', 'retry', 'redo', 'auxiliary', 'detection'].includes(details?.purpose) || !signal) throw new TypeError('Invalid task call reservation');
    if (this.#detectionCallLimitReached(task)) {
      this.#pauseAtDetectionCallLimit(task);
      throw new LlmError('Responses validation reached its authorized request limit', 'MODEL_NOT_FOUND');
    }
    const identity = identityOf(details.selection);
    if (!Object.values(identity).every(value => typeof value === 'string' && value)) throw new TypeError('A complete call identity is required');
    if (details.candidateId !== undefined) {
      const candidate = this.#connections.resolve(details.candidateId, { allowLegacyControlled: false });
      const captured = details.selectionSnapshot;
      if (!captured || captured.candidateId !== candidate.candidateId || !sameIdentity(identity, candidate) || !sameIdentity(identity, captured.identity) || captured.authEpoch !== candidate.authEpoch || captured.connectionConfigRevision !== candidate.connectionConfigRevision) throw new TypeError('Candidate reservation identity does not match its captured selection');
    }
    const snapshot = structuredClone(details.routerSnapshot ?? this.#state.config);
    const priced = (snapshot.prices ?? []).find(item => details.candidateId ? item.candidateId === details.candidateId : sameIdentity(item, identity));
    const routeCandidate = this.#connections.candidateForRoute(identity);
    const pricingCapture = details.selectionSnapshot ?? (routeCandidate && sameIdentity(routeCandidate, identity) ? this.#connections.capture(routeCandidate.candidateId, snapshot) : null);
    const priceQuote = pricingCapture ? pricingCapture.quote : priced?.quote ?? null;
    const call = { id: randomUUID(), taskId, turn: task.turn, purpose: details.purpose, accountingEntry: 'task-call-v1', dispatchProtocol: 'durable-intent-v2', attempt: task.calls.length + 1, ...(details.step === undefined ? {} : { step: details.step }), selection: identity, ...(details.candidateId ? { candidateId: details.candidateId, selectionSnapshot: structuredClone(details.selectionSnapshot) } : {}), ...(pricingCapture?.subscription ? { subscription: structuredClone(pricingCapture.subscription) } : {}), quoteVersion: pricingCapture ? pricingCapture.quoteVersion : priced?.quoteVersion ?? null, configVersion: details.configVersion ?? task.configVersion, routerSnapshot: snapshot, status: 'prepared', dispatchState: 'proposed', dispatchStarted: false, usage: null, priceQuote: structuredClone(priceQuote), reservation: reserveRecord(details.forecast ?? null, priceQuote), preparedAt: new Date().toISOString() };
    task.calls.push(call);
    if (details.nativePurpose !== undefined) call.nativePurpose = details.nativePurpose;
    this.#callSignals.set(call.id, signal);
    const abort = () => this.#releaseUnboundCall(task, call, 'ABORTED');
    this.#unboundAbortDisposers.set(call.id, () => signal.removeEventListener('abort', abort));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    this.#persist();
    try {
      await this.#refreshEligibility(signal);
      this.#assertCallEligibility(task, call);
      await this.#waitBudget(task, call, signal);
    }
    catch (error) {
      if (!possiblyDispatched(call) && call.reservation.state !== 'released') this.settleCall(taskId, call.id, { status: 'not-dispatched', usage: null, finishReason: signal.aborted ? 'aborted' : 'unknown', failureCode: typeof error?.code === 'string' ? error.code : 'CALL_RESERVATION_FAILED' });
      throw error;
    }
    return call.id;
  }
  async persistDispatchIntent(taskId, callId) {
    if (this.#storageError) throw new LlmError('Router storage is unavailable before dispatch', 'MODEL_NOT_FOUND');
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    const signal = this.#callSignals.get(callId);
    if (!call || !signal || call.reservation.state !== 'reserved' || call.dispatchStarted || call.dispatchIntent === 'possible') throw new TypeError('The call is not reserved for dispatch');
    await this.#refreshEligibility(signal);
    const blocked = this.#restriction(call.candidateId ? { ...call.selection, candidateId: call.candidateId, selectionSnapshot: call.selectionSnapshot } : call.selection);
    if (blocked) { task.routingPauseReason = blocked; throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND'); }
    signal.throwIfAborted();
    call.dispatchIntent = 'possible';
    call.dispatchIntentAt = new Date().toISOString();
    this.#persist();
    await this.flush();
    try {
      if (this.#storageError) throw new LlmError('Router dispatch intent could not be persisted', 'MODEL_NOT_FOUND');
      signal.throwIfAborted();
      const revoked = this.#restriction(call.candidateId ? { ...call.selection, candidateId: call.candidateId, selectionSnapshot: call.selectionSnapshot } : call.selection);
      if (revoked) { task.routingPauseReason = revoked; throw new LlmError(`Router cannot dispatch: ${revoked}`, 'MODEL_NOT_FOUND'); }
    } catch (error) {
      call.dispatchIntent = 'blocked'; this.#persist(); throw error;
    }
    // This intent permits the caller to start its transport; it does not prove adapter entry.
  }
  settleCall(taskId, callId, settlement) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    if (!call || ['settled', 'released'].includes(call.reservation.state)) throw new TypeError('The call cannot be settled twice');
    call.status = settlement.status;
    this.#callSignals.delete(call.id);
    this.#unboundAbortDisposers.get(call.id)?.(); this.#unboundAbortDisposers.delete(call.id);
    call.usage = settlement.usage ? Object.fromEntries(Object.entries(settlement.usage).filter(([key, value]) => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'].includes(key) && Number.isSafeInteger(value) && value >= 0)) : null;
    const responsesUsage = call.subscription?.usageFormat === 'openai-responses' || ['opencode-go-subscription', 'compatible-unconfirmed'].includes(call.selection.billingPath);
    if (call.usage && responsesUsage && call.usage.inputTokens !== undefined) {
      const aggregateInputTokens = call.usage.inputTokens + (call.usage.cacheReadTokens ?? 0) + (call.usage.cacheWriteTokens ?? 0);
      if (Number.isSafeInteger(aggregateInputTokens)) call.usageAccounting = { aggregateInputTokens, source: 'openai-responses-usage', inputPartitions: ['cacheReadTokens', 'cacheWriteTokens'].every(key => call.usage[key] !== undefined) ? 'complete' : 'incomplete' };
    }
    // Responses folds cache reads/writes into its prompt. If either detail was
    // omitted, the adapter's residual input cannot prove ordinary input usage.
    if (call.usage && responsesUsage && ['cacheReadTokens', 'cacheWriteTokens'].some(key => call.usage[key] === undefined)) delete call.usage.inputTokens;
    if (settlement.seq !== undefined) call.settlementSeq = settlement.seq;
    call.finishReason = settlement.finishReason;
    if (settlement.failureCode) call.failureCode = settlement.failureCode;
    if (settlement.failure) call.failure = failureFacts(settlement.failure);
    if (call.recoveryId && task.recovery?.callId === call.id && settlement.status === 'completed') { task.recovery.state = 'completed'; task.recovery.revision++; }
    call.settledAt = new Date().toISOString();
    call.elapsedMs = call.dispatchedAt ? Math.max(0, Date.parse(call.settledAt) - Date.parse(call.dispatchedAt)) : null;
    call.cost = !possiblyDispatched(call) && !call.usage ? { amount: null, reason: 'NOT_DISPATCHED', billingConfirmation: 'unconfirmed' } : costOf(tokensOf(call.usage), call.priceQuote, call.usageAccounting);
    call.reservation.state = !possiblyDispatched(call) && !call.usage ? 'released' : 'settled';
    if (call.candidateId && settlement.status === 'completed') this.#connections.markInference(call.candidateId, 'verified');
    call.overEstimate = [];
    const actualTokens = tokensOf(call.usage).total;
    if (actualTokens !== null && call.reservation.tokens.total !== null && actualTokens > call.reservation.tokens.total) call.overEstimate.push('tokens');
    if (call.cost.amount !== null && call.reservation.money.amount !== null && call.cost.amount > call.reservation.money.amount) call.overEstimate.push('money');
    if (call.overEstimate.length) task.timeline.push({ kind: 'estimate-exceeded', callId: call.id, resources: call.overEstimate, message: 'Actual usage exceeded the forecast; a reservation is not an absolute billing cap.' });
    task.timeline.push({ kind: 'call-settlement', callId: call.id, hostAttemptId: call.hostAttemptId, status: call.status, reason: call.finishReason });
    this.#persist();
    for (const candidate of task.calls) this.#waiters.get(candidate.id)?.resolve();
    this.#finishTask(task);
  }
  async extendTaskBudget(taskId, extension) {
    if (this.#storageError) throw new Error('Router storage is unavailable');
    const task = [...this.#active.values()].find(task => task.id === taskId);
    if (!task || task.budget.stopRequested) throw new TypeError('Only an active task can be extended');
    if (task.openCodeGoDetection) throw new TypeError('Go detection budget cannot be extended');
    if (task.compatibleDetection) throw new TypeError('Compatible detection budget cannot be extended');
    const parsed = extensionSchema().parse(extension);
    if (new Set((parsed.money ?? []).map(item => `${item.currency}:${item.kind}`)).size !== (parsed.money ?? []).length) throw new TypeError('Duplicate money extensions');
    const limits = structuredClone(task.budget.limits);
    for (const key of ['tokens', 'durationMs']) if (parsed[key] !== undefined) {
      if (limits[key] === null || !Number.isSafeInteger(limits[key] + parsed[key])) throw new TypeError('Cannot extend an unlimited or invalid limit');
      limits[key] += parsed[key];
    }
    for (const extra of parsed.money ?? []) {
      const item = limits.money.find(item => item.currency === extra.currency && item.kind === extra.kind);
      if (!item || !Number.isFinite(item.amount + extra.amount) || item.amount + extra.amount > Number.MAX_SAFE_INTEGER) throw new TypeError('The money limit does not exist or is too large');
      item.amount += extra.amount;
    }
    task.budget.extensions.push({ at: new Date().toISOString(), previous: task.budget.limits, extension: parsed, limits: structuredClone(limits) });
    task.budget.limits = limits;
    task.timeline.push({ kind: 'budget-extension', extension: parsed });
    this.#persist(); await this.flush();
    if (this.#storageError) throw new Error('Router storage is unavailable; budget extension was not persisted');
    if (parsed.durationMs !== undefined && detectionOf(task)) this.#armDetectionDeadline(task);
    for (const call of task.calls) this.#waiters.get(call.id)?.resolve();
    return this.snapshot();
  }
  async stopTask(taskId) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    if (!task) throw new TypeError('The task is not active');
    task.budget.stopRequested = true;
    task.timeline.push({ kind: 'budget-stop', at: new Date().toISOString() });
    this.#clearDetectionDeadline(task.id);
    if (!task.nativeLifecycle) this.ctx.get('agents')?.get(task.sessionId)?.cancel({ kind: 'user' }, { keepInbox: true });
    this.#cancelTaskCalls(task);
    this.#persist();
    return this.snapshot();
  }
  async #waitBudget(task, call, signal) {
    // Persist the reservation before sending anything to the selected adapter.
    await this.flush();
    let waited = false;
    while (true) {
      this.#assertReservation(task, call, signal);
      if (waited) {
        await this.#refreshEligibility(signal);
        this.#assertCallEligibility(task, call);
        if (call.takeoverPlanId) this.#takeover.verifyBoundary(this.ctx.get('agents')?.get(task.sessionId), signal, task.takeover.plan);
      }
      const decision = budgetCheck(task, call);
      if (call.recoveryId && decision.unenforceable.some(item => item.resource !== 'durationMs')) throw new LlmError('Recovery budget cannot be proved', 'RECOVERY_BUDGET_UNPROVEN');
      task.budget.unenforceableLimits = detectionOf(task)
        ? decision.unenforceable.filter(item => item.resource !== 'durationMs')
        : decision.unenforceable;
      if (!decision.blocked.length) {
        if (call.recoveryId) call.recoveryBudgetApproved = true;
        call.status = 'prepared'; call.reservation.state = 'reserved';
        task.lifecycle = 'running'; delete task.budget.waiting;
        this.#persist(); await this.flush();
        this.#assertReservation(task, call, signal);
        return;
      }
      call.status = 'waiting'; call.reservation.state = 'waiting';
      task.lifecycle = 'waiting-budget';
      task.budget.waiting = { callId: call.id, blockedBy: decision.blocked, proposedTokens: call.reservation.tokens.total, proposedMoney: call.reservation.money, since: task.budget.waiting?.since ?? new Date().toISOString() };
      task.timeline.push({ kind: 'budget-wait', callId: call.id, blockedBy: decision.blocked });
      this.#persist();
      const waiting = Promise.withResolvers();
      this.#waiters.set(call.id, waiting);
      const abort = () => waiting.reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try { signal.throwIfAborted(); await waiting.promise; }
      finally { signal.removeEventListener('abort', abort); this.#waiters.delete(call.id); }
      waited = true;
    }
  }
  #assertReservation(task, call, signal) {
    signal.throwIfAborted();
    for (const owner of this.#ownedCalls.get(task.id) ?? []) if (owner.call === call) owner.controller.signal.throwIfAborted();
    if (!['waiting', 'reserved'].includes(call.reservation.state) || task.budget.stopRequested || task.nativeLifecycle === 'paused') throw new LlmError('Router task no longer permits this reservation', 'ABORTED');
    if (this.#storageError) throw new LlmError('Router storage is unavailable', 'MODEL_NOT_FOUND');
    if (call.recoveryId) this.#verifyRecoveryBoundary(this.ctx.get('agents')?.get(task.sessionId), task, task.recovery, signal);
  }
  async setModelEnabled(candidateId, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid enabled state');
    const candidate = this.#connections.markManaged(candidateId);
    const pool = this.#state.config.pool.filter(entry => (entry.candidateId ?? entry.model) !== candidate.candidateId && !sameIdentity(entry, candidate));
    pool.push({ candidateId: candidate.candidateId, ...identityOf(candidate), enabled });
    return this.#change({ pool });
  }
  async setFixedModel(candidateId) {
    const candidate = candidateId === null ? null : this.#connections.resolve(candidateId);
    if (candidate && !this.#state.config.pool.some(entry => (entry.candidateId ?? entry.model) === candidate.candidateId && entry.enabled)) throw new TypeError('The fixed model must be enabled in the pool');
    return this.#change({ fixedCandidateId: candidate?.candidateId ?? null, fixedModel: candidate?.ownership === 'router-owned' ? candidate.model : null });
  }
  async removeModel(candidateId) {
    const candidate = this.#connections.markManaged(candidateId);
    return this.#change({ pool: this.#state.config.pool.filter(entry => (entry.candidateId ?? entry.model) !== candidate.candidateId && !sameIdentity(entry, candidate)) });
  }
  #restriction(route) {
    const candidate = route?.candidateId ? this.#connections.resolve(route.candidateId) : this.#connections.candidateForRoute(route);
    if (!candidate) return null;
    if (route?.candidateId && !sameRoute(candidate, route)) return 'REQUEST_SELECTION_MISMATCH';
    if (!candidate.managed && candidate.ownership !== 'router-owned') return null;
    if (!candidate.available || !this.ctx.llm.listProviders().some(item => item.id === candidate.provider)) return 'CONNECTION_REMOVED';
    if (route?.selectionSnapshot && (route.selectionSnapshot.authEpoch !== candidate.authEpoch || route.selectionSnapshot.connectionConfigRevision !== candidate.connectionConfigRevision)) return 'CONNECTION_CHANGED';
    const entry = this.#state.config.pool.find(entry => (entry.candidateId ?? entry.model) === candidate.candidateId);
    return !entry ? 'MODEL_REMOVED' : !entry.enabled ? 'MODEL_DISABLED' : null;
  }
  async setAutomatic(automatic) {
    if (typeof automatic !== 'boolean') throw new TypeError('automatic must be boolean');
    return this.#change({ automatic });
  }
  async setRoutingObjective(objective) {
    if (!ROUTING_OBJECTIVES.has(objective)) throw new TypeError('Invalid routing objective');
    return this.#change({ routingObjective: objective });
  }
  async setSemanticAssessment(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('semantic assessment must be boolean');
    if (!enabled) this.#state.semanticAssessmentRequest = null;
    return this.#change({ semanticAssessment: enabled });
  }
  async setAcceptancePolicy(policy) {
    const parsed = acceptancePolicySchema().parse(policy);
    if (parsed.review.enabled) {
      if (!parsed.enabled || !parsed.review.candidateId) throw new TypeError('Enabled review requires enabled acceptance and a reviewer candidate');
      const candidate = this.#connections.resolve(parsed.review.candidateId);
      const entry = this.#state.config.pool.find(item => (item.candidateId ?? item.model) === candidate.candidateId);
      if (!entry?.enabled) throw new TypeError('The review candidate must be enabled in the pool');
    }
    return this.#change({ acceptance: parsed });
  }
  async setCoordinationPolicy(policy) {
    const parsed = coordinationPolicySchema().parse(policy);
    if (parsed.candidateId) {
      const candidate = this.#connections.resolve(parsed.candidateId);
      const entry = this.#state.config.pool.find(item => (item.candidateId ?? item.model) === candidate.candidateId);
      if (!entry?.enabled) throw new TypeError('The consultation candidate must be enabled in the pool');
    }
    return this.#change({ coordination: parsed });
  }
  async setTakeoverPolicy(policy) {
    const parsed = takeoverPolicySchema().parse(policy);
    if (parsed.enabled && !parsed.candidateId) throw new TypeError('Choose an explicit takeover target');
    if (parsed.candidateId && !this.#connections.capture(parsed.candidateId).enabled) throw new TypeError('The takeover target must be enabled');
    return this.#change({ takeover: parsed });
  }
  async #recoverFailure(agent, task, call, failure, signal, boundedRequest = null) {
      const facts = failureFacts(failure), category = classifyFailure(facts);
      call.failure = facts;
      const blocked = !task.recoveryPolicy.enabled ? 'RECOVERY_DISABLED' : category === 'authorization' ? 'RECOVERY_REAUTHORIZE_REQUIRED' : category === 'quota' ? 'RECOVERY_QUOTA_REQUIRED' : call.partialResponse ? 'RECOVERY_RESPONSE_PARTIAL' : (task.recovery?.attempts ?? 0) >= RECOVERY_LIMITS.attempts ? 'RECOVERY_ATTEMPT_LIMIT' : facts.providerRetryAfterMs > RECOVERY_LIMITS.delayMs || (task.recovery?.waitMs ?? 0) + (facts.providerRetryAfterMs ?? 0) > RECOVERY_LIMITS.totalWaitMs ? 'RECOVERY_WAIT_LIMIT' : !['network', 'rate-limit'].includes(category) ? 'RECOVERY_FAILURE_UNSAFE' : tokensOf(call.usage).total === null || ledgerOf(task).unknownTokenCalls.total > 0 ? 'RECOVERY_USAGE_UNKNOWN' : null;
      if (blocked) { this.#pauseRecovery(task, call, facts, category, blocked); await this.flush(); return; }
      const phasePolicy = call.purpose === 'consultation' ? task.coordinationPolicy : call.takeoverPlanId ? task.takeover.plan.policy : task.recoveryPolicy;
      const sourceMaxTokens = call.hostConfig?.maxTokens ?? call.snapshot?.maxTokens;
      const maxTokens = Math.min(task.recoveryPolicy.maxTokens, phasePolicy.maxTokens, boundedRequest?.maxTokens ?? Infinity, sourceMaxTokens ?? Infinity);
      const forecastTokens = Math.min(task.recoveryPolicy.forecastTokens, phasePolicy.forecastTokens);
      task.recovery = { version: 1, id: task.recovery?.id ?? randomUUID(), revision: (task.recovery?.revision ?? 0) + 1, attempts: (task.recovery?.attempts ?? 0) + 1, waitMs: task.recovery?.waitMs ?? 0, actualWaitMs: task.recovery?.actualWaitMs ?? 0, state: 'planning', phase: call.purpose === 'consultation' ? 'consultation' : call.takeoverPlanId ? 'takeover' : 'execution', sourceCallId: call.id, originatingPurpose: call.purpose === 'consultation' ? 'consultation' : 'execution', callId: null, category, failure: facts, target: structuredClone(call.selectionSnapshot), reason: null, inputHash: jsonHash(task.inputs), fixedCandidateId: this.#state.config.fixedCandidateId, acceptanceRevision: task.acceptance?.revision ?? null, requirementHash: task.acceptance?.requirementHash ?? null, coordinationRevision: task.coordination?.revision ?? null, maxTokens, forecastTokens };
      task.timeline.push({ kind: 'recovery-grant', recoveryId: task.recovery.id, sourceCallId: call.id, phase: task.recovery.phase, attempt: task.recovery.attempts, category });
      this.#persist(); await this.flush();
      try {
        const recovery = task.recovery;
        if (task.recoveryPolicy.automatic && recovery.attempts > 1 && task.recoveryPolicy.alternativeCandidateId && !recovery.fixedCandidateId && !this.#steps.get(agent)?.pending) {
          const alternative = await this.captureCandidate(task.recoveryPolicy.alternativeCandidateId, { signal });
          this.#verifyRecoveryBoundary(agent, task, recovery, signal);
          if (!['connectionId', 'accountId', 'billingPath'].every(key => alternative.identity[key] === call.selection[key] && call.selection[key] !== 'unknown') || ['unknown', 'compatible-unconfirmed'].includes(alternative.identity.billingPath) || !alternative.enabled) throw new LlmError('The alternative authorization or billing path is different or unknown', 'RECOVERY_BILLING_PATH_CHANGED');
          recovery.target = alternative;
        }
        task.recovery.portableHistory = await this.#takeover.captureHandoffHistory(agent, task, signal, () => this.#verifyRecoveryBoundary(agent, task, task.recovery, signal));
        this.#verifyRecoveryBoundary(agent, task, task.recovery, signal);
        recovery.model = await this.#takeover.resolveHandoffTarget(recovery.target, signal, () => this.#verifyRecoveryBoundary(agent, task, recovery, signal));
        const assembled = this.#steps.get(agent).assembled;
        const proofRequest = boundedRequest ? { ...boundedRequest, maxTokens: recovery.maxTokens } : { messages: agent.session.deriveMessages(), tools: assembled.tools, toolHistory: agent.session.toolHistory(), system: renderPrompt(assembled) };
        recovery.boundedHistory = boundedRequest ? this.#takeover.boundedHandoffHistory(boundedRequest.messages) : null;
        recovery.requestHash = boundedRequest ? jsonHash({ messages: proofRequest.messages, maxTokens: proofRequest.maxTokens, tools: proofRequest.tools ?? [], system: proofRequest.system ?? null }) : null;
        const proof = await this.#takeover.auditHandoffRequest({ request: proofRequest, agent, target: recovery.target, model: recovery.model, maxTokens: recovery.maxTokens, forecastTokens: recovery.forecastTokens, history: recovery.boundedHistory ?? recovery.portableHistory, signal, recheck: () => this.#verifyRecoveryBoundary(agent, task, recovery, signal) });
        recovery.imageForecast = proof.imageForecast;
        if (call.takeoverPlanId) {
          if (task.routingPauseReason !== 'TAKEOVER_TARGET_RESPONSE_FAILED' || task.takeover?.plan.id !== call.takeoverPlanId || !sameIdentity(recovery.target.identity, task.takeover.plan.target.identity)) throw new LlmError('This takeover failure has no safe recovery transition', 'RECOVERY_TAKEOVER_UNPROVEN');
          this.#takeover.verifyBoundary(agent, signal, task.takeover.plan);
          recovery.safeTakeoverPlanId = call.takeoverPlanId;
        }
        if (!task.recoveryPolicy.automatic) await this.#waitForManualRecovery(agent, task, recovery, signal);
        await this.#waitRecovery(agent, task, task.recovery, signal, facts.providerRetryAfterMs ?? 1);
        this.#verifyRecoveryBoundary(agent, task, task.recovery, signal);
        task.recovery.state = 'ready'; task.recovery.revision++; task.lifecycle = 'running'; this.#persist(); await this.flush();
        this.#verifyRecoveryBoundary(agent, task, task.recovery, signal);
        return { kind: 'retry' };
      } catch (error) { this.#pauseRecovery(task, call, facts, category, signal.aborted ? 'RECOVERY_CANCELED' : error.code?.replace(/^TAKEOVER_/u, 'RECOVERY_') ?? 'RECOVERY_UNAVAILABLE'); await this.flush(); }
  }
  async setRecoveryPolicy(policy) {
    const parsed = recoveryPolicySchema().parse(policy);
    if (parsed.alternativeCandidateId && !this.#connections.capture(parsed.alternativeCandidateId).enabled) throw new TypeError('The recovery alternative must be enabled');
    return this.#change({ recovery: parsed });
  }
  async resolveTaskRecovery(request) {
    const action = recoveryActionSchema().parse(request);
    const task = [...this.#active.values()].find(item => item.id === action.taskId), state = task?.recovery;
    if (!task || task.nativeLifecycle || !this.#recoveryWaiters.has(task.id)) throw Object.assign(new Error('This Task has ended; start a new Task after repairing the connection or budget'), { code: 'RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED' });
    if (state?.id !== action.recoveryId || state.revision !== action.expectedRevision || state.state !== 'waiting-user') throw Object.assign(new Error('This recovery action is stale'), { code: 'RECOVERY_STALE' });
    const waiter = this.#recoveryWaiters.get(task.id);
    state.state = 'resolving'; state.userAction = action.action; state.revision++;
    this.#persist(); await this.flush();
    if (this.#storageError) throw Object.assign(new Error('Recovery action could not be persisted'), { code: 'STATE_WRITE_FAILED' });
    if (action.action === 'stop') return this.stopTask(task.id);
    waiter.resolve(); return this.snapshot();
  }
  #pauseRecovery(task, call, failure, category, reason) {
    task.recovery = { ...task.recovery, version: 1, id: task.recovery?.id ?? randomUUID(), revision: task.recovery?.revision ?? 0, attempts: task.recovery?.attempts ?? 0, waitMs: task.recovery?.waitMs ?? 0, actualWaitMs: task.recovery?.actualWaitMs ?? 0, phase: call?.purpose === 'consultation' ? 'consultation' : call?.takeoverPlanId ? 'takeover' : 'execution', sourceCallId: call?.id ?? null, originatingPurpose: call?.purpose === 'consultation' ? 'consultation' : 'execution', callId: null, category, failure };
    this.#transitionRecoveryPause(task, reason, { sourceCallId: call?.id ?? null, category });
  }
  #transitionRecoveryPause(task, reason, details = {}) {
    task.recovery.state = 'paused'; task.recovery.reason = reason; task.recovery.revision++;
    task.routingPauseReason = reason;
    task.timeline.push({ kind: 'recovery-paused', recoveryId: task.recovery.id, ...details, reason });
    this.#persist(); this.#recoveryWaiters.get(task.id)?.resolve();
  }
  #verifyRecoveryBoundary(agent, task, state, signal) {
    signal?.throwIfAborted();
    if (this.#storageError) throw new LlmError('Recovery storage is unavailable', 'STATE_WRITE_FAILED');
    if (state?.state === 'paused') throw new LlmError('Recovery has paused', state.reason);
    if (this.#active.get(`${task.sessionId}:${task.turn}`) !== task || task.nativeLifecycle || task.budget.stopRequested || task.recovery !== state || state.state === 'paused') throw new LlmError('Recovery is no longer live', 'RECOVERY_BOUNDARY_CHANGED');
    if (jsonHash(task.inputs) !== state.inputHash || (task.acceptance?.revision ?? null) !== state.acceptanceRevision || (task.acceptance?.requirementHash ?? null) !== state.requirementHash || (task.coordination?.revision ?? null) !== state.coordinationRevision) throw new LlmError('Recovery input or evidence changed', 'RECOVERY_INPUT_CHANGED');
    if (agent.inbox.nextStep.some(message => message.source?.kind === 'user')) throw new LlmError('Human input takes precedence', 'HUMAN_INPUT_PENDING');
    const step = this.#steps.get(agent);
    if (manualChanged(step, this.ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) throw new LlmError('Native selection takes precedence', 'NATIVE_SELECTION_CHANGED');
    if (!this.#state.config.automatic || this.#state.config.fixedCandidateId !== state.fixedCandidateId || jsonHash(this.#state.config.recovery) !== jsonHash(task.recoveryPolicy)) throw new LlmError('Recovery permission changed', 'RECOVERY_POLICY_CHANGED');
    const blocked = this.#restriction({ ...state.target?.identity, candidateId: state.target?.candidateId, selectionSnapshot: state.target });
    if (blocked) throw new LlmError('Recovery candidate changed', blocked);
    const call = task.calls.find(item => item.id === state.callId);
    const budgetTask = { ...task, calls: task.calls.filter(item => item !== call) };
    if (ledgerOf(budgetTask).unknownTokenCalls.total) throw new LlmError('Task usage became unknown', 'RECOVERY_USAGE_UNKNOWN');
    if (call) {
      const decision = budgetCheck(budgetTask, call);
      if (decision.unenforceable.some(item => item.resource !== 'durationMs')) throw new LlmError('Recovery budget cannot be proved', 'RECOVERY_BUDGET_UNPROVEN');
      if (call.recoveryBudgetApproved && call.status !== 'waiting' && decision.blocked.length) throw new LlmError('Recovery budget changed', 'RECOVERY_BUDGET_CHANGED');
    }
    if (state.portableHistory) this.#takeover.verifyHandoffHistory(agent, task, state.portableHistory);
    return task;
  }
  async #auditRecoveryFinal(request, agent, step, call) {
    const task = this.#state.tasks.find(item => item.id === call.taskId), state = task.recovery;
    const recheck = () => this.#verifyRecoveryBoundary(agent, task, state, request.signal);
    recheck();
    if (!isAgentLoopRequest(request) || !step.recovery?.boundModel || !sameIdentity(call.selection, state.target.identity) || !sameRoute(request, state.target.identity) || request.maxTokens !== state.maxTokens) throw new LlmError('The native recovery owner changed', 'RECOVERY_FINAL_REQUEST_CHANGED');
    const proof = await this.#takeover.auditHandoffRequest({ request, agent, target: state.target, model: step.recovery.boundModel, maxTokens: state.maxTokens, forecastTokens: state.forecastTokens, history: state.portableHistory, signal: request.signal, recheck, native: true });
    recheck();
    if (jsonHash(proof.imageForecast) !== jsonHash(state.imageForecast)) throw new LlmError('Retained image pricing changed', 'RECOVERY_IMAGE_FORECAST_CHANGED');
    state.finalCursor = proof.sessionProof.cursor;
    state.finalRequest = { nativeRequest: true, taskId: task.id, sessionId: task.sessionId, turn: task.turn, step: call.step, callId: call.id, provider: request.provider, model: request.model, maxTokens: request.maxTokens, messages: proof.messages, tools: structuredClone(request.tools ?? []), toolHistory: structuredClone(request.toolHistory ?? null), system: request.system ?? null, prepared: step.recovery.boundModel, sessionProof: proof.sessionProof };
    state.revision++; this.#persist(); await this.flush(); recheck();
  }
  async #auditConsultationFinal(request, agent, owner) {
    const task = owner.task, state = task.recovery, call = owner.call;
    const recheck = () => this.#verifyRecoveryBoundary(agent, task, state, request.signal);
    recheck();
    if (!owner.recoveryBoundModel || this.#ownedRequests.get(request) !== owner || state.callId !== call.id || !sameRoute(request, state.target.identity) || request.maxTokens !== state.maxTokens || call.reservation.tokens.output !== state.maxTokens || call.reservation.tokens.total !== state.forecastTokens || call.reservation.tokens.input !== state.forecastTokens - state.maxTokens || jsonHash({ messages: request.messages, maxTokens: request.maxTokens, tools: request.tools ?? [], system: request.system ?? null }) !== state.requestHash) throw new LlmError('The consultation intent or prepared handle changed', 'RECOVERY_FINAL_REQUEST_CHANGED');
    const history = await this.#takeover.captureHandoffHistory(agent, task, request.signal, recheck);
    recheck();
    const proof = await this.#takeover.auditHandoffRequest({ request, agent, target: state.target, model: owner.recoveryBoundModel, maxTokens: state.maxTokens, forecastTokens: state.forecastTokens, history: state.boundedHistory, signal: request.signal, recheck });
    recheck();
    state.finalCursor = history.sessionProof.cursor;
    state.finalRequest = { nativeRequest: false, ownedRequest: true, taskId: task.id, sessionId: task.sessionId, turn: task.turn, callId: call.id, provider: request.provider, model: request.model, maxTokens: request.maxTokens, messages: proof.messages, prepared: owner.recoveryBoundModel, sessionProof: history.sessionProof };
    state.revision++; this.#persist(); await this.flush(); recheck();
  }
  async #waitRecovery(agent, task, state, signal, delayMs) {
    this.#verifyRecoveryBoundary(agent, task, state, signal);
    if (delayMs > RECOVERY_LIMITS.delayMs || state.waitMs + delayMs > RECOVERY_LIMITS.totalWaitMs) throw new LlmError('Recovery wait allowance exceeded', 'RECOVERY_WAIT_LIMIT');
    const started = Date.now();
    try {
    state.state = 'backoff'; state.waitMs += delayMs; state.deadline = Date.now() + delayMs; state.revision++; task.lifecycle = 'waiting-recovery'; this.#persist(); await this.flush();
    this.#verifyRecoveryBoundary(agent, task, state, signal);
    while (Date.now() < state.deadline) {
      const waiting = Promise.withResolvers(); this.#recoveryWaiters.set(task.id, waiting);
      const timer = setTimeout(waiting.resolve, Math.max(1, state.deadline - Date.now()));
      const abort = () => waiting.reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try { signal.throwIfAborted(); await waiting.promise; }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); this.#recoveryWaiters.delete(task.id); }
      this.#verifyRecoveryBoundary(agent, task, state, signal);
    }
    } finally { state.actualWaitMs += Math.max(0, Date.now() - started); }
  }
  async #waitForManualRecovery(agent, task, state, signal) {
    state.state = 'waiting-user'; state.reason = 'RECOVERY_MANUAL_REQUIRED'; state.revision++; task.lifecycle = 'waiting-recovery';
    while (!state.userAction) {
      const waiter = Promise.withResolvers(); this.#recoveryWaiters.set(task.id, waiter);
      const abort = () => waiter.reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      try { this.#persist(); await this.flush(); this.#verifyRecoveryBoundary(agent, task, state, signal); await waiter.promise; }
      finally { signal.removeEventListener('abort', abort); this.#recoveryWaiters.delete(task.id); }
      this.#verifyRecoveryBoundary(agent, task, state, signal);
    }
    if (state.userAction !== 'retry-current') throw new LlmError('Recovery was stopped', 'RECOVERY_STOPPED');
    state.reason = null;
  }
  async requestSemanticAssessment() {
    if (!this.#state.config.automatic || !this.#state.config.semanticAssessment) throw new TypeError('Enable automatic routing and semantic assessment before requesting a Task assessment');
    this.#state.semanticAssessmentRequest = { status: 'armed', requestedAt: new Date().toISOString() };
    this.#persist();
    await this.flush();
    if (this.#storageError) throw new Error('Router storage is unavailable; the assessment request was not persisted');
    return this.snapshot();
  }
  async previewCalibrationBudget() {
    await this.#refreshEligibility();
    const candidateSnapshot = this.#connections.snapshot(this.#state.config);
    const requirements = { modalities: ['text'] };
    const forecast = selectionForecast(requirements, 128);
    const decision = selectInitialRoute({ task: { requirements }, candidateSnapshot, forecastsByCandidate: Object.fromEntries(candidateSnapshot.candidates.map(candidate => [candidate.candidateId, forecast])) });
    const excluded = new Set(decision.excluded.map(item => item.candidateId));
    const eligible = candidateSnapshot.candidates.filter(candidate => !excluded.has(candidate.candidateId));
    const money = new Map();
    let unknownPriceCandidates = 0;
    for (const candidate of eligible) {
      const cost = costOf(tokensOf(forecast), candidate.quote);
      if (cost.amount === null || !cost.currency || !cost.kind) { unknownPriceCandidates += 1; continue; }
      const key = `${cost.currency}:${cost.kind}`;
      const current = money.get(key) ?? { currency: cost.currency, kind: cost.kind, amount: 0 };
      current.amount += cost.amount;
      money.set(key, current);
    }
    this.#state.calibrationPreview = {
      status: 'authorization-required', candidateSnapshotEpoch: candidateSnapshot.snapshotEpoch,
      budgetEstimate: { calls: eligible.length, totalTokens: eligible.length * forecast.totalTokens, money: [...money.values()], unknownPriceCandidates },
      excluded: decision.excluded, createdAt: new Date().toISOString(),
    };
    this.#persist(); await this.flush();
    return this.snapshot();
  }
  async #change(change) {
    if (this.#storageError) throw new Error('Router storage is unavailable; repair DSH-local storage before changing settings');
    this.#state.config = { ...this.#state.config, ...change, version: this.#state.config.version + 1 };
    this.#persist();
    await this.flush();
    if (this.#storageError) throw new Error('Router storage is unavailable; the settings change was not persisted');
    if (['automatic', 'fixedCandidateId', 'pool', 'takeover', 'recovery'].some(key => Object.hasOwn(change, key))) {
      this.#wakeTakeoverWaiters();
    }
    return this.snapshot();
  }
  #wakeTakeoverWaiters(sessionId) {
    for (const task of this.#active.values()) if (!sessionId || task.sessionId === sessionId) this.#recoveryWaiters.get(task.id)?.resolve();
    for (const task of this.#active.values()) if (!sessionId || task.sessionId === sessionId) for (const call of task.calls) if ((call.takeoverPlanId || call.recoveryId) && call.reservation?.state === 'waiting') this.#waiters.get(call.id)?.resolve();
  }
  async flush() { await this.#writes; }
  async commitState() {
    this.#persist(); await this.flush();
    if (this.#storageError) throw new Error('Router storage is unavailable; the connection change was not persisted');
  }
  #persist() {
    if (this.#storageError) return;
    const serialized = JSON.stringify(this.#state, null, 2);
    this.#writes = this.#writes.then(async () => {
      // An earlier queued write may have failed since this snapshot was queued.
      if (this.#storageError) return;
      const temporary = `${this.#path}.tmp`;
      await this.#files.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      await this.#files.rename(temporary, this.#path);
    }).catch(() => {
      this.#storageError = 'STATE_WRITE_FAILED';
      this.#state.config.automatic = false;
      for (const task of this.#active.values()) { task.lifecycle = 'paused'; task.pauseReason = 'STATE_WRITE_FAILED'; }
      for (const waiter of this.#waiters.values()) waiter.reject(new LlmError('Router budget state could not be persisted', 'MODEL_NOT_FOUND'));
      for (const waiter of this.#recoveryWaiters.values()) waiter.reject(new LlmError('Router recovery state could not be persisted', 'STATE_WRITE_FAILED'));
    });
  }
  #observe(session, event) {
    if (event.type === 'request/header') {
      const reservation = this.#nativeReservations.get(this.ctx.get('agents')?.get(session.id));
      const task = reservation && this.#active.get(`${session.id}:${reservation.turn}`);
      const call = task?.id === reservation?.taskId && task?.calls.find(call => call.id === reservation.callId);
      if (call) { this.#confirm(task, event.data.header.config, call); this.#persist(); }
      return;
    }
    if (event.type === 'turn/start') {
      const assessmentRequested = this.#state.semanticAssessmentRequest?.status === 'armed';
      if (assessmentRequested) this.#state.semanticAssessmentRequest = null;
      const deepSeekDetection = this.#deepSeekDetections.get(session.id);
      const chatGptDetection = this.#chatGptDetections.get(session.id);
      const goDetection = this.#goDetections.get(session.id);
      const compatibleDetection = this.#compatibleDetections.get(session.id);
      const detection = deepSeekDetection ?? chatGptDetection ?? goDetection ?? compatibleDetection;
      const task = { id: randomUUID(), sessionId: session.id, turn: event.data.turn, lifecycle: 'running', acceptance: { verdict: 'unconfirmed', evidence: [] }, acceptancePolicy: structuredClone(this.#state.config.acceptance), coordinationPolicy: freezeCoordinationPolicy(this.#state.config, this.#connections), coordination: null, takeoverPolicy: { ...structuredClone(this.#state.config.takeover), objective: this.#state.config.routingObjective, fixedCandidateId: this.#state.config.fixedCandidateId }, takeover: null, executionOwner: null, plannedSelection: null, activeSelection: null, configVersion: this.#state.config.version, assessmentRequested, requirements: { modalities: ['text'], contextBytes: 0 }, result: '', calls: [], inputs: [], timeline: [], startedAt: new Date(detection?.startedAt ?? Date.now()).toISOString(), budget: { limits: structuredClone(detection?.budget ?? this.#state.config.budget), extensions: [], unenforceableLimits: [] }, ...(deepSeekDetection ? { deepSeekDetection: { capture: structuredClone(detection.capture), outputTokens: DEEPSEEK_DETECTION_OUTPUT_TOKENS } } : {}), ...(chatGptDetection ? { chatGptDetection: { capture: structuredClone(detection.capture), outputForecastTokens: detection.outputForecastTokens, maxCalls: detection.maxCalls } } : {}) };
      task.recoveryPolicy = structuredClone(this.#state.config.recovery); task.recoveryOwned = this.#state.config.automatic && task.recoveryPolicy.enabled && !detection; task.recovery = null;
      if (detection) {
        if (goDetection) task.openCodeGoDetection = { capture: structuredClone(detection.capture), outputTokens: detection.outputTokens, outputForecastTokens: detection.outputForecastTokens, maxCalls: detection.maxCalls };
        if (compatibleDetection) task.compatibleDetection = { capture: structuredClone(detection.capture), outputTokens: detection.outputTokens, outputForecastTokens: detection.outputForecastTokens, maxCalls: detection.maxCalls };
        detection.taskId = task.id;
      }
      this.#active.set(`${session.id}:${event.data.turn}`, task);
      this.#state.tasks.push(task);
      if (detection) this.#armDetectionDeadline(task);
      this.#persist();
      return;
    }
    const task = this.#active.get(`${session.id}:${event.data.turn}`);
    if (!task) return;
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const call = this.#inflight.get(session.id);
      if (!call || call.taskId !== task.id || call.step !== event.data.step || call.settlementSeq !== undefined) return;
      // Unchanged requests inherit the previous durable header.
      this.#confirm(task, session.requestHeader().config, call);
      if (event.type === 'assistant/message') task.result += event.data.message.content.filter(item => item.type === 'text').map(item => item.text).join('');
      const finish = lastAssistantStreamChunk(event.data.stream ?? [], 'finish')?.reason;
      const deadlineExpired = detectionOf(task)?.deadlineExpired === true;
      this.settleCall(task.id, call.id, { status: call.takeoverPlanId && !possiblyDispatched(call) ? 'not-dispatched' : deadlineExpired || event.data.interrupted || finish?.kind === 'max-tokens' || finish?.kind === 'aborted' || finish?.failure?.code === 'ABORTED' ? 'interrupted' : event.type === 'assistant/attempt' || finish?.kind === 'error' ? 'failed' : 'completed', usage: event.data.usage ?? lastAssistantStreamChunk(event.data.stream ?? [], 'usage')?.usage ?? null, seq: event.seq, finishReason: deadlineExpired ? 'aborted' : finish?.kind ?? (event.data.interrupted ? 'aborted' : event.type === 'assistant/attempt' ? 'unknown' : 'stop'), failureCode: deadlineExpired ? 'ABORTED' : finish?.failure?.code, failure: finish?.failure });
      if (call.takeoverPlanId === task.takeover?.plan.id && ['failed', 'interrupted'].includes(call.status) && ['dispatch-started', 'dispatched'].includes(task.takeover.plan.state)) {
        recordTakeoverStage(task.takeover, task.executionOwner?.confidence === 'response-observed' ? 'interrupted' : 'dispatch-unknown', 'TARGET_RESPONSE_NOT_COMPLETED');
        task.routingPauseReason = 'TAKEOVER_TARGET_RESPONSE_FAILED';
      }
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason;
      if (reason?.error && task.recoveryOwned && !detectionOf(task) && (!task.recovery || task.recovery.state === 'completed') && !task.routingPauseReason) {
        const reservation = this.#nativeReservations.get(this.ctx.get('agents')?.get(session.id));
        const call = reservation?.taskId === task.id ? task.calls.find(item => item.id === reservation.callId) : null;
        const facts = failureFacts(reason.error), category = classifyFailure(facts);
        if (call && call.status !== 'completed') { call.failure = facts; call.failureCode = facts.code; }
        this.#pauseRecovery(task, call, facts, category, category === 'authorization' ? 'RECOVERY_REAUTHORIZE_REQUIRED' : category === 'quota' ? 'RECOVERY_QUOTA_REQUIRED' : 'RECOVERY_PLUGIN_EXCEPTION');
      }
      if (task.recovery && !['paused', 'completed'].includes(task.recovery.state)) {
        if (reason?.error) {
          const source = task.calls.find(item => item.id === task.recovery.sourceCallId);
          this.#pauseRecovery(task, source, task.recovery.failure, task.recovery.category, reason.error.code ?? 'RECOVERY_PLUGIN_EXCEPTION');
        } else {
          this.#transitionRecoveryPause(task, task.budget.stopRequested ? 'RECOVERY_STOPPED' : reason?.kind === 'completed' ? 'RECOVERY_NATIVE_ENDED' : 'RECOVERY_CANCELED');
        }
      }
      task.nativeLifecycle = reason?.kind === 'completed' && !this.#storageError ? 'completed' : 'paused';
      task.nativeEndedAt = new Date().toISOString();
      if (task.takeover && ['dispatch-started', 'dispatched'].includes(task.takeover.plan.state) && reason?.kind !== 'completed') recordTakeoverStage(task.takeover, task.executionOwner?.confidence === 'response-observed' ? 'interrupted' : 'dispatch-unknown', 'TARGET_RESPONSE_NOT_COMPLETED');
      if (task.takeover && ['intent-persisted', 'notice-delivered', 'prepared', 'call-reserved', 'dispatch-intent'].includes(task.takeover.plan.state)) recordTakeoverStage(task.takeover, 'refused', task.budget.stopRequested ? 'BUDGET_STOPPED' : task.routingPauseReason ?? reason?.error?.code ?? 'TAKEOVER_NOT_DISPATCHED');
      if (task.nativeLifecycle === 'paused') {
        task.nativePauseReason = this.#storageError ?? (task.budget.stopRequested ? 'BUDGET_STOPPED' : null) ?? task.routingPauseReason ?? reason?.error?.code ?? reason?.kind ?? 'UNKNOWN_TERMINAL';
        const reservation = this.#nativeReservations.get(this.ctx.get('agents')?.get(session.id));
        const call = reservation?.taskId === task.id && task.calls.find(call => call.id === reservation.callId);
        if (call && ['prepared', 'waiting'].includes(call.status)) { call.status = call.dispatchStarted ? 'failed' : 'not-dispatched'; call.reservation.state = 'released'; }
        this.#cancelTaskCalls(task);
      }
      task.timeline.push({ kind: 'native-terminal', lifecycle: task.nativeLifecycle, reason: task.nativePauseReason ?? 'response-completed' });
      this.#finishTask(task);
    }
    this.#persist();
  }
  #confirm(task, config, call) {
    const header = { provider: config.provider, model: config.model };
    task.activeSelection ??= selection(config);
    if (call) {
      if (!sameRoute(call.selection, header)) {
        task.routingPauseReason = 'REQUEST_SELECTION_MISMATCH';
        call.failureCode = 'REQUEST_SELECTION_MISMATCH';
      }
      call.dispatchState = 'header-confirmed';
      call.hostConfig = { ...config };
    }
  }
}

export async function apply(ctx) {
  const home = ctx.profileContext.home;
  if (typeof home !== 'string' || !home) throw new Error('Router requires a DSH profileContext.home');
  const directory = join(home, 'router', ctx.profileContext.name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid DSH Router state; restore state.json before enabling the plugin'); }
  state ??= { schemaVersion: 1, config: { automatic: true, version: 1 }, tasks: [] };
  if (state.schemaVersion !== 1 || typeof state.config?.automatic !== 'boolean' || !Number.isSafeInteger(state.config?.version) || state.config.version < 1 || !Array.isArray(state.tasks)) throw new Error('Unsupported DSH Router state schema');
  state.config.pool ??= defaultPool();
  state.config.fixedModel ??= null;
  state.config.fixedCandidateId ??= state.config.fixedModel;
  state.config.prices ??= [];
  state.config.budget ??= emptyBudget();
  state.config.routingObjective ??= 'balanced';
  state.config.semanticAssessment ??= false;
  state.config.acceptance ??= defaultAcceptancePolicy();
  state.config.coordination ??= defaultCoordinationPolicy();
  state.config.takeover ??= defaultTakeoverPolicy();
  state.config.recovery ??= defaultRecoveryPolicy();
  state.semanticAssessmentRequest ??= null;
  if (!ROUTING_OBJECTIVES.has(state.config.routingObjective) || typeof state.config.semanticAssessment !== 'boolean' || !acceptancePolicySchema().safeParse(state.config.acceptance).success || !coordinationPolicySchema().safeParse(state.config.coordination).success || !takeoverPolicySchema().safeParse(state.config.takeover).success || !recoveryPolicySchema().safeParse(state.config.recovery).success) throw new Error('Unsupported DSH Router routing configuration');
  if (state.semanticAssessmentRequest !== null && (state.semanticAssessmentRequest?.status !== 'armed' || typeof state.semanticAssessmentRequest.requestedAt !== 'string')) throw new Error('Unsupported DSH Router assessment request');
  if (!budgetSchema().safeParse(state.config.budget).success) throw new Error('Unsupported DSH Router budget');
  if (new Set(state.config.budget.money.map(item => `${item.currency}:${item.kind}`)).size !== state.config.budget.money.length) throw new Error('Duplicate DSH Router budget limits');
  if (!Array.isArray(state.config.prices) || !state.config.prices.every(item => typeof item.provider === 'string' && item.provider && typeof item.model === 'string' && item.model && quoteSchema().safeParse(item.quote).success && (item.provider !== CONTROLLED_PROVIDER || item.quote.kind === 'fixture-reference'))) throw new Error('Unsupported DSH Router prices');
  let recoveredCoordination = false;
  for (const task of state.tasks) {
    if (recoverPendingRecovery(task)) recoveredCoordination = true;
    if (recoverPendingTakeover(task)) recoveredCoordination = true;
    if (task.coordination !== undefined && task.coordination !== null) {
      const recovery = recoverPendingCoordination(task.coordination, task.acceptance?.revision ?? task.coordination.acceptanceRevision);
      if (recovery.changed) {
        task.coordination = recovery.coordination;
        task.timeline ??= [];
        task.timeline.push({ kind: 'coordination-recovered', revision: recovery.coordination.revision, acceptanceRevision: recovery.coordination.acceptanceRevision });
        recoveredCoordination = true;
      }
    }
    if (task.budget?.unenforceableLimits) task.budget.unenforceableLimits = task.budget.unenforceableLimits.map(value => normalizeBudgetConstraint(value, true));
    if (task.budget?.waiting?.blockedBy) task.budget.waiting.blockedBy = task.budget.waiting.blockedBy.map(value => normalizeBudgetConstraint(value));
    for (const event of task.timeline ?? []) if (event.kind === 'budget-wait' && event.blockedBy) event.blockedBy = event.blockedBy.map(value => normalizeBudgetConstraint(value));
    // 0.3.0 may have persisted its own mistaken zero-consumption restart classification.
    if (task.lifecycle === 'paused' && task.pauseReason === 'HOST_RESTARTED') {
      for (const call of task.calls) if (call.status === 'not-dispatched' && legacyDispatchIsAmbiguous(call)) {
        call.dispatchUncertain = true; call.status = 'interrupted';
        if (!call.usage) call.cost = costOf(tokensOf(null), call.priceQuote);
      }
    }
  }
  for (const task of state.tasks) if (['running', 'waiting-budget', 'waiting-recovery'].includes(task.lifecycle)) {
    task.lifecycle = 'paused'; task.pauseReason = 'HOST_RESTARTED'; task.endedAt = new Date().toISOString();
    for (const call of task.calls) if (['prepared', 'waiting'].includes(call.status)) {
      // 0.3.0 header-confirmed calls had no durable dispatch gate; their state is ambiguous.
      if (call.status === 'prepared' && legacyDispatchIsAmbiguous(call)) call.dispatchUncertain = true;
      call.status = possiblyDispatched(call) ? 'interrupted' : 'not-dispatched';
      if (call.reservation) call.reservation.state = 'released';
      if (possiblyDispatched(call) && !call.usage) call.cost = costOf(tokensOf(null), call.priceQuote);
    }
  }
  ctx.llm.registerAdapter([CONTROLLED_PROVIDER], new ControlledAdapter());
  const connections = new ConnectionRegistry(ctx, state, () => state.config);
  const disposeControlled = connections.registerControlledFixture({
    provider: CONTROLLED_PROVIDER,
    connectionId: 'controlled-local',
    accountId: 'local',
    billingPath: 'controlled',
    ownership: 'router-owned',
    source: 'controlled-protocol-fixture',
    sourceKey: 'router-controlled:v1',
    configRevision: 1,
    configured: true,
    candidateIds: Object.fromEntries(catalog.map(model => [model.model, model.model])),
    models: catalog.map(model => ({ ...model, maxContextTokens: 32768 })),
  });
  await connections.refresh();
  const pool = state.config.pool;
  for (const entry of pool ?? []) if (!entry.candidateId && entry.provider === CONTROLLED_PROVIDER && catalog.some(model => model.model === entry.model)) entry.candidateId = entry.model;
  for (const item of state.config.prices) {
    if (!item.candidateId && item.provider === CONTROLLED_PROVIDER && catalog.some(model => model.model === item.model)) item.candidateId = item.model;
  }
  const validEntry = entry => entry && typeof entry.enabled === 'boolean' && (() => { try { const candidate = connections.resolve(entry.candidateId, { allowLegacyControlled: false }); return sameIdentity(entry, candidate); } catch { return false; } })();
  if (!Array.isArray(pool) || !pool.every(validEntry) || new Set(pool.map(entry => entry.candidateId)).size !== pool.length || (state.config.fixedCandidateId !== null && (() => { try { connections.resolve(state.config.fixedCandidateId); return true; } catch { return false; } })() === false)) throw new Error('Unsupported DSH Router pool configuration');
  const service = new RouterService(ctx, state, path, connections, ctx.get('routerFileSystem'));
  if (recoveredCoordination) await service.commitState();
  const deepSeek = new DeepSeekHost(ctx, state, service.commitState);
  service.attachDeepSeek(deepSeek);
  await deepSeek.restore();
  const chatGpt = new ChatGptHost(ctx, state, service.commitState, {
    mountConnection: mountChatGptRouterConnection,
    ...(ctx.get('routerChatGptTransport') ? { transport: ctx.get('routerChatGptTransport') } : {}),
    ...(ctx.get('routerChatGptEndpoints') ? { endpoints: ctx.get('routerChatGptEndpoints') } : {}),
    ...(ctx.get('routerChatGptTimeoutMs') ? { timeoutMs: ctx.get('routerChatGptTimeoutMs') } : {}),
  });
  service.attachChatGpt(chatGpt);
  await chatGpt.initialize();
  const openCodeGo = new OpenCodeGoHost(ctx, state, service.commitState);
  service.attachOpenCodeGo(openCodeGo);
  await openCodeGo.restore();
  const compatible = new CompatibleHost(ctx, state, service.commitState);
  service.attachCompatible(compatible);
  await compatible.restore();
  const programChecks = createNodeProgramChecks(ctx);
  const researchAcceptance = createResearchAcceptance({ resolveSourceEvidence: ctx.get('routerResearchSourceEvidence') ?? createHttpSourceEvidenceResolver() });
  const imageAcceptance = createImageAcceptance();
  const coordination = new TaskCoordinationController({
    router: service,
    policyForTask: task => ({
      ...structuredClone(task.coordinationPolicy),
      forecast: { totalTokens: task.coordinationPolicy?.forecastTokens },
    }),
  });
  new AcceptanceCoordinator(ctx, {
    publishAcceptance: service.publishAcceptance,
    captureCandidate: service.captureCandidate,
    checks: { ...programChecks.checks, resolvePlan: async request => { await service.flush(); return programChecks.checks.resolvePlan(request); } },
    contributors: [{
      domain: 'research',
      contribute: request => researchAcceptance.contribute(request),
      validate: (value, context) => validateResearchContribution(value, context),
    }, {
      domain: 'image',
      contribute: request => imageAcceptance.contribute(request),
      validate: (value, context) => validateImageContribution(value, context),
    }],
    policyForTask: task => ({
      enabled: task.acceptancePolicy?.enabled === true,
      review: {
        enabled: task.acceptancePolicy?.review?.enabled === true,
        candidateId: task.acceptancePolicy?.review?.candidateId ?? null,
        allowCrossModelReview: task.acceptancePolicy?.review?.allowCrossModel === true,
        maxTokens: task.acceptancePolicy?.review?.maxTokens,
        forecast: { totalTokens: task.acceptancePolicy?.review?.forecastTokens },
      },
    }),
    afterAssessment: payload => service.exactTask(payload.agent.session.id, payload.turn)?.takeover ? service.completeTakeover(payload).then(() => coordination.afterAcceptance(payload)) : coordination.afterAcceptance(payload),
  });
  ctx.on('llm/adapters-updated', () => { void service.refreshConnections().catch(() => {}); });
  ctx.on('settings/document-updated', (namespace, revision) => { connections.invalidateSettings(namespace, revision); void service.refreshConnections().catch(() => {}); });
  ctx.on('credentials/reference-updated', () => { connections.invalidateCredentials(); void service.refreshConnections().catch(() => {}); });
  ctx.on('credentials/record-updated', () => { connections.invalidateCredentials(); void service.refreshConnections().catch(() => {}); });
  ctx.effect(() => disposeControlled, 'router: owned connection registration');
  ctx.effect(() => () => deepSeek.dispose(), 'router: DeepSeek connection lifecycle');
  ctx.effect(() => () => chatGpt.dispose(), 'router: ChatGPT connection lifecycle');
  ctx.effect(() => () => openCodeGo.dispose(), 'router: OpenCode Go connection lifecycle');
  ctx.effect(() => () => compatible.dispose(), 'router: compatible connection lifecycle');
  ctx.effect(() => () => programChecks.dispose(), 'router: acceptance program checks');
  // Registration is owned by this plugin fiber; disabling releases the provider without touching native defaults.
}
