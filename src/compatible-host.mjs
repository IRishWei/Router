import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { compatibleEndpoint, compatibleModel, CompatibleResponsesAdapter, discoverCompatibleModels } from './compatible-responses.mjs';
import { createSourceNetworkTransport } from './source-network.mjs';

const id = z.string().uuid();
const entrySchema = z.object({ id, name: z.string().min(1).max(100), endpoint: z.string().transform(compatibleEndpoint), model: z.string().transform(compatibleModel), tools: z.boolean(), generation: id, connected: z.boolean(), detectionClaim: id.nullable(), lastDetectionTaskId: z.string().nullable(), catalog: z.object({ status: z.enum(['not-requested', 'listed', 'error']), models: z.array(z.string().transform(compatibleModel)).max(1000), failureCode: z.string().nullable() }).strict() }).strict();
const keyFor = value => credentialKey('irishwei-dsh-router-compatible', `account-${id.parse(value)}`);
const publicEntry = entry => ({ id: entry.id, name: entry.name, endpoint: entry.endpoint, model: entry.model, tools: entry.tools, protocol: 'responses-sse-text-functions', image: 'unsupported', billingPath: 'compatible-unconfirmed', detectionClaimed: entry.detectionClaim !== null, lastDetectionTaskId: entry.lastDetectionTaskId, catalog: structuredClone(entry.catalog) });

