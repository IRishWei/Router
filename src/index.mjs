import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, lastAssistantStreamChunk, createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { descriptors, quoteSchema, budgetSchema, extensionSchema } from './protocol.mjs';
import { ledgerOf, reserveRecord, costOf, tokensOf, emptyBudget, budgetCheck, possiblyDispatched, normalizeBudgetConstraint } from './ledger.mjs';

export const inject = ['llm', 'profileContext'];
export const CONTROLLED_PROVIDER = 'router-controlled';
export const CONTROLLED_MODEL = 'controlled';
export const CONTROLLED_TOOLS_MODEL = 'controlled-tools';
const catalog = [
  { model: CONTROLLED_MODEL, name: 'Controlled fixture', capability: { text: { supported: true, confidence: 'known' }, image: { supported: false, confidence: 'known' }, tools: { supported: true, confidence: 'known' } } },
  { model: CONTROLLED_TOOLS_MODEL, name: 'Controlled tools fixture', capability: { text: { supported: true, confidence: 'known' }, image: { supported: null, confidence: 'unknown' }, tools: { supported: true, confidence: 'declared' } } },
];
const defaultPool = () => catalog.map(model => ({ ...selection({ provider: CONTROLLED_PROVIDER, model: model.model }), enabled: true }));
const sameRoute = (left, right) => left?.provider === right?.provider && left?.model === right?.model;
const sameIdentity = (left, right) => ['connectionId', 'accountId', 'billingPath', 'provider', 'model'].every(key => left?.[key] === right?.[key]);
const sameChoice = (left, right) => (!left && !right) || Boolean(left && right && sameRoute(left, right) && left.reasoningEffort === right.reasoningEffort);
const manualChanged = (step, current) => !(!current && step.pendingConsumed) && !sameChoice(step.pending, current);
function selection(config = { provider: CONTROLLED_PROVIDER, model: CONTROLLED_MODEL }) {
  const identity = config.provider === CONTROLLED_PROVIDER ? { connectionId: 'controlled-local', accountId: 'local', billingPath: 'controlled' } : { connectionId: `dsh-native:${config.provider}`, accountId: 'unknown', billingPath: 'unknown' };
  return { ...identity, provider: config.provider, model: config.model };
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
  #steps = new WeakMap();
  #waiters = new Map();
  #callSignals = new Map();
  #dispatchClaims = new WeakSet();
  #requestBindings = new WeakSet();
  #ownedRequests = new WeakMap();
  #ownedCalls = new Map();
  #automaticStreams = new WeakMap();
  #auxiliarySources = new Map();
  constructor(ctx, state, path, files = { writeFile, rename }) {
    super(ctx, 'router');
    this.#state = state;
    this.#path = path;
    this.#files = files;
    // Cordis traces service calls through a proxy; bind the public facade to its state owner.
    const methods = descriptors.map(descriptor => descriptor.method);
    for (const method of [...methods, 'flush', 'reserveCall', 'settleCall', 'persistDispatchIntent', 'streamReservedCall']) this[method] = this[method].bind(this);
    for (const method of methods) {
      Remote(this[method], { kind: 'method', name: method, static: false, private: false, addInitializer: fn => fn.call(this) });
    }
    ctx.on('session/event', (session, event) => {
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
    // The public dispatch event precedes every waterfall listener/consumer delay.
    ctx.on('internal/dispatch', (mode, name, args) => {
      const request = args[0];
      if (mode === 'waterfall' && name === 'llm/stream' && !isAgentLoopRequest(request) && !this.#ownedRequests.has(request)) this.#automaticStreams.set(request, this.#auxiliaryStream(request));
    });
    ctx.on('agent/inbox/claimed', ({ agent, turn, message }) => {
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      if (!task || message.source?.kind !== 'user') return;
      task.inputs.push({ messageId: message.id, requestId: message.source.rpcId ?? null, turn, claimedAt: new Date().toISOString() });
      task.timeline.push({ kind: 'input-claimed', messageId: message.id, requestId: message.source.rpcId ?? null, turn });
      this.#persist();
    });
    ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
      if (!agent) return next();
      const config = structuredClone(this.#state.config);
      const pending = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection');
      const step = { config, pending: pending?.pending ? { ...pending.pending } : null, route: null };
      const fixed = config.pool.find(model => model.model === config.fixedModel && model.enabled);
      if (config.automatic && config.fixedModel) {
        if (!fixed) step.blocked = 'FIXED_MODEL_UNAVAILABLE';
        else if (step.pending && !sameRoute(step.pending, fixed)) step.blocked = 'FIXED_MODEL_CONFLICT';
      }
      if (pending !== undefined && config.automatic && !step.pending) {
        const previous = agent.session.requestHeader()?.config;
        const enabled = config.pool.filter(model => model.enabled);
        step.route = config.fixedModel ? fixed ?? null : enabled.find(model => sameRoute(model, previous)) ?? enabled[0] ?? null;
        if (!step.route) step.blocked = config.fixedModel ? 'FIXED_MODEL_UNAVAILABLE' : 'NO_ENABLED_CANDIDATE';
      }
      this.#steps.set(agent, step);
      const assembled = await next();
      if (manualChanged(step, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) step.blocked = 'NATIVE_SELECTION_CHANGED';
      step.effectiveRoute = step.route ?? { provider: assembled.variables.provider, model: assembled.variables.model };
      return step.route ? { ...assembled, variables: { ...assembled.variables, provider: step.route.provider, model: step.route.model } } : assembled;
    }, { prepend: true });
    ctx.on('agent/pre-step', async ({ agent, signal, turn, step: index, messages }, next) => {
      const decision = await next();
      const step = this.#steps.get(agent);
      if (!step || decision.kind === 'reject' || signal.aborted) return decision;
      const hasImage = [...agent.session.deriveMessages(), ...messages].some(message => message.content.some(part => part.type === 'image'));
      const capability = catalog.find(model => model.model === step.effectiveRoute.model)?.capability;
      const incompatible = step.effectiveRoute.provider === CONTROLLED_PROVIDER && hasImage && capability?.image.supported !== true;
      const blocked = step.blocked ?? this.#restriction(step.effectiveRoute) ?? (incompatible ? 'NO_COMPATIBLE_IMAGE_CANDIDATE' : null);
      if (blocked) {
        const task = this.#active.get(`${agent.session.id}:${turn}`);
        if (task) task.routingPauseReason = blocked;
        return { kind: 'reject' };
      }
      const previous = agent.session.requestHeader()?.config;
      if (!step.route || !previous || sameRoute(step.route, previous) || (decision.messages.length === 0 && (index === 1 || messages.length > 0))) return decision;
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
      const blocked = stepSnapshot && manualChanged(stepSnapshot, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending) ? 'NATIVE_SELECTION_CHANGED' : this.#restriction(config);
      if (blocked) {
        if (task) task.routingPauseReason = blocked;
        throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND');
      }
      if (task) {
        task.activeSelection = selection(config);
        task.configVersion = stepSnapshot?.config.version ?? this.#state.config.version;
        const forecast = config.provider === CONTROLLED_PROVIDER ? { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } : null;
        const reason = stepSnapshot?.pending ? 'native-pending' : stepSnapshot?.route ? stepSnapshot.config.fixedModel ? 'fixed-model' : 'enabled-pool' : 'native-routing';
        task.timeline.push({ kind: 'selection', reason, provider: config.provider, model: config.model, configVersion: task.configVersion });
        const previous = this.#nativeReservations.get(agent);
        const before = task.calls.length;
        const reservation = this.reserveCall(task.id, { purpose: previous?.taskId === task.id && previous.turn === turn && previous.step === step ? 'retry' : 'execution', step, selection: task.activeSelection, configVersion: task.configVersion, routerSnapshot: stepSnapshot?.config ?? this.#state.config, forecast }, signal);
        this.#nativeReservations.set(agent, { taskId: task.id, turn, step, callId: task.calls[before].id });
        await reservation;
        if (manualChanged(stepSnapshot, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending)) {
          task.routingPauseReason = 'NATIVE_SELECTION_CHANGED';
          throw new LlmError('Native selection changed while waiting for budget', 'MODEL_NOT_FOUND');
        }
      }
      // Return the entire downstream config, including native effort and token settings.
      return config;
    }, { prepend: true });
    const service = this;
    ctx.on('llm/stream', (request, next) => {
      const auxiliary = service.#ownedRequests.get(request);
      const native = isAgentLoopRequest(request);
      if (!native && !auxiliary) return service.#automaticStreams.get(request) ?? service.#auxiliaryStream(request);
      return (async function* () {
      // Check when consumed: outer request/budget middleware may have waited.
      // Revocation blocks dispatch; fixed/automatic changes await full assembly.
      const agent = ctx.get('agents')?.get(request.sessionId);
      const step = agent && service.#steps.get(agent);
      const call = auxiliary?.call ?? service.#inflight.get(request.sessionId);
      // A rejected entrant has no authority to clear another stream's durable marker.
      if (!call || service.#dispatchClaims.has(call)) throw new LlmError('Router call already has a dispatch owner', 'MODEL_NOT_FOUND');
      service.#dispatchClaims.add(call);
      const verify = () => {
        request.signal?.throwIfAborted();
        if (auxiliary?.task.budget.stopRequested) throw new LlmError('Router task has been stopped', 'ABORTED');
        const blocked = native && step && manualChanged(step, ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending) ? 'NATIVE_SELECTION_CHANGED' : service.#restriction(request);
        if (blocked) {
          const task = [...service.#active.values()].find(task => task.id === call.taskId);
          if (task) task.routingPauseReason = blocked;
          throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND');
        }
      };
      try {
        verify();
        if (call) await service.persistDispatchIntent(call.taskId, call.id);
        // No await between this final signal/ownership/eligibility check and next().
        verify();
        if (call) { call.dispatchStarted = true; call.dispatchedAt = new Date().toISOString(); service.#persist(); }
      } catch (error) {
        if (call) { call.dispatchIntent = 'blocked'; call.dispatchStarted = false; delete call.dispatchedAt; service.#persist(); }
        throw error;
      }
      yield* next();
      })();
    });
    ctx.effect(() => () => {
      for (const waiter of this.#waiters.values()) waiter.reject(new LlmError('Router disabled during budget wait', 'MODEL_NOT_FOUND'));
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
    if (!active) {
      this.#state.blockedRequests ??= [];
      this.#state.blockedRequests.push({ at: new Date().toISOString(), sessionId: request.sessionId ?? null, provider: request.provider, model: request.model, nativePurpose: typeof request.purpose === 'string' ? request.purpose.slice(0, 100) : 'unknown', status: 'not-dispatched', reason: 'AUXILIARY_TASK_UNAVAILABLE' });
      this.#state.blockedRequests = this.#state.blockedRequests.slice(-100); this.#persist();
      return (async function* () { throw new LlmError('Router cannot safely attribute this auxiliary request to an active task: AUXILIARY_TASK_UNAVAILABLE', 'MODEL_NOT_FOUND'); })();
    }
    return this.#ownedCallStream(task, request, null, source);
  }
  #sourceKey(sessionId, purpose, messages) { return JSON.stringify([sessionId, purpose, messages?.map(message => message.id)]); }
  /** Host-only exact request owner. Persists intent and settles this reserved call once. */
  streamReservedCall(taskId, callId, request) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    const signal = this.#callSignals.get(callId);
    if (!call || !signal || call.reservation.state !== 'reserved' || call.dispatchIntent || this.#requestBindings.has(call) || this.#dispatchClaims.has(call) || !sameRoute(call.selection, request) || (request.signal && request.signal !== signal)) throw new TypeError('The request does not own this reserved call');
    this.#requestBindings.add(call);
    return this.#ownedCallStream(task, request, call);
  }
  #ownedCallStream(task, request, existingCall = null, source = null) {
    const service = this, controller = new AbortController();
    const originalSignal = existingCall ? this.#callSignals.get(existingCall.id) : request.signal ?? new AbortController().signal;
    const owner = { task, call: existingCall, controller, started: false, config: structuredClone(existingCall?.routerSnapshot ?? this.#state.config) };
    const owners = this.#ownedCalls.get(task.id) ?? new Set(); owners.add(owner); this.#ownedCalls.set(task.id, owners);
    const cleanup = () => { originalSignal.removeEventListener('abort', abandon); controller.signal.removeEventListener('abort', abandon); owners.delete(owner); if (!owners.size) this.#ownedCalls.delete(task.id); this.#finishTask(task); };
    const abandon = () => { if (!owner.started) cleanup(); };
    originalSignal.addEventListener('abort', abandon, { once: true }); controller.signal.addEventListener('abort', abandon, { once: true });
    return (async function* () {
      owner.started = true;
      let usage = null, finish = null, failureCode;
      try {
        originalSignal.throwIfAborted(); controller.signal.throwIfAborted();
        if (!owner.call) {
          const before = task.calls.length;
          const reservation = service.reserveCall(task.id, { purpose: 'auxiliary', nativePurpose: typeof request.purpose === 'string' ? request.purpose.slice(0, 100) : 'unknown', selection: selection(request), configVersion: owner.config.version, routerSnapshot: owner.config, forecast: request.provider === CONTROLLED_PROVIDER ? { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } : null }, originalSignal);
          owner.call = task.calls[before];
          owner.call.sourceEventSeq = source.sourceEventSeq;
          owner.call.sourceMessageSeqs = source.messageSeqs;
          service.#requestBindings.add(owner.call);
          await reservation;
        }
        const signal = AbortSignal.any([originalSignal, controller.signal]); signal.throwIfAborted();
        const prepared = await service.ctx.llm.prepareCall(request, signal);
        const options = Object.freeze({ ...request, ...prepared.config, signal });
        owner.call.snapshot = Object.fromEntries(['provider', 'model', 'temperature', 'maxTokens', 'reasoningEffort', 'stop'].filter(key => prepared.config[key] !== undefined).map(key => [key, structuredClone(prepared.config[key])]));
        owner.call.dispatchState = 'request-confirmed';
        service.#ownedRequests.set(options, owner);
        for await (const chunk of prepared.stream(options)) {
          if (chunk.type === 'usage') usage = chunk.usage;
          if (chunk.type === 'finish') finish = chunk.reason;
          signal.throwIfAborted();
          yield chunk;
        }
      } catch (error) {
        failureCode = typeof error.code === 'string' ? error.code : 'AUXILIARY_CALL_FAILED'; throw error;
      } finally {
        try {
          if (owner.call) service.settleCall(task.id, owner.call.id, { status: originalSignal.aborted || controller.signal.aborted || finish?.kind === 'aborted' || finish?.kind === 'max-tokens' ? 'interrupted' : finish?.kind === 'stop' ? 'completed' : 'failed', usage, finishReason: originalSignal.aborted || controller.signal.aborted ? 'aborted' : finish?.kind ?? 'unknown', failureCode: finish?.failure?.code ?? failureCode });
        } finally { cleanup(); }
      }
    })();
  }
  #cancelOwnedCalls(task) {
    for (const owner of this.#ownedCalls.get(task.id) ?? []) owner.controller.abort(new LlmError('Router task stopped its auxiliary request', 'ABORTED'));
    for (const call of task.calls) this.#waiters.get(call.id)?.resolve();
  }
  #finishTask(task) {
    if (!this.#active.has(`${task.sessionId}:${task.turn}`) || !task.nativeLifecycle || this.#ownedCalls.get(task.id)?.size) return;
    task.lifecycle = this.#storageError || task.budget.stopRequested ? 'paused' : task.nativeLifecycle;
    if (task.lifecycle === 'paused') {
      task.pauseReason = this.#storageError ?? (task.budget.stopRequested ? 'BUDGET_STOPPED' : task.nativePauseReason) ?? 'UNKNOWN_TERMINAL';
      task.fault = { kind: ['CONNECTION', 'AUTH', 'RATE_LIMIT', 'NO_ADAPTER'].includes(task.pauseReason) ? 'connection' : 'execution', code: task.pauseReason, retryable: task.pauseReason === 'CONNECTION' || task.pauseReason === 'RATE_LIMIT' };
    }
    task.endedAt = new Date().toISOString();
    task.timeline.push({ kind: 'terminal', lifecycle: task.lifecycle, reason: task.pauseReason ?? 'response-completed', acceptance: 'unconfirmed' });
    this.#active.delete(`${task.sessionId}:${task.turn}`);
    for (const call of task.calls) this.#callSignals.delete(call.id);
    this.#persist();
  }
  async snapshot() {
    await this.flush();
    const active = [...this.#active.values()].map(task => ({ taskId: task.id, sessionId: task.sessionId, appliedVersion: task.configVersion, desiredVersion: this.#state.config.version }));
    const application = { status: active.some(task => task.appliedVersion !== task.desiredVersion) ? 'pending' : 'applied', desiredVersion: this.#state.config.version, active };
    return structuredClone({ ...this.#state, tasks: this.#state.tasks.map(task => task.startedAt ? { ...task, ledger: ledgerOf(task) } : task), application, storageError: this.#storageError ?? null, models: catalog.map(model => ({ ...selection({ provider: CONTROLLED_PROVIDER, model: model.model }), ...model, id: model.model, enabled: this.#state.config.pool.some(entry => entry.model === model.model && entry.enabled), inPool: this.#state.config.pool.some(entry => entry.model === model.model), compatibility: { confidence: 'known', scope: 'local-controlled-protocol' } })) });
  }
  async setPriceQuote(provider, model, quote) {
    if (typeof provider !== 'string' || !provider || provider.length > 100 || typeof model !== 'string' || !model || model.length > 100) throw new TypeError('Invalid price route');
    const parsed = quote === null ? null : quoteSchema().parse(quote);
    if (provider === CONTROLLED_PROVIDER && parsed && parsed.kind !== 'fixture-reference') throw new TypeError('Controlled prices are fixture reference values only');
    const identity = selection({ provider, model });
    const prices = this.#state.config.prices.filter(item => !sameIdentity(item, identity));
    if (parsed) prices.push({ ...identity, quote: parsed });
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
    if (!task || !['assessment', 'execution', 'review', 'consultation', 'retry', 'redo', 'auxiliary'].includes(details.purpose) || !signal) throw new TypeError('Invalid task call reservation');
    const identity = Object.fromEntries(['connectionId', 'accountId', 'billingPath', 'provider', 'model'].map(key => [key, details.selection?.[key]]));
    if (!Object.values(identity).every(value => typeof value === 'string' && value)) throw new TypeError('A complete call identity is required');
    const snapshot = structuredClone(details.routerSnapshot ?? this.#state.config);
    const priceQuote = (snapshot.prices ?? []).find(item => sameIdentity(item, identity))?.quote ?? null;
    const call = { id: randomUUID(), taskId, purpose: details.purpose, accountingEntry: 'task-call-v1', dispatchProtocol: 'durable-intent-v2', attempt: task.calls.length + 1, ...(details.step === undefined ? {} : { step: details.step }), selection: identity, configVersion: details.configVersion ?? task.configVersion, routerSnapshot: snapshot, status: 'prepared', dispatchState: 'proposed', dispatchStarted: false, usage: null, priceQuote: structuredClone(priceQuote), reservation: reserveRecord(details.forecast ?? null, priceQuote), preparedAt: new Date().toISOString() };
    task.calls.push(call);
    if (details.nativePurpose !== undefined) call.nativePurpose = details.nativePurpose;
    this.#callSignals.set(call.id, signal);
    this.#persist();
    await this.#waitBudget(task, call, signal);
    return call.id;
  }
  async persistDispatchIntent(taskId, callId) {
    if (this.#storageError) throw new LlmError('Router storage is unavailable before dispatch', 'MODEL_NOT_FOUND');
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    const signal = this.#callSignals.get(callId);
    if (!call || !signal || call.reservation.state !== 'reserved' || call.dispatchStarted || call.dispatchIntent === 'possible') throw new TypeError('The call is not reserved for dispatch');
    const blocked = this.#restriction(call.selection);
    if (blocked) { task.routingPauseReason = blocked; throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND'); }
    signal.throwIfAborted();
    call.dispatchIntent = 'possible';
    call.dispatchIntentAt = new Date().toISOString();
    this.#persist();
    await this.flush();
    try {
      if (this.#storageError) throw new LlmError('Router dispatch intent could not be persisted', 'MODEL_NOT_FOUND');
      signal.throwIfAborted();
      const revoked = this.#restriction(call.selection);
      if (revoked) { task.routingPauseReason = revoked; throw new LlmError(`Router cannot dispatch: ${revoked}`, 'MODEL_NOT_FOUND'); }
    } catch (error) {
      call.dispatchIntent = 'blocked'; this.#persist(); throw error;
    }
    // This intent permits the caller to start its transport; it does not prove adapter entry.
  }
  settleCall(taskId, callId, settlement) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    const call = task?.calls.find(call => call.id === callId);
    if (!call || call.reservation.state === 'settled') throw new TypeError('The call cannot be settled twice');
    call.status = settlement.status;
    this.#callSignals.delete(call.id);
    call.usage = settlement.usage ? Object.fromEntries(Object.entries(settlement.usage).filter(([key, value]) => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'].includes(key) && Number.isSafeInteger(value) && value >= 0)) : null;
    if (settlement.seq !== undefined) call.settlementSeq = settlement.seq;
    call.finishReason = settlement.finishReason;
    if (settlement.failureCode) call.failureCode = settlement.failureCode;
    call.settledAt = new Date().toISOString();
    call.elapsedMs = call.dispatchedAt ? Math.max(0, Date.parse(call.settledAt) - Date.parse(call.dispatchedAt)) : null;
    call.cost = !possiblyDispatched(call) && !call.usage ? { amount: null, reason: 'NOT_DISPATCHED', billingConfirmation: 'unconfirmed' } : costOf(tokensOf(call.usage), call.priceQuote);
    call.reservation.state = !possiblyDispatched(call) && !call.usage ? 'released' : 'settled';
    call.overEstimate = [];
    const actualTokens = tokensOf(call.usage).total;
    if (actualTokens !== null && call.reservation.tokens.total !== null && actualTokens > call.reservation.tokens.total) call.overEstimate.push('tokens');
    if (call.cost.amount !== null && call.reservation.money.amount !== null && call.cost.amount > call.reservation.money.amount) call.overEstimate.push('money');
    if (call.overEstimate.length) task.timeline.push({ kind: 'estimate-exceeded', callId: call.id, resources: call.overEstimate, message: 'Actual usage exceeded the forecast; a reservation is not an absolute billing cap.' });
    task.timeline.push({ kind: 'call-settlement', callId: call.id, hostAttemptId: call.hostAttemptId, status: call.status, reason: call.finishReason });
    this.#persist();
    for (const candidate of task.calls) this.#waiters.get(candidate.id)?.resolve();
  }
  async extendTaskBudget(taskId, extension) {
    if (this.#storageError) throw new Error('Router storage is unavailable');
    const task = [...this.#active.values()].find(task => task.id === taskId);
    if (!task || task.budget.stopRequested) throw new TypeError('Only an active task can be extended');
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
    for (const call of task.calls) this.#waiters.get(call.id)?.resolve();
    return this.snapshot();
  }
  async stopTask(taskId) {
    const task = [...this.#active.values()].find(task => task.id === taskId);
    if (!task) throw new TypeError('The task is not active');
    task.budget.stopRequested = true;
    task.timeline.push({ kind: 'budget-stop', at: new Date().toISOString() });
    if (!task.nativeLifecycle) this.ctx.get('agents')?.get(task.sessionId)?.cancel({ kind: 'user' }, { keepInbox: true });
    this.#cancelOwnedCalls(task);
    this.#persist();
    return this.snapshot();
  }
  async #waitBudget(task, call, signal) {
    // Persist the reservation before sending anything to the selected adapter.
    await this.flush();
    while (true) {
      signal.throwIfAborted();
      if (task.budget.stopRequested || task.nativeLifecycle === 'paused') throw new LlmError('Router task no longer permits another call', 'ABORTED');
      if (this.#storageError) throw new LlmError('Router storage is unavailable', 'MODEL_NOT_FOUND');
      const decision = budgetCheck(task, call);
      task.budget.unenforceableLimits = decision.unenforceable;
      if (!decision.blocked.length) {
        call.status = 'prepared'; call.reservation.state = 'reserved';
        task.lifecycle = 'running'; delete task.budget.waiting;
        this.#persist(); await this.flush();
        signal.throwIfAborted();
        if (this.#storageError) throw new LlmError('Router reservation could not be persisted', 'MODEL_NOT_FOUND');
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
    }
  }
  async setModelEnabled(model, enabled) {
    if (!catalog.some(entry => entry.model === model) || typeof enabled !== 'boolean') throw new TypeError('Unknown model or invalid enabled state');
    const pool = this.#state.config.pool.filter(entry => entry.model !== model);
    pool.push({ ...selection({ provider: CONTROLLED_PROVIDER, model }), enabled });
    return this.#change({ pool });
  }
  async setFixedModel(model) {
    if (model !== null && !this.#state.config.pool.some(entry => entry.model === model && entry.enabled)) throw new TypeError('The fixed model must be enabled in the pool');
    return this.#change({ fixedModel: model });
  }
  async removeModel(model) {
    if (!catalog.some(entry => entry.model === model)) throw new TypeError('Unknown model');
    return this.#change({ pool: this.#state.config.pool.filter(entry => entry.model !== model) });
  }
  #restriction(route) {
    if (route?.provider !== CONTROLLED_PROVIDER) return null;
    const entry = this.#state.config.pool.find(entry => entry.model === route.model);
    return !entry ? 'MODEL_REMOVED' : !entry.enabled ? 'MODEL_DISABLED' : null;
  }
  async setAutomatic(automatic) {
    if (typeof automatic !== 'boolean') throw new TypeError('automatic must be boolean');
    return this.#change({ automatic });
  }
  async #change(change) {
    if (this.#storageError) throw new Error('Router storage is unavailable; repair DSH-local storage before changing settings');
    this.#state.config = { ...this.#state.config, ...change, version: this.#state.config.version + 1 };
    this.#persist();
    await this.flush();
    if (this.#storageError) throw new Error('Router storage is unavailable; the settings change was not persisted');
    return this.snapshot();
  }
  async flush() { await this.#writes; }
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
      const task = { id: randomUUID(), sessionId: session.id, turn: event.data.turn, lifecycle: 'running', acceptance: { verdict: 'unconfirmed', evidence: [] }, activeSelection: null, configVersion: this.#state.config.version, result: '', calls: [], inputs: [], timeline: [], startedAt: new Date().toISOString(), budget: { limits: structuredClone(this.#state.config.budget), extensions: [], unenforceableLimits: [] } };
      this.#active.set(`${session.id}:${event.data.turn}`, task);
      this.#state.tasks.push(task);
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
      this.settleCall(task.id, call.id, { status: event.data.interrupted || finish?.kind === 'max-tokens' || finish?.kind === 'aborted' ? 'interrupted' : event.type === 'assistant/attempt' || finish?.kind === 'error' ? 'failed' : 'completed', usage: event.data.usage ?? lastAssistantStreamChunk(event.data.stream ?? [], 'usage')?.usage ?? null, seq: event.seq, finishReason: finish?.kind ?? (event.data.interrupted ? 'aborted' : event.type === 'assistant/attempt' ? 'unknown' : 'stop'), failureCode: finish?.failure?.code });
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason;
      task.nativeLifecycle = reason?.kind === 'completed' && !this.#storageError ? 'completed' : 'paused';
      task.nativeEndedAt = new Date().toISOString();
      if (task.nativeLifecycle === 'paused') {
        task.nativePauseReason = this.#storageError ?? (task.budget.stopRequested ? 'BUDGET_STOPPED' : null) ?? task.routingPauseReason ?? reason?.error?.code ?? reason?.kind ?? 'UNKNOWN_TERMINAL';
        const reservation = this.#nativeReservations.get(this.ctx.get('agents')?.get(session.id));
        const call = reservation?.taskId === task.id && task.calls.find(call => call.id === reservation.callId);
        if (call && ['prepared', 'waiting'].includes(call.status)) { call.status = call.dispatchStarted ? 'failed' : 'not-dispatched'; call.reservation.state = 'released'; }
        this.#cancelOwnedCalls(task);
      }
      task.timeline.push({ kind: 'native-terminal', lifecycle: task.nativeLifecycle, reason: task.nativePauseReason ?? 'response-completed' });
      this.#finishTask(task);
    }
    this.#persist();
  }
  #confirm(task, config, call) {
    task.activeSelection = selection(config);
    if (call) {
      call.selection = { ...task.activeSelection };
      call.dispatchState = 'header-confirmed';
      call.snapshot = { ...config };
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
  state.config.prices ??= [];
  state.config.budget ??= emptyBudget();
  if (!budgetSchema().safeParse(state.config.budget).success) throw new Error('Unsupported DSH Router budget');
  if (new Set(state.config.budget.money.map(item => `${item.currency}:${item.kind}`)).size !== state.config.budget.money.length) throw new Error('Duplicate DSH Router budget limits');
  if (!Array.isArray(state.config.prices) || !state.config.prices.every(item => typeof item.provider === 'string' && item.provider && typeof item.model === 'string' && item.model && sameIdentity(item, selection(item)) && quoteSchema().safeParse(item.quote).success && (item.provider !== CONTROLLED_PROVIDER || item.quote.kind === 'fixture-reference'))) throw new Error('Unsupported DSH Router prices');
  const pool = state.config.pool;
  const validEntry = entry => entry && catalog.some(model => model.model === entry.model) && typeof entry.enabled === 'boolean' && Object.entries(selection({ provider: CONTROLLED_PROVIDER, model: entry.model })).every(([key, value]) => entry[key] === value);
  if (!Array.isArray(pool) || !pool.every(validEntry) || new Set(pool.map(entry => entry.model)).size !== pool.length || (state.config.fixedModel !== null && !catalog.some(model => model.model === state.config.fixedModel))) throw new Error('Unsupported DSH Router pool configuration');
  for (const task of state.tasks) {
    if (task.budget?.unenforceableLimits) task.budget.unenforceableLimits = task.budget.unenforceableLimits.map(value => normalizeBudgetConstraint(value, true));
    if (task.budget?.waiting?.blockedBy) task.budget.waiting.blockedBy = task.budget.waiting.blockedBy.map(value => normalizeBudgetConstraint(value));
    for (const event of task.timeline ?? []) if (event.kind === 'budget-wait' && event.blockedBy) event.blockedBy = event.blockedBy.map(value => normalizeBudgetConstraint(value));
    // 0.3.0 may have persisted its own mistaken zero-consumption restart classification.
    if (task.lifecycle === 'paused' && task.pauseReason === 'HOST_RESTARTED') {
      for (const call of task.calls) if ((!call.dispatchProtocol || (call.dispatchProtocol === 'durable-intent-v1' && call.dispatchIntent === 'blocked')) && call.status === 'not-dispatched' && call.dispatchState === 'header-confirmed') {
        call.dispatchUncertain = true; call.status = 'interrupted';
        if (!call.usage) call.cost = costOf(tokensOf(null), call.priceQuote);
      }
    }
  }
  for (const task of state.tasks) if (['running', 'waiting-budget'].includes(task.lifecycle)) {
    task.lifecycle = 'paused'; task.pauseReason = 'HOST_RESTARTED'; task.endedAt = new Date().toISOString();
    for (const call of task.calls) if (['prepared', 'waiting'].includes(call.status)) {
      // 0.3.0 header-confirmed calls had no durable dispatch gate; their state is ambiguous.
      if ((!call.dispatchProtocol || (call.dispatchProtocol === 'durable-intent-v1' && call.dispatchIntent === 'blocked')) && call.status === 'prepared' && call.dispatchState === 'header-confirmed') call.dispatchUncertain = true;
      call.status = possiblyDispatched(call) ? 'interrupted' : 'not-dispatched';
      if (call.reservation) call.reservation.state = 'released';
      if (possiblyDispatched(call) && !call.usage) call.cost = costOf(tokensOf(null), call.priceQuote);
    }
  }
  new RouterService(ctx, state, path, ctx.get('routerFileSystem'));
  ctx.llm.registerAdapter([CONTROLLED_PROVIDER], new ControlledAdapter());
  // Registration is owned by this plugin fiber; disabling releases the provider without touching native defaults.
}
