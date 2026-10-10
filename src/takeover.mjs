import { createHash, randomUUID } from 'node:crypto';
import { boundContextSummary, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm';
import { sameIdentity } from './connections.mjs';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import { foldSurface, deriveEventMessage } from '@deepseek-ai/dsh-session/surface';
import { currentSessionMessageProjections } from '@deepseek-ai/dsh-session-format-catalog/message-projections';
import { z } from 'zod';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const takeoverReason = (error, signal) => signal?.aborted ? 'TAKEOVER_CANCELED' : typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(error.code) ? error.code : 'TAKEOVER_UNAVAILABLE';
const toolSchema = definition => ({ name: definition.name, description: definition.description, parameters: definition.parameters, ...(definition.deferLoading ? { deferLoading: true } : {}) });
const planStates = ['intent-persisted', 'notice-delivered', 'prepared', 'call-reserved', 'dispatch-intent', 'dispatch-started', 'dispatched', 'completed', 'interrupted', 'refused', 'stale', 'delivery-unknown', 'dispatch-unknown'];
const planSchema = z.object({
  id: z.string().min(1), state: z.enum(planStates), reason: z.string().nullable(),
  episodeId: z.string().min(1), evidenceVersion: z.number().int().positive(), evidenceFingerprint: z.string().min(1),
  acceptanceRevision: z.number().int().positive(), requirementHash: z.string().min(1), coordinationRevision: z.number().int().positive(),
  source: z.json().nullable(), target: z.json().nullable(), policy: z.json(),
  portableHistory: z.json().nullable(), noticeMessageId: z.string().nullable(), callId: z.string().nullable(),
  finalRequestHash: z.string().nullable(), forecast: z.json().nullable(),
  imageForecast: z.json().nullable(),
  finalRequest: z.json().nullable(),
  acceptanceVerdict: z.enum(['passed', 'failed', 'unconfirmed']).nullable(),
}).strict();
export const takeoverSchema = z.object({ version: z.literal(1), revision: z.number().int().positive(), attempts: z.number().int().nonnegative().max(1), plan: planSchema, timeline: z.array(z.object({ sequence: z.number().int().positive(), kind: z.enum(planStates), planId: z.string(), reason: z.string().nullable(), callId: z.string().nullable() }).strict()) }).strict();
export function recordTakeoverStage(state, kind, reason = null) {
  state.revision++;
  state.plan.state = kind; state.plan.reason = reason;
  state.timeline.push({ sequence: state.timeline.length + 1, kind, planId: state.plan.id, reason, callId: state.plan.callId });
  takeoverSchema.parse(state);
}
export function recoverPendingTakeover(task) {
  if (!task.takeover) return false;
  const state = takeoverSchema.parse(clone(task.takeover));
  if (!['intent-persisted', 'notice-delivered', 'prepared', 'call-reserved', 'dispatch-intent', 'dispatch-started', 'dispatched'].includes(state.plan.state)) return false;
  const call = task.calls.findLast(item => item.takeoverPlanId === state.plan.id);
  const possible = Boolean(call?.dispatchStarted || call?.dispatchIntent === 'possible' || call?.dispatchUncertain);
  const observed = possible && task.executionOwner?.callId === call.id && task.executionOwner.confidence === 'response-observed';
  recordTakeoverStage(state, possible ? observed ? 'interrupted' : 'dispatch-unknown' : 'delivery-unknown', possible ? 'RESTART_AFTER_POSSIBLE_TAKEOVER_DISPATCH' : 'RESTART_WITH_UNCONFIRMED_TAKEOVER');
  task.takeover = state;
  task.routingPauseReason = possible ? 'TAKEOVER_DISPATCH_UNKNOWN' : 'TAKEOVER_DELIVERY_UNKNOWN';
  if (possible && !observed) task.executionOwner = { candidateId: call.candidateId ?? null, identity: clone(call.selection), callId: call.id, turn: task.turn, step: call.step, confidence: 'possible' };
  task.timeline ??= [];
  task.timeline.push({ kind: 'takeover-recovered', revision: state.revision, state: state.plan.state, reason: state.plan.reason });
  return true;
}

function portableMessages(messages) {
  return messages.map(message => {
    if (message.source?.replayState !== undefined) throw new LlmError('Private replay cannot be proven portable', 'TAKEOVER_PRIVATE_REPLAY_UNSUPPORTED');
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) throw new LlmError('Unknown conversation role', 'TAKEOVER_HISTORY_FORMAT_UNSUPPORTED');
    for (const part of message.content ?? []) {
      if (!['text', 'reasoning', 'image', 'tool-call', 'tool-addition', 'tool-removal'].includes(part.type)) throw new LlmError('This history format is not yet portable', 'TAKEOVER_HISTORY_FORMAT_UNSUPPORTED');
      if (part.type === 'image' && (part.offloaded || !part.attachment?.attachmentId)) throw new LlmError('Image content is unavailable', 'TAKEOVER_IMAGE_NOT_PORTABLE');
    }
    return { id: message.id, role: message.role, content: clone(message.content), sourceKind: message.source?.kind ?? null, ...(message.toolCallId ? { toolCallId: message.toolCallId, isError: Boolean(message.isError) } : {}) };
  });
}
function portableHistory(agent, task, receiptForCall, receiptsForSession, verifyReceipt) {
  if (agent.session.surface.contentGeneration !== 0) throw new LlmError('Changed history cannot be proven complete', 'TAKEOVER_HISTORY_PROJECTED');
  const messages = portableMessages(agent.session.deriveMessages());
  for (const input of task.inputs) {
    const message = messages.find(item => item.id === input.messageId);
    if (!message || hash(message.content) !== input.contentHash) throw new LlmError('An original Task input is absent or changed', 'TAKEOVER_INPUT_HISTORY_CHANGED');
  }
  const images = messages.flatMap(message => message.content.filter(part => part.type === 'image').map(part => ({ messageId: message.id, attachment: clone(part.attachment) })));
  for (const image of task.acceptance.image?.images ?? []) if (!images.some(item => item.messageId === image.origin.messageId && hash(item.attachment) === hash(image.attachment))) throw new LlmError('Bound input image is absent', 'TAKEOVER_IMAGE_BINDING_CHANGED');
  const observedReceipts = receiptsForSession(task.sessionId);
  if (observedReceipts.some(receipt => receipt.outcome !== 'completed')) throw new LlmError('An operation in the execution tree has unknown outcome', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
  const pending = new Map(), receipts = [], ids = new Set();
  for (const message of messages) {
    for (const part of message.content.filter(item => item.type === 'tool-call')) {
      if (ids.has(part.id) || message.role !== 'assistant') throw new LlmError('Tool call identities are not portable', 'TAKEOVER_TOOL_HISTORY_INVALID');
      ids.add(part.id);
      let args;
      try { args = JSON.parse(part.arguments); } catch { throw new LlmError('Tool arguments are invalid', 'TAKEOVER_TOOL_HISTORY_INVALID'); }
      pending.set(part.id, { part, args });
    }
    if (message.role !== 'tool') continue;
    const issued = pending.get(message.toolCallId), receipt = receiptForCall(task.sessionId, message.toolCallId);
    if (!issued || !receipt || receipt.name !== issued.part.name || receipt.argsHash !== hash(issued.args) || receipt.resultHash !== hash(message.content)) throw new LlmError('A tool receipt cannot be proved complete', 'TAKEOVER_TOOL_RECEIPT_UNKNOWN');
    if (message.isError || receipt.outcome !== 'completed') throw new LlmError('A completed tool outcome is unknown', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    verifyReceipt(agent, receipt);
    if (!receipt.operation) throw new LlmError('Tool operation semantics are unknown', 'TAKEOVER_TOOL_OPERATION_UNKNOWN');
    pending.delete(message.toolCallId); receipts.push(clone(receipt));
  }
  if (pending.size) throw new LlmError('A tool operation has not settled', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
  if (observedReceipts.some(receipt => !receipts.some(portable => portable.callId === receipt.callId))) throw new LlmError('A nested execution receipt cannot be represented by this portable protocol', 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED');
  return { version: 1, messages, images, toolReceipts: receipts, toolHistory: clone(agent.session.toolHistory()), hash: hash(messages), contentGeneration: 0, requirementHash: task.acceptance.requirementHash, inputHash: hash(task.inputs) };
}
function containsHistory(messages, portable) {
  let index = 0;
  for (const message of portableMessages(messages)) {
    if (message.id !== portable.messages[index]?.id) continue;
    if (hash(message) !== hash(portable.messages[index])) return false;
    index++;
  }
  return index === portable.messages.length;
}
const sameCapture = (left, right) => left?.enabled && sameIdentity(left.identity, right?.identity) && left.authEpoch === right.authEpoch && left.connectionConfigRevision === right.connectionConfigRevision && hash(left.handoff) === hash(right.handoff);
const modelFacts = model => ({ context: model.context ?? null, inputModalities: model.inputModalities ?? null, systemPromptUpdate: model.systemPromptUpdate ?? null, toolUpdate: model.toolUpdate ?? null });

/** Owns the durable handoff proof. It never creates or dispatches an LLM request. */
export class TaskTakeoverController {
  #router; #llm; #live; #turn; #manual; #attachments; #tools; #query; #toolBindings = new Map(); #toolAncestry = new Map(); #toolOwners = new Map(); #pendingOperations = new Map();
  #catalog = currentSessionMessageProjections.map(definition => ({ definition, type: definition.type, project: definition.project }));
  constructor({ router, llm, live, turnForAgent, manualForAgent, attachments, tools, sessionQuery }) { this.#router = router; this.#llm = llm; this.#live = live; this.#turn = turnForAgent; this.#manual = manualForAgent; this.#attachments = attachments; this.#tools = tools; this.#query = sessionQuery; }
  async plan({ agent, signal, task, acceptance, episode }) {
    const policy = task.takeoverPolicy;
    if (!policy?.enabled) return { kind: 'none', reason: 'TAKEOVER_DISABLED' };
    if (task.takeover?.attempts >= 1) return { kind: 'none', reason: 'TAKEOVER_ATTEMPT_LIMIT' };
    const plan = {
      id: randomUUID(), state: 'intent-persisted', reason: null,
      episodeId: episode.episodeId, evidenceVersion: episode.evidenceVersion, evidenceFingerprint: episode.evidenceFingerprint,
      acceptanceRevision: acceptance.revision, requirementHash: acceptance.requirementHash, coordinationRevision: task.coordination.revision,
      source: task.executionOwner ?? null, target: null, policy: clone(policy), portableHistory: null,
      noticeMessageId: null, callId: null, finalRequestHash: null, finalRequest: null, forecast: null, imageForecast: null, acceptanceVerdict: null,
    };
    let steeringStarted = false;
    try {
      if (!plan.source) throw new LlmError('No dispatched execution owner', 'TAKEOVER_OWNER_UNKNOWN');
      if (!policy.allowCrossModel) throw new LlmError('Cross-model takeover is disabled', 'TAKEOVER_CROSS_MODEL_NOT_AUTHORIZED');
      if (this.#live().fixedCandidateId && !policy.allowFixedModel) throw new LlmError('Fixed-model takeover requires its own grant', 'FIXED_MODEL_TAKEOVER_NOT_AUTHORIZED');
      if (!policy.candidateId) throw new LlmError('No takeover target was selected', 'TAKEOVER_CANDIDATE_REQUIRED');
      const target = await this.#router.captureCandidate(policy.candidateId, { signal });
      const current = this.#router.exactTask(task.sessionId, task.turn);
      if (signal.aborted || !current || current.acceptance.revision !== acceptance.revision || current.coordination.revision !== plan.coordinationRevision || agent.inbox.nextStep.some(message => message.source?.kind === 'user')) throw new LlmError('Task boundary changed', 'TAKEOVER_BOUNDARY_CHANGED');
      if (!target.enabled || target.capability?.text.supported !== true) throw new LlmError('Target is unavailable', 'TAKEOVER_CANDIDATE_INELIGIBLE');
      if (sameIdentity(target.identity, plan.source.identity)) throw new LlmError('Target already owns execution', 'TAKEOVER_TARGET_IS_CURRENT_OWNER');
      if (target.handoff?.protocol !== 'dsh-canonical-v1') throw new LlmError('Target serializer has no portable declaration', 'TAKEOVER_PROTOCOL_UNKNOWN');
      plan.target = target;
      const sessionProof = await this.#sessionProof(agent, signal);
      const afterRead = this.#router.exactTask(task.sessionId, task.turn);
      if (signal.aborted || !afterRead || afterRead.acceptance.revision !== acceptance.revision || afterRead.coordination.revision !== plan.coordinationRevision || agent.inbox.nextStep.some(message => message.source?.kind === 'user')) throw new LlmError('Task changed while observing history', 'TAKEOVER_BOUNDARY_CHANGED');
      this.#verifyOperations(agent);
      plan.portableHistory = portableHistory(agent, current, this.#router.toolReceipt, this.#router.toolReceiptsForSession, this.#verifyReceipt);
      plan.portableHistory.sessionProof = sessionProof;
      const message = createUserMessage({ content: [{ type: 'text', text: "Continue this same Task with every original user constraint and completed tool receipt. The previous model still failed a trusted requirement after consultation. Correct the artifact without repeating completed operations or changing permissions, requirements, or budget." }], source: { kind: 'router-takeover', form: 'notice', summary: boundContextSummary('Router planned one evidence-based takeover'), taskId: task.id, planId: plan.id, episodeId: episode.episodeId, evidenceVersion: episode.evidenceVersion } });
      plan.noticeMessageId = message.id;
      await this.#publish(current, plan);
      this.verifyBoundary(agent, signal, plan);
      steeringStarted = true;
      await agent.steer(message);
      this.verifyBoundary(agent, signal, plan);
      await this.update(task.sessionId, task.turn, plan.id, { state: 'notice-delivered' });
      this.verifyBoundary(agent, signal, plan);
      return { kind: 'takeover', planId: plan.id };
    } catch (error) {
      plan.state = steeringStarted ? 'delivery-unknown' : 'refused'; plan.reason = takeoverReason(error, signal);
      const current = this.#router.exactTask(task.sessionId, task.turn);
      if (current && current.acceptance.revision === acceptance.revision && (!current.takeover || current.takeover.plan.id === plan.id)) {
        await this.#publish(current, plan);
        if (steeringStarted) this.#router.pauseTakeover(task.id, plan.id, 'TAKEOVER_DELIVERY_UNKNOWN');
        else if (plan.reason.startsWith('TAKEOVER_TOOL_')) this.#router.pauseTakeover(task.id, plan.id, plan.reason);
      }
      return { kind: 'none', reason: plan.reason };
    }
  }
  verifyBoundary(agent, signal, plan) {
    signal?.throwIfAborted();
    this.#verifyCatalog();
    this.#verifyOperations(agent);
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    if (!task || task.acceptance?.revision !== plan.acceptanceRevision || task.acceptance?.requirementHash !== plan.requirementHash || task.coordination?.revision !== plan.coordinationRevision || task.takeover?.plan.id !== plan.id) throw new LlmError('Task evidence changed', 'TAKEOVER_BOUNDARY_CHANGED');
    if (agent.inbox.nextStep.some(message => message.source?.kind === 'user')) throw new LlmError('Human input takes precedence', 'HUMAN_INPUT_PENDING');
    if (this.#manual(agent)) throw new LlmError('Native selection takes precedence', 'NATIVE_SELECTION_CHANGED');
    if (hash(task.inputs) !== plan.portableHistory.inputHash) throw new LlmError('Human constraints changed', 'TAKEOVER_INPUT_HISTORY_CHANGED');
    const live = this.#live(plan.target?.candidateId);
    if (!live.automatic || live.fixedCandidateId !== plan.policy.fixedCandidateId || hash(live.policy) !== hash(Object.fromEntries(Object.entries(plan.policy).filter(([key]) => !['objective', 'fixedCandidateId'].includes(key)))) || live.fixedCandidateId && !plan.policy.allowFixedModel) throw new LlmError('Routing permission changed', 'TAKEOVER_POLICY_CHANGED');
    if (plan.target && !sameCapture(live.capture, plan.target)) throw new LlmError('Target connection changed', 'TAKEOVER_CANDIDATE_CHANGED');
    if (agent.session.surface.contentGeneration !== 0 || !containsHistory(agent.session.deriveMessages(), plan.portableHistory)) throw new LlmError('Conversation changed or lost content', 'TAKEOVER_HISTORY_CHANGED');
    for (const receipt of plan.portableHistory.toolReceipts) this.#verifyReceipt(agent, receipt);
    return task;
  }
  async route({ agent, signal, task }) {
    const plan = task?.takeover?.plan;
    if (!plan || !['notice-delivered', 'dispatched', 'completed'].includes(plan.state)) return null;
    const fresh = await this.#router.captureCandidate(plan.target.candidateId, { signal });
    this.verifyBoundary(agent, signal, plan);
    portableHistory(agent, task, this.#router.toolReceipt, this.#router.toolReceiptsForSession, this.#verifyReceipt);
    if (!sameCapture(fresh, plan.target)) throw new LlmError('Target changed', 'TAKEOVER_CANDIDATE_CHANGED');
    const model = await this.#llm.resolveModelInfo(fresh.identity.provider, fresh.identity.model, signal);
    this.verifyBoundary(agent, signal, plan);
    await this.#sessionProof(agent, signal);
    this.verifyBoundary(agent, signal, plan);
    if (!model.inputModalities?.includes('text') || model.systemPromptUpdate !== 'in-history') throw new LlmError('Target cannot preserve conversation instructions', 'TAKEOVER_MODEL_FORMAT_UNSUPPORTED');
    if (plan.portableHistory.images.length && (fresh.capability.image.supported !== true || !model.inputModalities.includes('image'))) throw new LlmError('Target cannot carry retained images', fresh.capability.image.supported === null ? 'TAKEOVER_IMAGE_CAPABILITY_UNKNOWN' : 'TAKEOVER_IMAGE_CAPABILITY_UNSUPPORTED');
    return { capture: fresh, model, planId: plan.id };
  }
  async prepare({ agent, signal, task, step, decision }) {
    const plan = task.takeover?.plan;
    if (!step.takeover?.planId || !plan) return;
    this.verifyBoundary(agent, signal, plan);
    const history = [...agent.session.deriveMessages(), ...decision.messages];
    this.#auditTools(history, step.assembled.tools, agent.session.toolHistory(), plan.target, step.takeover.model);
    const imageForecast = await this.#priceImages(history, plan.target.identity, signal, () => this.verifyBoundary(agent, signal, plan));
    this.verifyBoundary(agent, signal, plan);
    const inputTokens = bytes({ messages: portableMessages(history), tools: step.assembled.tools, system: step.assembled.sections }) + (imageForecast?.visualTokens ?? 0) + (imageForecast?.textBytes ?? 0);
    const totalTokens = inputTokens + plan.policy.maxTokens;
    const capacity = Math.min(plan.target.maxContextTokens ?? 0, step.takeover.model.context?.contextWindow ?? 0);
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new LlmError('Full context capacity is unknown', 'TAKEOVER_CONTEXT_CAPACITY_UNKNOWN');
    if (!Number.isSafeInteger(totalTokens) || totalTokens > capacity) throw new LlmError('Full history does not fit the target context', 'TAKEOVER_CONTEXT_CAPACITY_EXCEEDED');
    if (totalTokens > plan.policy.forecastTokens) throw new LlmError('Full history exceeds the configured reservation', 'TAKEOVER_FORECAST_EXCEEDED');
    step.takeover.forecast = { inputTokens: plan.policy.forecastTokens - plan.policy.maxTokens, outputTokens: plan.policy.maxTokens, totalTokens: plan.policy.forecastTokens };
    await this.update(task.sessionId, task.turn, plan.id, { state: 'prepared', forecast: step.takeover.forecast, imageForecast });
    this.verifyBoundary(agent, signal, plan);
  }
  async auditFinal(request, { agent, step, call }) {
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    const plan = task?.takeover?.plan;
    if (!step.takeover?.planId || !plan) return;
    this.verifyBoundary(agent, request.signal, plan);
    if (!step.takeover.boundModel || hash(modelFacts(step.takeover.boundModel)) !== hash(modelFacts(step.takeover.model))) throw new LlmError('The actual native prepared call has no matching capability proof', 'TAKEOVER_PREPARED_MODEL_CHANGED');
    const sessionProof = await this.#sessionProof(agent, request.signal, request.messages);
    this.verifyBoundary(agent, request.signal, plan);
    if (!sameIdentity(call.selection, plan.target.identity) || request.maxTokens !== plan.policy.maxTokens || !containsHistory(request.messages, plan.portableHistory)) throw new LlmError('The actual native request differs from its handoff', 'TAKEOVER_FINAL_REQUEST_CHANGED');
    this.#auditTools(request.messages, request.tools, request.toolHistory, plan.target, step.takeover.boundModel);
    const imageForecast = await this.#priceImages(request.messages, plan.target.identity, request.signal, () => this.verifyBoundary(agent, request.signal, plan));
    this.verifyBoundary(agent, request.signal, plan);
    if (hash(imageForecast) !== hash(plan.imageForecast)) throw new LlmError('Image estimate changed while reserved', 'TAKEOVER_IMAGE_FORECAST_CHANGED');
    const inputTokens = bytes({ messages: portableMessages(request.messages), tools: request.tools ?? [], toolHistory: request.toolHistory ?? null, system: request.system ?? null }) + (imageForecast?.visualTokens ?? 0) + (imageForecast?.textBytes ?? 0);
    if (inputTokens + plan.policy.maxTokens > Math.min(plan.target.maxContextTokens ?? 0, step.takeover.boundModel.context?.contextWindow ?? 0)) throw new LlmError('The final native request exceeds capacity', 'TAKEOVER_CONTEXT_CAPACITY_EXCEEDED');
    if (inputTokens > step.takeover.forecast.inputTokens) throw new LlmError('The final native request exceeds its reservation', 'TAKEOVER_FINAL_FORECAST_EXCEEDED');
    const finalRequest = { protocol: 'dsh-canonical-v1', nativeRequest: true, taskId: task.id, sessionId: request.sessionId, turn: task.turn, step: call.step, callId: call.id, provider: request.provider, model: request.model, maxTokens: request.maxTokens, messages: portableMessages(request.messages), tools: clone(request.tools ?? []), toolHistory: clone(request.toolHistory ?? null), system: request.system ?? null, prepared: clone(step.takeover.boundModel), sessionProof };
    step.takeover.finalCursor = sessionProof.cursor;
    await this.update(task.sessionId, task.turn, plan.id, { state: 'dispatch-intent', callId: call.id, finalRequest, finalRequestHash: hash(finalRequest) });
    this.verifyBoundary(agent, request.signal, plan);
  }
  bindPrepared(prepared, { agent, step, call, signal }) {
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    const plan = task?.takeover?.plan;
    if (!plan || !step.takeover?.planId) throw new LlmError('No live takeover call owns this preparation', 'TAKEOVER_PREPARED_OWNER_CHANGED');
    this.verifyBoundary(agent, signal, plan);
    if (plan.callId !== call.id || plan.state !== 'call-reserved' || prepared.config.provider !== plan.target.identity.provider || prepared.config.model !== plan.target.identity.model || prepared.config.maxTokens !== plan.policy.maxTokens || hash(modelFacts(prepared)) !== hash(modelFacts(step.takeover.model))) throw new LlmError('The bound adapter generation differs from the validated model', 'TAKEOVER_PREPARED_MODEL_CHANGED');
    step.takeover.boundModel = { ...clone(modelFacts(prepared)), config: clone(prepared.config), adapterDefaults: clone(prepared.adapterDefaults) };
  }
  verifyFinal(request, { agent, step, call }) {
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    this.verifyBoundary(agent, request.signal, task.takeover.plan);
    if (agent.session.seq - 1 !== step.takeover.finalCursor || task.takeover.plan.callId !== call.id || task.takeover.plan.state !== 'dispatch-intent') throw new LlmError('The dispatch boundary changed', 'TAKEOVER_FINAL_BOUNDARY_CHANGED');
  }
  async completed({ agent, turn, acceptance }) {
    const task = this.#router.exactTask(agent.session.id, turn);
    if (task?.takeover?.plan.state === 'dispatched') await this.update(task.sessionId, turn, task.takeover.plan.id, { state: 'completed', acceptanceVerdict: acceptance.verdict });
  }
  async #priceImages(messages, identity, signal, recheck) {
    const images = messages.flatMap(message => message.content).filter(part => part.type === 'image');
    if (!images.length) return null;
    for (const image of images) {
      const stored = await this.#attachments?.readImage(image.attachment, signal);
      recheck();
      const digest = stored?.data && createHash('sha256').update(stored.data).digest('hex');
      if (!stored || hash(stored.ref) !== hash(image.attachment) || image.attachment.attachmentId !== 'sha256:' + digest) throw new LlmError('Image attachment changed or is missing', 'TAKEOVER_IMAGE_ATTACHMENT_UNAVAILABLE');
    }
    const pricing = this.#llm.imageRequestPricing(identity.provider, identity.model);
    if (!pricing) throw new LlmError('No target image estimate', 'TAKEOVER_IMAGE_FORECAST_UNKNOWN');
    const prices = pricing.priceImages(images);
    if (!Array.isArray(prices) || prices.length !== images.length || prices.some(item => !Number.isSafeInteger(item.visualTokens) || item.visualTokens < 1 || typeof item.text !== 'string')) throw new LlmError('Target returned an invalid image estimate', 'TAKEOVER_IMAGE_FORECAST_INVALID');
    const visualTokens = prices.reduce((sum, item) => sum + item.visualTokens, 0), textBytes = prices.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0);
    if (!Number.isSafeInteger(visualTokens) || !Number.isSafeInteger(textBytes)) throw new LlmError('Image estimate exceeds exact arithmetic', 'TAKEOVER_IMAGE_FORECAST_INVALID');
    return { source: 'provider-image-request-pricing', confidence: 'declared', imageCount: images.length, visualTokens, textBytes };
  }
  async #sessionProof(agent, signal, actualMessages) {
    const query = this.#query();
    if (!query) throw new LlmError('Public Session query is unavailable', 'TAKEOVER_SESSION_QUERY_UNAVAILABLE');
    this.#verifyCatalog();
    const lease = await query.observeSession(agent.session.id, { signal, projectionMode: 'none' });
    try {
      signal.throwIfAborted();
      this.#verifyCatalog();
      if (lease.source !== 'live' || lease.header.id !== agent.session.id || lease.cursor !== agent.session.seq - 1 || lease.events.some((event, index) => event.seq !== index) || lease.events.length !== lease.cursor + 1 || lease.projections && lease.projections.asOfSeq !== lease.cursor) throw new LlmError('Session observation is stale or incomplete', 'TAKEOVER_SESSION_CUT_CHANGED');
      if (lease.events.some(event => ['tool/ptc-dispatch-start', 'tool/ptc-dispatch'].includes(event.type))) throw new LlmError('Log-only nested tool records are not portable in this protocol', 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED');
      const fold = foldSurface(lease.events, currentSessionMessageProjections);
      if (fold.replacements.length || agent.session.surface.contentGeneration !== 0) throw new LlmError('Compacted or projected history cannot be handed off', 'TAKEOVER_HISTORY_PROJECTED');
      const messages = fold.nodes.map(seq => deriveEventMessage(lease.events[seq], fold.projectedMessages)).filter(Boolean);
      if (hash(portableMessages(messages)) !== hash(portableMessages(actualMessages ?? agent.session.deriveMessages()))) throw new LlmError('Canonical history does not match the native request', 'TAKEOVER_SESSION_MESSAGES_CHANGED');
      const pending = new Map(), toolRecords = [];
      for (const event of lease.events) {
        if (event.type === 'tool/call') {
          if (pending.has(event.data.callId)) throw new LlmError('Tool identity is ambiguous', 'TAKEOVER_TOOL_HISTORY_INVALID');
          pending.set(event.data.callId, event);
        }
        if (event.type !== 'tool/result' || event.surfaceOp !== 'append') continue;
        const message = event.data.message, issued = pending.get(message.toolCallId);
        if (!issued || message.source.callId !== message.toolCallId || issued.data.turn !== event.data.turn || issued.data.step !== event.data.step) throw new LlmError('Tool receipt does not match a recorded invocation', 'TAKEOVER_TOOL_HISTORY_INVALID');
        if (message.isError || ['TOOL_OUTCOME_UNKNOWN', 'TOOL_NOT_STARTED'].includes(event.data.error?.code)) throw new LlmError('Tool outcome cannot be replayed safely', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
        const visibleCall = messages.flatMap(item => item.content).find(part => part.type === 'tool-call' && part.id === issued.data.callId);
        const visibleResult = messages.find(item => item.toolCallId === message.toolCallId);
        if (!visibleCall || visibleCall.name !== issued.data.name || visibleCall.arguments !== issued.data.arguments || !visibleResult || hash(visibleResult.content) !== hash(message.content)) throw new LlmError('Tool history lost original content', 'TAKEOVER_TOOL_HISTORY_CHANGED');
        pending.delete(message.toolCallId);
        toolRecords.push({ callId: message.toolCallId, callSeq: issued.seq, resultSeq: event.seq, turn: event.data.turn, step: event.data.step });
      }
      if (pending.size) throw new LlmError('A started operation has unknown outcome', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
      return { source: 'live', mode: 'none', sessionId: lease.header.id, cursor: lease.cursor, inheritedEventCount: lease.inheritedEventCount, projectionAsOfSeq: null, interpreterTypes: this.#catalog.map(item => item.type), contentGeneration: 0, messagesHash: hash(portableMessages(messages)), toolRecords };
    } finally { lease[Symbol.dispose](); }
  }
  #verifyCatalog() {
    if (currentSessionMessageProjections.length !== this.#catalog.length || this.#catalog.some((item, index) => currentSessionMessageProjections[index] !== item.definition || item.definition.type !== item.type || item.definition.project !== item.project)) throw new LlmError('Public message interpreters changed', 'TAKEOVER_SESSION_PROJECTION_CHANGED');
  }
  #verifyOperations(agent) {
    if ([...this.#toolBindings.values()].some(binding => binding.affectedAgents.some(owner => owner.session.id === agent.session.id)) || this.#router.toolReceiptsForSession(agent.session.id).some(receipt => receipt.outcome !== 'completed')) throw new LlmError('An operation in the public execution tree is pending or unknown', 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
  }
  #auditTools(messages, tools = [], history, target, model) {
    const hasToolContent = messages.some(message => message.role === 'tool' || message.content.some(part => ['tool-call', 'tool-addition', 'tool-removal'].includes(part.type)));
    const schemas = [...tools ?? [], ...history?.tools ?? [], ...(history?.updates ?? []).flatMap(update => update.additions)];
    if (!hasToolContent && schemas.length === 0) return;
    if (target.capability.tools.supported !== true || target.handoff.toolProtocol !== 'function-json-schema-v1') throw new LlmError('Target tool protocol is unknown or unsupported', 'TAKEOVER_TOOL_PROTOCOL_UNSUPPORTED');
    if (messages.some(message => message.content.some(part => ['tool-addition', 'tool-removal'].includes(part.type))) && model.toolUpdate !== 'in-history') throw new LlmError('Historical tool updates cannot be preserved', 'TAKEOVER_TOOL_UPDATE_UNSUPPORTED');
    for (const schema of schemas) {
      if (typeof schema.name !== 'string' || typeof schema.description !== 'string') throw new LlmError('Unknown tool declaration', 'TAKEOVER_TOOL_SCHEMA_UNSUPPORTED');
      try { assertObjectJsonSchema(schema.parameters); } catch { throw new LlmError('Unsupported tool schema', 'TAKEOVER_TOOL_SCHEMA_UNSUPPORTED'); }
    }
  }
  #owner(definition, agent) {
    return { id: randomUUID(), definition, agent, valid: true, execute: definition.execute, render: definition.output.render, project: definition.projectContent, finalize: definition.finalizeContent, concurrency: definition.isConcurrencySafe, metadataHash: hash({ schema: toolSchema(definition), output: definition.output.schema, operation: definition.routerOperation ?? null, timeoutMs: definition.timeoutMs ?? null }) };
  }
  #sameOwner(owner, agent = owner.agent) {
    try {
      const definition = this.#tools.get(owner.definition.name, agent);
      return owner.valid && definition === owner.definition && definition.execute === owner.execute && definition.output.render === owner.render && definition.projectContent === owner.project && definition.finalizeContent === owner.finalize && definition.isConcurrencySafe === owner.concurrency && hash({ schema: toolSchema(definition), output: definition.output.schema, operation: definition.routerOperation ?? null, timeoutMs: definition.timeoutMs ?? null }) === owner.metadataHash;
    } catch { return false; }
  }
  #verifyReceipt = (agent, receipt) => {
    const owner = this.#toolOwners.get(`${agent.session.id}:${receipt.callId}`);
    if (!owner || owner.id !== receipt.semanticBindingId) throw new LlmError('Historical tool semantics cannot be proved in this process', 'TAKEOVER_TOOL_SEMANTICS_UNKNOWN');
    if (!this.#sameOwner(owner, agent)) throw new LlmError('The related tool definition or operation semantics changed', 'TAKEOVER_TOOL_SEMANTICS_CHANGED');
  };
  toolsChanged() {
    for (const owner of [...this.#toolOwners.values(), ...[...this.#toolBindings.values()].map(binding => binding.owner)]) if (!this.#sameOwner(owner)) owner.valid = false;
  }
  #nativeRoot(exec, agent = exec.agent) {
    return agent?.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(part => part.type === 'tool-call' && part.id === (exec.rootCallId ?? exec.callId)));
  }
  bindTool(exec) {
    const activeParent = this.#toolBindings.get(exec.parent);
    const parent = activeParent ?? this.#toolAncestry.get(exec.parent);
    const matchingBindings = exec.rootCallId === undefined ? [] : [...this.#toolBindings.values()].filter(binding => binding.rootCallId === exec.rootCallId);
    const matchingAgents = [...new Set(matchingBindings.flatMap(binding => binding.affectedAgents))];
    const agent = parent?.agent ?? (this.#nativeRoot(exec) ? exec.agent : undefined) ?? (matchingAgents.length === 1 ? matchingAgents[0] : undefined);
    if (!parent && !this.#nativeRoot(exec, agent) && matchingAgents.length === 0) return;
    const affectedAgents = agent ? [agent] : matchingAgents;
    const rootCallId = parent?.rootCallId ?? exec.rootCallId ?? exec.callId;
    const scopeReason = !agent ? 'TAKEOVER_TOOL_OUTCOME_UNKNOWN' : exec.parent !== undefined
      ? !activeParent || parent.scopeReason || exec.agent !== parent.agent || exec.rootCallId !== parent.rootCallId ? 'TAKEOVER_TOOL_OUTCOME_UNKNOWN' : null
      : exec.callId !== rootCallId ? 'TAKEOVER_TOOL_OUTCOME_UNKNOWN' : null;
    const taskOwners = parent?.taskOwners ?? (scopeReason && matchingBindings.length ? [...new Map(matchingBindings.flatMap(binding => binding.taskOwners).map(owner => [owner.taskId, owner])).values()] : affectedAgents.map(owner => {
      const turn = this.#turn(owner);
      return { agent: owner, turn, taskId: this.#router.exactTask(owner.session.id, turn)?.id };
    }));
    const definition = this.#tools.get(exec.name, exec.agent);
    if (!definition) return;
    const schema = toolSchema(definition);
    const parsed = z.object({ version: z.literal(1), effect: z.enum(['read', 'side-effect']), idempotencyKey: z.string().min(1).nullable(), source: z.string().min(1), confidence: z.literal('declared') }).strict().safeParse(definition.routerOperation);
    const operation = parsed.success ? parsed.data : null;
    const key = operation?.effect === 'side-effect' && operation.idempotencyKey ? exec.arguments?.[operation.idempotencyKey] : null;
    const operationKey = operation?.effect === 'side-effect' && typeof key === 'string' && key ? hash({ schema, operation, key }) : null;
    const owner = this.#owner(definition, exec.agent);
    this.#toolAncestry.set(exec.token, { agent, affectedAgents, taskOwners, rootCallId, scopeReason });
    this.#toolBindings.set(exec.token, { callId: exec.callId, name: exec.name, schema: clone(schema), schemaHash: hash(schema), operation: operation?.effect === 'side-effect' && !operationKey ? null : operation, operationKey, argsHash: hash(exec.arguments), semanticBindingId: owner.id, owner, agent, affectedAgents, taskOwners, rootCallId, scopeReason });
  }
  recordToolResult(exec, result) {
    const binding = this.#toolBindings.get(exec.token);
    this.#toolBindings.delete(exec.token);
    if (binding?.pendingKey) this.#pendingOperations.delete(binding.pendingKey);
    const parent = this.#toolBindings.get(exec.parent) ?? this.#toolAncestry.get(exec.parent);
    const taskOwners = binding?.taskOwners ?? parent?.taskOwners ?? (exec.agent && this.#nativeRoot(exec) ? [{ agent: exec.agent, turn: this.#turn(exec.agent) }] : []);
    for (const taskOwner of taskOwners) {
      const task = this.#router.exactTask(taskOwner.agent.session.id, taskOwner.turn);
      if (!task || taskOwner.taskId && taskOwner.taskId !== task.id) continue;
      const { owner, pendingKey: _pendingKey, agent: _agent, affectedAgents: _affectedAgents, taskOwners: _taskOwners, rootCallId: _rootCallId, scopeReason, ...receipt } = binding ?? { callId: exec.callId, name: exec.name, schema: null, schemaHash: null, operation: null, operationKey: null, semanticBindingId: null, argsHash: hash(exec.arguments ?? null) };
      const key = `${task.sessionId}:${exec.callId}`;
      if (owner && !this.#toolOwners.has(key)) this.#toolOwners.set(key, owner);
      const semanticsChanged = owner && !this.#sameOwner(owner);
      this.#router.recordToolReceipt(task.id, { ...receipt, outcome: result.isError || semanticsChanged || scopeReason ? 'unknown' : 'completed', resultHash: hash(result.content), failureCode: scopeReason ?? (semanticsChanged ? 'TAKEOVER_TOOL_SEMANTICS_CHANGED' : result.error?.info?.code ?? null) });
      if (semanticsChanged && task.takeover) this.#router.pauseTakeover(task.id, task.takeover.plan.id, 'TAKEOVER_TOOL_SEMANTICS_CHANGED', 'interrupted');
    }
  }
  guardTool(exec) {
    const binding = this.#toolBindings.get(exec.token);
    if (binding?.scopeReason && binding.taskOwners.some(owner => this.#router.exactTask(owner.agent.session.id, owner.turn)?.takeoverPolicy?.enabled)) return binding.scopeReason;
    const agent = binding?.agent ?? exec.agent;
    if (!agent?.session?.id || !binding && !this.#nativeRoot(exec, agent)) return;
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    if (!task?.takeover) return;
    if (task.routingPauseReason?.startsWith('TAKEOVER_') || ['interrupted', 'delivery-unknown', 'dispatch-unknown'].includes(task.takeover.plan.state)) return task.routingPauseReason ?? task.takeover.plan.reason ?? 'TAKEOVER_PAUSED';
    if (!['dispatch-started', 'dispatched'].includes(task.takeover.plan.state)) return;
    const prior = this.#router.toolReceiptsForSession(task.sessionId);
    const unknown = prior.some(receipt => receipt.outcome !== 'completed');
    const repeatedCall = prior.some(receipt => receipt.callId === exec.callId);
    const repeatedOperation = binding?.operationKey && prior.some(receipt => receipt.operationKey === binding.operationKey && receipt.outcome === 'completed');
    let semanticsChanged = false;
    try { for (const receipt of prior.filter(receipt => receipt.outcome === 'completed')) this.#verifyReceipt(agent, receipt); }
    catch { semanticsChanged = true; }
    const pendingKey = binding?.operationKey ? `${task.sessionId}:${binding.operationKey}` : null;
    const reason = exec.parent !== undefined ? 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED' : unknown ? 'TAKEOVER_TOOL_OUTCOME_UNKNOWN' : repeatedCall ? 'TAKEOVER_DUPLICATE_TOOL_CALL' : semanticsChanged || binding && !this.#sameOwner(binding.owner) ? 'TAKEOVER_TOOL_SEMANTICS_CHANGED' : repeatedOperation ? 'TAKEOVER_DUPLICATE_OPERATION' : pendingKey && this.#pendingOperations.has(pendingKey) ? 'TAKEOVER_TOOL_OUTCOME_UNKNOWN' : !binding?.operation ? 'TAKEOVER_TOOL_OPERATION_UNKNOWN' : null;
    if (reason) { this.#router.pauseTakeover(task.id, task.takeover.plan.id, reason, 'interrupted'); return reason; }
    if (pendingKey) { binding.pendingKey = pendingKey; this.#pendingOperations.set(pendingKey, exec.token); }
  }
  async refuse(agent, reason) {
    const task = this.#router.exactTask(agent.session.id, this.#turn(agent));
    const plan = task?.takeover?.plan;
    if (plan && !['completed', 'refused', 'stale'].includes(plan.state)) await this.update(task.sessionId, task.turn, plan.id, { state: 'refused', reason });
  }
  async update(sessionId, turn, planId, changes) {
    const task = this.#router.exactTask(sessionId, turn);
    if (task?.takeover?.plan.id !== planId) throw new LlmError('Handoff changed', 'TAKEOVER_STALE');
    return this.#publish(task, { ...task.takeover.plan, ...clone(changes) });
  }
  async #publish(task, plan) {
    const previous = task.takeover;
    const state = { version: 1, revision: (previous?.revision ?? 0) + 1, attempts: 1, plan: clone(plan), timeline: [...previous?.timeline ?? [], { sequence: (previous?.timeline.length ?? 0) + 1, kind: plan.state, planId: plan.id, reason: plan.reason, callId: plan.callId }] };
    return this.#router.publishTakeover(task.id, { acceptanceRevision: task.acceptance.revision, coordinationRevision: task.coordination.revision, takeoverRevision: previous?.revision ?? 0 }, takeoverSchema.parse(state));
  }
}