export class CompatibleHost {
  #ctx; #state; #changed; #mounted = new Map(); #queue = Promise.resolve();
  constructor(ctx, state, changed) {
    this.#ctx = ctx; this.#state = state; this.#changed = changed;
    state.compatible ??= { entries: [] }; state.compatible = z.object({ entries: z.array(entrySchema).max(20) }).strict().parse(state.compatible);
    if (new Set(state.compatible.entries.map(entry => entry.id)).size !== state.compatible.entries.length) throw new TypeError('Duplicate compatible connection');
  }
  #entry(value) { const entry = this.#state.compatible.entries.find(item => item.id === value); if (!entry) throw new TypeError('Compatible connection unavailable'); return entry; }
  #credentials() { const value = this.#ctx.get('credentials'); if (!value) throw new TypeError('Host credential storage unavailable'); return value; }
  #transport() { return this.#ctx.get('routerCompatibleTransport') ?? createSourceNetworkTransport({ lookup }); }
  #serial(action) { const result = this.#queue.then(action); this.#queue = result.catch(() => {}); return result; }
  async snapshot() { return { entries: await Promise.all(this.#state.compatible.entries.map(async entry => ({ ...publicEntry(entry), configured: await this.#ctx.get('credentials')?.describeRecord(keyFor(entry.id)).then(info => info.configured).catch(() => false) ?? false, connected: this.#mounted.get(entry.id)?.active.value === true }))) }; }
  async restore() { for (const entry of this.#state.compatible.entries) if (entry.connected && this.#ctx.get('credentials')) { try { await this.#mount(entry); } catch { /* Metadata remains available without inference certification. */ } } }
  add(request) { return this.#serial(async () => {
    if (this.#state.compatible.entries.length >= 20) throw new TypeError('Compatible connection limit reached');
    const entry = entrySchema.parse({ id: randomUUID(), name: request.name, endpoint: request.endpoint, model: request.model, tools: request.tools, generation: randomUUID(), connected: false, detectionClaim: null, lastDetectionTaskId: null, catalog: { status: 'not-requested', models: [], failureCode: null } });
    const key = assertUsableApiKey(request.apiKey, 'dsh-router-compatible', 'owned-credential');
    if ([entry.name, entry.endpoint, entry.model].some(value => value.includes(key))) throw new TypeError('Credential material cannot appear in connection metadata');
    await this.#credentials().modifyRecord(keyFor(entry.id), async current => { if (current !== undefined) throw new TypeError('Credential already exists'); return { kind: 'api-key', key }; });
    this.#state.compatible.entries.push(entry);
    try { await this.#changed(); } catch { this.#state.compatible.entries.pop(); await this.#credentials().deleteRecord(keyFor(entry.id)).catch(() => {}); throw new Error('Compatible connection could not be persisted'); }
  }); }
  connect({ id: value }) { return this.#serial(async () => {
    const entry = this.#entry(value); if (this.#mounted.get(value)?.active.value) return;
    await this.#unmount(value); await this.#mount(entry); entry.connected = true;
    try { await this.#changed(); } catch { entry.connected = false; await this.#unmount(value); throw new Error('Compatible connection could not be persisted'); }
  }); }
  disconnect({ id: value, deleteCredential = false }) { return this.#serial(async () => {
    const entry = this.#entry(value); entry.connected = false; await this.#unmount(value);
    if (deleteCredential) await this.#credentials().deleteRecord(keyFor(value));
    // Keep metadata and consumed detection claims after deletion.
    await this.#changed();
  }); }
  discover({ id: value }) { return this.#serial(async () => {
    const entry = this.#entry(value);
    try { const credential = await this.#credentials().readRecord(keyFor(value)); entry.catalog = { status: 'listed', models: await discoverCompatibleModels({ endpoint: entry.endpoint, key: credential?.kind === 'api-key' ? credential.key : undefined, transport: this.#transport() }), failureCode: null }; }
    catch (error) { entry.catalog = { status: 'error', models: [], failureCode: error.code ?? 'CATALOG_UNAVAILABLE' }; }
    await this.#changed();
  }); }
  async claimDetectionTask(connectionId) { return this.#serial(async () => { const entry = this.#entry(connectionId); if (!this.#mounted.get(connectionId)?.active.value || entry.detectionClaim) throw new TypeError('Compatible detection unavailable or already used'); entry.detectionClaim = randomUUID(); await this.#changed(); return entry.detectionClaim; }); }
  requiresGoBalanceAttestation(connectionId) { return this.#entry(connectionId).endpoint === 'https://opencode.ai/zen/go/v1'; }
  async finalizeDetectionTask(claim, taskId) { const entry = this.#state.compatible.entries.find(item => item.detectionClaim === claim); if (!entry) throw new TypeError('Detection claim mismatch'); entry.lastDetectionTaskId = taskId; await this.#changed(); }
  async #mount(entry) {
    const credentials = this.#credentials(); const key = keyFor(entry.id);
    if (!(await credentials.describeRecord(key)).configured) throw new TypeError('Compatible credential unavailable');
    const active = { value: true }, provider = `router-compatible-${entry.id}`;
    const getCredential = async () => { if (!active.value) throw new LlmError('Compatible authorization changed', 'AUTHORIZATION_CHANGED'); const value = await credentials.readRecord(key); if (!active.value) throw new LlmError('Compatible authorization changed', 'AUTHORIZATION_CHANGED'); if (value?.kind !== 'api-key') throw new LlmError('Compatible credential unavailable', 'MISSING_CREDENTIAL'); return { key: value.key, generation: entry.generation }; };
    const adapter = new CompatibleResponsesAdapter({ provider, endpoint: entry.endpoint, model: entry.model, tools: entry.tools, getCredential, transport: this.#transport() });
    let unregister;
    const providerFiber = await this.#ctx.plugin({ inject: ['llm', 'credentials'], apply(ctx) {
      ctx.llm.registerAdapter([provider], adapter);
      ctx.on('credentials/record-updated', updated => { if (String(updated) === String(key)) { active.value = false; unregister?.(); } });
      ctx.effect(() => () => { active.value = false; }, 'router: compatible credential lifetime');
    } });
    let registryFiber;
    try { registryFiber = await this.#ctx.plugin({ inject: ['router'], apply(ctx) {
      unregister = ctx.router.registerOwned({ provider, connectionId: entry.id, accountId: entry.id, configRevision: 1, ownership: 'router-owned', source: 'openai-compatible', sourceKey: `compatible:${entry.id}`, billingPath: 'compatible-unconfirmed', configured: true, authorizationStatus: 'configured', supportScope: 'responses-sse-text-functions', models: [{ model: entry.model, name: entry.name + ' · ' + entry.model, maxContextTokens: null, capability: { text: { supported: true, confidence: 'declared', source: 'configured-Responses-contract' }, tools: { supported: entry.tools, confidence: 'declared', source: 'user-declared-functions-contract' }, image: { supported: false, confidence: 'declared', source: 'text-only-compatible-adapter' } } }] });
      ctx.effect(() => unregister, 'router: compatible candidate lifetime');
    } }); } catch (error) { active.value = false; await providerFiber.dispose(); throw error; }
    this.#mounted.set(entry.id, { active, providerFiber, registryFiber });
  }
  async #unmount(value) { const mounted = this.#mounted.get(value); this.#mounted.delete(value); if (!mounted) return; mounted.active.value = false; const results = await Promise.allSettled([mounted.registryFiber.dispose(), mounted.providerFiber.dispose()]); const failed = results.find(item => item.status === 'rejected'); if (failed) throw failed.reason; }
  async dispose() { await this.#queue; for (const value of this.#mounted.keys()) await this.#unmount(value); }
}
