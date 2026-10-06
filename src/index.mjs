import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, lastAssistantStreamChunk, createUserMessage } from '@deepseek-ai/dsh-llm';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { descriptors } from './protocol.mjs';

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
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = prompt.match(/^Reply\s+(.+)$/m)?.[1] ?? 'ROUTER_OK';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
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
  #steps = new WeakMap();
  constructor(ctx, state, path, files = { writeFile, rename }) {
    super(ctx, 'router');
    this.#state = state;
    this.#path = path;
    this.#files = files;
    // Cordis traces service calls through a proxy; bind the public facade to its state owner.
    const methods = descriptors.map(descriptor => descriptor.method);
    for (const method of [...methods, 'flush']) this[method] = this[method].bind(this);
    for (const method of methods) {
      Remote(this[method], { kind: 'method', name: method, static: false, private: false, addInitializer: fn => fn.call(this) });
    }
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const step = this.#steps.get(ctx.get('agents')?.get(session.id));
        if (step?.pending && sameChoice(step.pending, event.data.header.config)) step.pendingConsumed = true;
      }
      this.#observe(session, event);
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
    ctx.on('agent/pre-step', async ({ agent, signal, step: index, messages }, next) => {
      const decision = await next();
      const step = this.#steps.get(agent);
      if (!step || decision.kind === 'reject' || signal.aborted) return decision;
      const hasImage = [...agent.session.deriveMessages(), ...messages].some(message => message.content.some(part => part.type === 'image'));
      const capability = catalog.find(model => model.model === step.effectiveRoute.model)?.capability;
      const incompatible = step.effectiveRoute.provider === CONTROLLED_PROVIDER && hasImage && capability?.image.supported !== true;
      const blocked = step.blocked ?? this.#restriction(step.effectiveRoute) ?? (incompatible ? 'NO_COMPATIBLE_IMAGE_CANDIDATE' : null);
      if (blocked) {
        const task = [...this.#active.values()].find(task => task.sessionId === agent.session.id);
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
        const call = task?.calls.find(item => item.step === frame.step && item.status === 'prepared' && !item.hostAttemptId);
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
    ctx.on('agent/request', async ({ agent, turn, step }, next) => {
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
        task.calls.push({ id: randomUUID(), taskId: task.id, purpose: 'execution', attempt: task.calls.length + 1, step, selection: { ...task.activeSelection }, configVersion: task.configVersion, routerSnapshot: structuredClone(stepSnapshot?.config ?? this.#state.config), status: 'prepared', dispatchState: 'proposed', usage: null });
        const reason = stepSnapshot?.pending ? 'native-pending' : stepSnapshot?.route ? stepSnapshot.config.fixedModel ? 'fixed-model' : 'enabled-pool' : 'native-routing';
        task.timeline.push({ kind: 'selection', reason, provider: config.provider, model: config.model, configVersion: task.configVersion });
        this.#persist();
      }
      // Return the entire downstream config, including native effort and token settings.
      return config;
    }, { prepend: true });
    const service = this;
    ctx.on('llm/stream', async function* (request, next) {
      // Check when consumed: outer request/budget middleware may have waited.
      // Revocation blocks dispatch; fixed/automatic changes await full assembly.
      const blocked = service.#restriction(request);
      if (blocked) {
        const task = [...service.#active.values()].find(task => task.sessionId === request.sessionId);
        if (task) task.routingPauseReason = blocked;
        throw new LlmError(`Router cannot dispatch: ${blocked}`, 'MODEL_NOT_FOUND');
      }
      yield* next();
    });
    ctx.effect(() => () => this.flush(), 'router: persist on dispose');
  }
  async snapshot() {
    await this.flush();
    const active = [...this.#active.values()].map(task => ({ taskId: task.id, sessionId: task.sessionId, appliedVersion: task.configVersion, desiredVersion: this.#state.config.version }));
    const application = { status: active.some(task => task.appliedVersion !== task.desiredVersion) ? 'pending' : 'applied', desiredVersion: this.#state.config.version, active };
    return structuredClone({ ...this.#state, application, storageError: this.#storageError ?? null, models: catalog.map(model => ({ ...selection({ provider: CONTROLLED_PROVIDER, model: model.model }), ...model, id: model.model, enabled: this.#state.config.pool.some(entry => entry.model === model.model && entry.enabled), inPool: this.#state.config.pool.some(entry => entry.model === model.model), compatibility: { confidence: 'known', scope: 'local-controlled-protocol' } })) });
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
    });
  }
  #observe(session, event) {
    if (event.type === 'request/header') {
      const task = [...this.#active.values()].find(item => item.sessionId === session.id);
      if (task) { this.#confirm(task, event.data.header.config); this.#persist(); }
      return;
    }
    if (event.type === 'turn/start') {
      const task = { id: randomUUID(), sessionId: session.id, turn: event.data.turn, lifecycle: 'running', acceptance: { verdict: 'unconfirmed', evidence: [] }, activeSelection: null, configVersion: this.#state.config.version, result: '', calls: [], timeline: [], startedAt: new Date().toISOString() };
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
      call.status = event.data.interrupted || finish?.kind === 'max-tokens' || finish?.kind === 'aborted' ? 'interrupted' : event.type === 'assistant/attempt' || finish?.kind === 'error' ? 'failed' : 'completed';
      call.usage = event.data.usage ?? lastAssistantStreamChunk(event.data.stream ?? [], 'usage')?.usage ?? null;
      call.settlementSeq = event.seq;
      call.finishReason = finish?.kind ?? (event.data.interrupted ? 'aborted' : event.type === 'assistant/attempt' ? 'unknown' : 'stop');
      if (finish?.failure?.code) call.failureCode = finish.failure.code;
      task.timeline.push({ kind: 'call-settlement', callId: call.id, hostAttemptId: call.hostAttemptId, status: call.status, reason: call.finishReason });
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason;
      task.lifecycle = reason?.kind === 'completed' && !this.#storageError ? 'completed' : 'paused';
      if (task.lifecycle === 'paused') {
        task.pauseReason = this.#storageError ?? task.routingPauseReason ?? reason?.error?.code ?? reason?.kind ?? 'UNKNOWN_TERMINAL';
        task.fault = { kind: ['CONNECTION', 'AUTH', 'RATE_LIMIT', 'NO_ADAPTER'].includes(task.pauseReason) ? 'connection' : 'execution', code: task.pauseReason, retryable: task.pauseReason === 'CONNECTION' || task.pauseReason === 'RATE_LIMIT' };
        const call = task.calls.at(-1);
        if (call && call.status === 'prepared') call.status = 'failed';
      }
      task.endedAt = new Date().toISOString();
      task.timeline.push({ kind: 'terminal', lifecycle: task.lifecycle, reason: task.pauseReason ?? 'response-completed', acceptance: 'unconfirmed' });
      this.#active.delete(`${session.id}:${event.data.turn}`);
    }
    this.#persist();
  }
  #confirm(task, config, call = task.calls.at(-1)) {
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
  const pool = state.config.pool;
  const validEntry = entry => entry && catalog.some(model => model.model === entry.model) && typeof entry.enabled === 'boolean' && Object.entries(selection({ provider: CONTROLLED_PROVIDER, model: entry.model })).every(([key, value]) => entry[key] === value);
  if (!Array.isArray(pool) || !pool.every(validEntry) || new Set(pool.map(entry => entry.model)).size !== pool.length || (state.config.fixedModel !== null && !catalog.some(model => model.model === state.config.fixedModel))) throw new Error('Unsupported DSH Router pool configuration');
  for (const task of state.tasks) if (task.lifecycle === 'running') { task.lifecycle = 'paused'; task.pauseReason = 'HOST_RESTARTED'; }
  new RouterService(ctx, state, path, ctx.get('routerFileSystem'));
  ctx.llm.registerAdapter([CONTROLLED_PROVIDER], new ControlledAdapter());
  // Registration is owned by this plugin fiber; disabling releases the provider without touching native defaults.
}
