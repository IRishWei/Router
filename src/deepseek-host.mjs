import { randomUUID } from 'node:crypto';
import {
  deleteDeepSeekCredential,
  DEEPSEEK_MODELS,
  deepSeekCredentialKey,
  describeDeepSeekCredential,
  fetchDeepSeekModelCatalog,
  storeDeepSeekApiKey,
} from './deepseek-connections.mjs';
import { mountDeepSeekRouterConnection } from './deepseek-router.mjs';

const emptyCatalog = () => ({ status: 'not-requested', models: [], unrecognizedModelIds: [] });

function normalizedState(value) {
  if (value === undefined) return { bindings: [], connections: [], catalog: emptyCatalog(), lastDetectionTaskId: null };
  if (!value || !Array.isArray(value.bindings) || !Array.isArray(value.connections) || !value.catalog) throw new Error('Unsupported DeepSeek Router state');
  const bindings = value.bindings.map(binding => {
    deepSeekCredentialKey(binding?.accountId);
    if (typeof binding.credentialGeneration !== 'string' || !binding.credentialGeneration) throw new Error('Unsupported DeepSeek credential generation');
    return { accountId: binding.accountId, credentialGeneration: binding.credentialGeneration };
  });
  if (new Set(bindings.map(binding => binding.accountId)).size !== bindings.length) throw new Error('Duplicate DeepSeek account binding');
  const byAccount = new Map(bindings.map(binding => [binding.accountId, binding]));
  const connections = value.connections.map(connection => {
    if (typeof connection?.connectionId !== 'string' || !connection.connectionId.startsWith('connection-') || !byAccount.has(connection.accountId)
      || connection.credentialGeneration !== byAccount.get(connection.accountId).credentialGeneration
      || !Number.isSafeInteger(connection.configRevision) || connection.configRevision < 1) throw new Error('Unsupported DeepSeek connection state');
    return { connectionId: connection.connectionId, accountId: connection.accountId, configRevision: connection.configRevision, credentialGeneration: connection.credentialGeneration };
  });
  if (new Set(connections.map(connection => connection.connectionId)).size !== connections.length) throw new Error('Duplicate DeepSeek connection');
  const catalog = value.catalog;
  if (!['not-requested', 'listed', 'error'].includes(catalog.status) || !Array.isArray(catalog.models) || !Array.isArray(catalog.unrecognizedModelIds)
    || catalog.models.some(model => typeof model?.id !== 'string' || typeof model?.name !== 'string')
    || catalog.unrecognizedModelIds.some(id => typeof id !== 'string')) throw new Error('Unsupported DeepSeek catalog state');
  if (value.lastDetectionTaskId !== null && typeof value.lastDetectionTaskId !== 'string') throw new Error('Unsupported DeepSeek detection state');
  return { bindings, connections, catalog: structuredClone(catalog), lastDetectionTaskId: value.lastDetectionTaskId ?? null };
}

