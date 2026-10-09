import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm';
import { createSourceNetworkTransport } from './source-network.mjs';
import { GO_MODEL, goEndpoint, OpenCodeGoAdapter } from './opencode-go-adapter.mjs';

const validId = value => typeof value === 'string' && /^account-[a-f0-9-]{36}$/u.test(value);
const keyFor = accountId => { if (!validId(accountId)) throw new TypeError('Invalid Go account binding'); return credentialKey('irishwei-dsh-router-go', accountId); };

export class OpenCodeGoHost {
  #ctx; #state; #changed; #mounted; #queue = Promise.resolve();
  constructor(ctx, state, changed) {
    this.#ctx = ctx; this.#state = state; this.#changed = changed;
    state.openCodeGo ??= { binding: null, connected: false, detectionClaim: null, lastDetectionTaskId: null };
    const value = state.openCodeGo;
    if (typeof value.connected !== 'boolean' || (value.binding !== null && (!validId(value.binding?.accountId) || typeof value.binding.generation !== 'string' || !value.binding.generation || typeof value.binding.connectionId !== 'string'))
      || (value.detectionClaim !== null && typeof value.detectionClaim !== 'string') || (value.lastDetectionTaskId !== null && typeof value.lastDetectionTaskId !== 'string') || (value.connected && value.binding === null)) throw new TypeError('Unsupported Go state');
    goEndpoint(ctx.get('routerGoEndpoint'));
  }
  #credentials() { const value = this.#ctx.get('credentials'); if (!value) throw new TypeError('Host credential storage is unavailable'); return value; }
  #serial(action) { const pending = this.#queue.then(action); this.#queue = pending.catch(() => {}); return pending; }
  async snapshot() {
    const value = this.#state.openCodeGo;
    const configured = value.binding ? await this.#ctx.get('credentials')?.describeRecord(keyFor(value.binding.accountId)).then(info => info.configured).catch(() => false) ?? false : false;
    return { configured, connected: Boolean(this.#mounted?.active.value), accountId: value.binding?.accountId ?? null, model: GO_MODEL, billingPath: 'opencode-go-subscription', catalogStatus: 'declared', quota: { status: 'unknown', remainingRatio: null }, lastDetectionTaskId: value.lastDetectionTaskId, detectionClaimed: value.detectionClaim !== null };
  }
  async restore() {
    if (this.#state.openCodeGo.connected && this.#ctx.get('credentials')) {
      try { await this.#mount(); } catch { /* Persisted binding remains inspectable, without inference certification. */ }
    }
  }
  saveCredential({ apiKey }) { return this.#serial(async () => {
    if (this.#state.openCodeGo.binding) throw new TypeError('Delete the current Go credential before saving another');
    const binding = { accountId: `account-${randomUUID()}`, generation: randomUUID(), connectionId: `connection-${randomUUID()}` };
    const key = keyFor(binding.accountId);
    const checked = assertUsableApiKey(apiKey, 'dsh-router-go', 'owned-credential');
    await this.#credentials().modifyRecord(key, async current => { if (current !== undefined) throw new TypeError('Go credential already exists'); return { kind: 'api-key', key: checked }; });
    this.#state.openCodeGo.binding = binding;
    try { await this.#changed(); } catch {
      this.#state.openCodeGo.binding = null; await this.#credentials().deleteRecord(key).catch(() => {});
      throw new Error('Go binding could not be persisted');
    }
  }); }
  connect() { return this.#serial(async () => {
    if (!this.#state.openCodeGo.binding) throw new TypeError('Save a Go credential first');
    if (this.#mounted?.active.value) return;
    await this.#unmount();
    await this.#mount(); this.#state.openCodeGo.connected = true;
    try { await this.#changed(); } catch { this.#state.openCodeGo.connected = false; await this.#unmount(); throw new Error('Go connection could not be persisted'); }
  }); }
  disconnect({ deleteCredential = false }) { return this.#serial(async () => {
    this.#state.openCodeGo.connected = false;
    await this.#unmount();
    if (deleteCredential && this.#state.openCodeGo.binding) {
      await this.#credentials().deleteRecord(keyFor(this.#state.openCodeGo.binding.accountId));
      this.#state.openCodeGo.binding = null;
    }
    // Detection permission is never reset by deleting a credential.
    await this.#changed();
  }); }
  claimDetectionTask() { return this.#serial(async () => {
    if (!this.#mounted?.active.value || this.#state.openCodeGo.detectionClaim !== null) throw new TypeError('Go detection unavailable or already claimed');
    this.#state.openCodeGo.detectionClaim = randomUUID();
    await this.#changed();
    return this.#state.openCodeGo.detectionClaim;
  }); }
  async finalizeDetectionTask(claim, taskId) {
    if (claim !== this.#state.openCodeGo.detectionClaim) throw new TypeError('Go detection claim mismatch');
    this.#state.openCodeGo.lastDetectionTaskId = taskId; await this.#changed();
  }
  async #mount() {
    const binding = this.#state.openCodeGo.binding;
    const key = keyFor(binding.accountId);
    const credentials = this.#credentials();
    if (!(await credentials.describeRecord(key)).configured) throw new TypeError('Go credential unavailable');
    const provider = `router-opencode-go-${binding.accountId}`;
    const source = { provider, connectionId: binding.connectionId, accountId: binding.accountId, configRevision: 1, ownership: 'router-owned', source: 'opencode-go', sourceKey: `opencode-go:${binding.accountId}`, billingPath: 'opencode-go-subscription', configured: true, authorizationStatus: 'configured', supportScope: 'opencode-go-responses-text-tools', models: [{ model: GO_MODEL, name: 'GPT 6 Luna (OpenCode Go)', maxContextTokens: null, capability: { text: { supported: true, confidence: 'declared', source: 'https://opencode.ai/docs/go/' }, tools: { supported: true, confidence: 'declared', source: 'https://opencode.ai/docs/go/' }, image: { supported: false, confidence: 'declared', source: 'router-text-only-adapter' } } }] };
    const active = { value: true };
    const getCredential = async () => {
      if (!active.value) throw new LlmError('Go connection is disconnected or its credential changed', 'AUTHORIZATION_CHANGED');
      const record = await credentials.readRecord(key);
      if (!active.value) throw new LlmError('Go credential changed during resolution', 'AUTHORIZATION_CHANGED');
      if (record?.kind !== 'api-key') throw new LlmError('Go credential unavailable', 'MISSING_CREDENTIAL');
      return { key: record.key, generation: binding.generation };
    };
    let unregister;
    const endpoint = this.#ctx.get('routerGoEndpoint');
    const transport = this.#ctx.get('routerGoTransport') ?? createSourceNetworkTransport({ lookup });
    const providerFiber = await this.#ctx.plugin({ inject: ['llm', 'credentials'], apply(ctx) {
      ctx.llm.registerAdapter([provider], new OpenCodeGoAdapter({ provider, getCredential, transport, ...(endpoint ? { endpoint } : {}) }));
      ctx.on('credentials/record-updated', updated => { if (String(updated) === String(key)) { active.value = false; unregister?.(); } });
      ctx.effect(() => () => { active.value = false; }, 'router: Go credential lifetime');
    } });
    let registryFiber;
    try { registryFiber = await this.#ctx.plugin({ inject: ['router'], apply(ctx) { unregister = ctx.router.registerOwned(source); ctx.effect(() => unregister, 'router: Go candidate lifetime'); } }); }
    catch (error) { active.value = false; await providerFiber.dispose(); throw error; }
    this.#mounted = { active, providerFiber, registryFiber };
  }
  async #unmount() {
    const mounted = this.#mounted; this.#mounted = undefined;
    if (!mounted) return;
    mounted.active.value = false;
    const results = await Promise.allSettled([mounted.registryFiber.dispose(), mounted.providerFiber.dispose()]);
    const rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
  }
  async dispose() { await this.#queue; await this.#unmount(); }
}
