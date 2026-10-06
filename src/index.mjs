import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';

export const inject = ['llm', 'profileContext'];
export const CONTROLLED_PROVIDER = 'router-controlled';
export const CONTROLLED_MODEL = 'controlled';
function selection(config = { provider: CONTROLLED_PROVIDER, model: CONTROLLED_MODEL }) {
  const identity = config.provider === CONTROLLED_PROVIDER ? { connectionId: 'controlled-local', accountId: 'local', billingPath: 'controlled' } : { connectionId: `dsh-native:${config.provider}`, accountId: 'unknown', billingPath: 'unknown' };
  return { ...identity, provider: config.provider, model: config.model };
}

/** A local fixture: never reads credentials, opens a socket, or calls a model service. */
class ControlledAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Router · 本地可控模型（无付费请求）' }; }
  async listModels(provider) { return [{ provider, id: CONTROLLED_MODEL, name: 'Controlled fixture', contextWindow: 32768, maxTokens: 1024, inputModalities: ['text'] }]; }
  async resolveModel(provider, model) {
    if (model !== CONTROLLED_MODEL) throw new LlmError('Unknown controlled model', 'MODEL_NOT_FOUND');
    return { provider, id: model, name: 'Controlled fixture', contextWindow: 32768, maxTokens: 1024, inputModalities: ['text'] };
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    const message = options.messages.findLast(item => item.role === 'user');
    const prompt = message?.content.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? '';
    if (prompt.includes('[router:fail]')) throw new LlmError('Controlled connection failure; no provider request was sent', 'CONNECTION');
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
  constructor(ctx, state, path, files = { writeFile, rename }) {
    super(ctx, 'router');
    this.#state = state;
    this.#path = path;
    this.#files = files;
    // Cordis traces service calls through a proxy; bind the public facade to its state owner.
    for (const method of ['snapshot', 'setAutomatic', 'flush']) this[method] = this[method].bind(this);
    for (const method of ['snapshot', 'setAutomatic']) {
      Remote(this[method], { kind: 'method', name: method, static: false, private: false, addInitializer: fn => fn.call(this) });
    }
    ctx.on('session/event', (session, event) => this.#observe(session, event));
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
      const config = await next();
      const task = this.#active.get(`${agent.session.id}:${turn}`);
      if (task) {
        task.activeSelection = selection(config);
        task.configVersion = this.#state.config.version;
        task.calls.push({ id: randomUUID(), taskId: task.id, purpose: 'execution', attempt: task.calls.length + 1, step, selection: { ...task.activeSelection }, configVersion: task.configVersion, status: 'prepared', dispatchState: 'proposed', usage: null });
        task.timeline.push({ kind: 'selection', reason: this.#state.config.automatic && config.provider === CONTROLLED_PROVIDER ? 'single-controlled-model' : 'native-routing', provider: config.provider, model: config.model, configVersion: task.configVersion });
        this.#persist();
      }
      // Return the entire downstream config, including native effort and token settings.
      return config;
    }, { prepend: true });
    ctx.effect(() => () => this.flush(), 'router: persist on dispose');
  }
  async snapshot() {
    await this.flush();
    return structuredClone({ ...this.#state, storageError: this.#storageError ?? null, models: [{ ...selection(), enabled: true, capability: { text: 'protocol-verified', image: 'unsupported', tools: 'unsupported' }, validation: 'controlled-fixture' }] });
  }
  async setAutomatic(automatic) {
    if (typeof automatic !== 'boolean') throw new TypeError('automatic must be boolean');
    if (this.#storageError) throw new Error('Router storage is unavailable; repair DSH-local storage before changing settings');
    this.#state.config = { ...this.#state.config, automatic, version: this.#state.config.version + 1 };
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
        task.pauseReason = this.#storageError ?? reason?.error?.code ?? reason?.kind ?? 'UNKNOWN_TERMINAL';
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
  if (state.schemaVersion !== 1 || typeof state.config?.automatic !== 'boolean' || !Number.isSafeInteger(state.config?.version) || !Array.isArray(state.tasks)) throw new Error('Unsupported DSH Router state schema');
  for (const task of state.tasks) if (task.lifecycle === 'running') { task.lifecycle = 'paused'; task.pauseReason = 'HOST_RESTARTED'; }
  new RouterService(ctx, state, path, ctx.get('routerFileSystem'));
  ctx.llm.registerAdapter([CONTROLLED_PROVIDER], new ControlledAdapter());
  // Registration is owned by this plugin fiber; disabling releases the provider without touching native defaults.
}