export class DeepSeekHost {
  #ctx;
  #state;
  #connections = new Map();
  #changed;
  constructor(ctx, state, changed) {
    this.#ctx = ctx;
    this.#state = state;
    this.#changed = changed;
    state.deepSeek = normalizedState(state.deepSeek);
  }
  #credentials() {
    const credentials = this.#ctx.get('credentials');
    if (!credentials) throw new TypeError('DeepSeek credentials are unavailable');
    return credentials;
  }
  async restore() {
    if (!this.#ctx.get('credentials')) return;
    for (const connection of this.#state.deepSeek.connections) {
      try { await this.#mount(connection); }
      catch { /* Retain safe metadata; the unavailable connection remains inspectable. */ }
    }
  }
  async snapshot() {
    const bindings = [];
    const credentials = this.#ctx.get('credentials');
    for (const binding of this.#state.deepSeek.bindings) {
      const description = credentials
        ? await describeDeepSeekCredential(credentials, binding.accountId).catch(() => ({ configured: false, writable: false }))
        : { configured: false, writable: false };
      bindings.push({ accountId: binding.accountId, configured: description.configured, writable: description.writable });
    }
    return structuredClone({
      bindings,
      connections: this.#state.deepSeek.connections.map(connection => ({
        connectionId: connection.connectionId,
        accountId: connection.accountId,
        provider: `router-deepseek-${connection.accountId}`,
        configured: bindings.find(binding => binding.accountId === connection.accountId)?.configured ?? false,
      })),
      catalog: this.#state.deepSeek.catalog,
      lastDetectionTaskId: this.#state.deepSeek.lastDetectionTaskId,
    });
  }
  async saveCredential({ apiKey }) {
    const accountId = `account-${randomUUID()}`;
    const credentialGeneration = `generation-${randomUUID()}`;
    await storeDeepSeekApiKey(this.#credentials(), accountId, apiKey);
    this.#state.deepSeek.bindings.push({ accountId, credentialGeneration });
    try { await this.#changed(); }
    catch {
      this.#state.deepSeek.bindings = this.#state.deepSeek.bindings.filter(item => item.accountId !== accountId);
      await deleteDeepSeekCredential(this.#credentials(), accountId).catch(() => {});
      throw new Error('DeepSeek account could not be saved in Router storage');
    }
  }
  async discoverCatalog(signal) {
    const catalogURL = this.#ctx.get('routerDeepSeekCatalogURL');
    try {
      const catalog = await fetchDeepSeekModelCatalog({ ...(catalogURL ? { catalogURL } : {}), signal });
      this.#state.deepSeek.catalog = {
        ...catalog,
        models: catalog.models.map(model => ({ ...model, name: model.name ?? DEEPSEEK_MODELS.find(item => item.id === model.id)?.name ?? model.id })),
      };
      await this.#changed();
    } catch (error) {
      this.#state.deepSeek.catalog = { status: 'error', models: [], unrecognizedModelIds: [] };
      await this.#changed();
      throw error;
    }
  }
  async connect({ accountId }) {
    const binding = this.#state.deepSeek.bindings.find(item => item.accountId === accountId);
    if (!binding) throw new TypeError('Unknown DeepSeek account binding');
    const credential = await describeDeepSeekCredential(this.#credentials(), accountId);
    if (!credential.configured) throw new TypeError('DeepSeek account credential is unavailable');
    const connection = {
      connectionId: `connection-${randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: binding.credentialGeneration,
    };
    await this.#mount(connection);
    this.#state.deepSeek.connections.push(connection);
    try { await this.#changed(); }
    catch {
      this.#state.deepSeek.connections = this.#state.deepSeek.connections.filter(item => item.connectionId !== connection.connectionId);
      const mounted = this.#connections.get(connection.connectionId);
      this.#connections.delete(connection.connectionId);
      await mounted?.disconnect({ deleteCredential: false });
      throw new Error('DeepSeek connection could not be saved in Router storage');
    }
  }
  async disconnect({ connectionId, deleteCredential = false }) {
    const index = this.#state.deepSeek.connections.findIndex(item => item.connectionId === connectionId);
    if (index < 0) throw new TypeError('Unknown DeepSeek connection');
    const [connection] = this.#state.deepSeek.connections.splice(index, 1);
    const mounted = this.#connections.get(connectionId);
    this.#connections.delete(connectionId);
    if (mounted) await mounted.disconnect({ deleteCredential: false });
    if (deleteCredential) {
      await deleteDeepSeekCredential(this.#credentials(), connection.accountId);
      this.#state.deepSeek.bindings = this.#state.deepSeek.bindings.filter(item => item.accountId !== connection.accountId);
      for (const sibling of [...this.#state.deepSeek.connections]) if (sibling.accountId === connection.accountId) {
        await this.disconnect({ connectionId: sibling.connectionId, deleteCredential: false });
      }
    }
    await this.#changed();
  }
  setLastDetectionTask(taskId) {
    this.#state.deepSeek.lastDetectionTaskId = taskId;
  }
  async #mount(connection) {
    const endpoint = this.#ctx.get('routerDeepSeekEndpoint');
    const mounted = await mountDeepSeekRouterConnection(this.#ctx, {
      ...connection,
      ...(endpoint ? { endpoint } : {}),
    });
    this.#connections.set(connection.connectionId, mounted);
  }
  async dispose() {
    await Promise.allSettled([...this.#connections.values()].map(connection => connection.disconnect({ deleteCredential: false })));
    this.#connections.clear();
  }
}
