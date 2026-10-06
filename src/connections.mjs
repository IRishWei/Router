import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discoverNativeConnections } from './native-connections.mjs';

export const IDENTITY_KEYS = ['connectionId', 'accountId', 'billingPath', 'provider', 'model'];
export const sameIdentity = (left, right) => IDENTITY_KEYS.every(key => left?.[key] === right?.[key]);
export const sameRoute = (left, right) => left?.provider === right?.provider && left?.model === right?.model;

const identitySchema = z.object(Object.fromEntries(IDENTITY_KEYS.map(key => [key, z.string().min(1)]))).strict();
const supportFactSchema = z.object({ supported: z.boolean().nullable(), confidence: z.string().min(1), source: z.string().min(1).optional() }).passthrough();
const capacityFactSchema = z.object({ value: z.number().int().positive().safe().nullable(), confidence: z.enum(['known', 'declared', 'unknown']), source: z.string().min(1) }).strict();
export const candidateSnapshotSchema = z.object({
  epoch: z.number().int().positive().safe(),
  snapshotEpoch: z.number().int().positive().safe(),
  capturedAt: z.string().nullable(),
  candidates: z.array(z.object({
    candidateId: z.string().min(1),
    identity: identitySchema,
    connectionConfigRevision: z.number().int().positive().safe(),
    authEpoch: z.number().int().positive().safe(),
    observedSettingsRevision: z.number().int().nonnegative().safe().nullable(),
    routerAuthorization: z.object({ status: z.enum(['enabled', 'disabled']) }).strict(),
    providerAuthorization: z.object({ status: z.string().min(1) }).strict(),
    availability: z.object({ status: z.enum(['available', 'unavailable']) }).strict(),
    inferenceVerification: z.object({ status: z.string().min(1) }).passthrough(),
    capabilities: z.object({
      modalities: z.object({ text: supportFactSchema, image: supportFactSchema }).strict(),
      text: supportFactSchema,
      image: supportFactSchema,
      tools: supportFactSchema,
      contextWindow: capacityFactSchema,
      inputLimit: capacityFactSchema,
      maxOutput: capacityFactSchema,
      maxContextTokens: z.number().int().positive().safe().nullable(),
      confidence: z.string().min(1),
      source: z.string().min(1),
    }).strict(),
    quote: z.json().nullable(),
    observations: z.array(z.json()),
  }).passthrough()),
  unsupported: z.array(z.json()),
}).strict();

function completeIdentity(value) {
  return Object.fromEntries(IDENTITY_KEYS.map(key => [key, value?.[key]]));
}

function validateOwned(source) {
  if (!source || !['provider', 'connectionId', 'accountId', 'billingPath', 'sourceKey'].every(key => typeof source[key] === 'string' && source[key]) || !Array.isArray(source.models) || !source.models.length) throw new TypeError('Invalid owned connection registration');
}

export class ConnectionRegistry {
  #ctx;
  #state;
  #config;
  #dirty;
  #owned = new Map();
  #refreshGeneration = 0;
  constructor(ctx, state, config, dirty = () => {}) {
    this.#ctx = ctx;
    this.#state = state;
    this.#config = config;
    this.#dirty = dirty;
    state.connections ??= { revision: 1, capturedAt: null, candidates: [], unsupported: [] };
  }
  get epoch() { return this.#state.connections.revision; }
  registerOwned(source) {
    validateOwned(source);
    if (this.#owned.has(source.provider)) throw new TypeError(`Owned route already registered: ${source.provider}`);
    this.#refreshGeneration += 1;
    this.#owned.set(source.provider, structuredClone(source));
    this.#upsert(source);
    return () => {
      if (!this.#owned.delete(source.provider)) return;
      this.#withdraw(source.provider, 'OWNED_ROUTE_REMOVED');
    };
  }
  async refresh({ signal } = {}) {
    const generation = ++this.#refreshGeneration;
    const discovered = await discoverNativeConnections(this.#ctx, new Set(this.#owned.keys()), signal);
    if (generation !== this.#refreshGeneration) return this.snapshot();
    const seen = new Set();
    for (const source of this.#owned.values()) { this.#upsert(source); for (const model of source.models) seen.add(`${source.provider}\0${model.model}`); }
    for (const source of discovered.connections) { this.#upsert(source); for (const model of source.models) seen.add(`${source.provider}\0${model.model}`); }
    for (const candidate of this.#state.connections.candidates) {
      const key = `${candidate.provider}\0${candidate.model}`;
      if (!seen.has(key) && candidate.available) {
        candidate.available = false;
        candidate.tombstone = { reason: 'HOST_CONNECTION_REMOVED', at: new Date().toISOString() };
        candidate.authEpoch += 1;
        this.#bump();
      }
    }
    this.#state.connections.unsupported = discovered.unsupported;
    this.#state.connections.capturedAt = new Date().toISOString();
    this.#dirty();
    return this.snapshot();
  }
  invalidateSettings(namespace, revision) {
    let changed = false;
    for (const candidate of this.#state.connections.candidates) if (candidate.ownership === 'native-reference' && candidate.settingsNs === namespace) {
      candidate.connectionConfigRevision += 1;
      candidate.observedSettingsRevision = Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
      candidate.authEpoch += 1;
      changed = true;
    }
    if (changed) { this.#refreshGeneration += 1; this.#bump(); this.#dirty(); }
  }
  invalidateCredentials() {
    let changed = false;
    for (const candidate of this.#state.connections.candidates) if (candidate.ownership === 'native-reference') { candidate.authEpoch += 1; changed = true; }
    if (changed) { this.#refreshGeneration += 1; this.#bump(); this.#dirty(); }
  }
  #upsert(source) {
    for (const model of source.models) {
      let candidate = this.#state.connections.candidates.find(item => item.provider === source.provider && item.model === model.model);
      const changed = candidate && (candidate.sourceKey !== source.sourceKey || candidate.available !== (source.available !== false));
      if (!candidate) {
        const ownedId = source.candidateIds?.[model.model];
        candidate = {
          candidateId: ownedId ?? randomUUID(),
          connectionId: source.connectionId ?? `dsh-native:${randomUUID()}`,
          accountId: source.accountId ?? 'unknown',
          billingPath: source.billingPath ?? 'unknown',
          provider: source.provider,
          model: model.model,
          connectionConfigRevision: Number.isSafeInteger(source.configRevision) && source.configRevision > 0 ? source.configRevision : 1,
          authEpoch: source.authEpoch ?? 1,
        };
        this.#state.connections.candidates.push(candidate);
        this.#bump();
      } else if (changed) {
        candidate.connectionConfigRevision += 1;
        candidate.authEpoch += 1;
        this.#bump();
      }
      Object.assign(candidate, {
        ...(source.connectionId ? { connectionId: source.connectionId } : {}),
        ...(source.accountId ? { accountId: source.accountId } : {}),
        ...(source.billingPath ? { billingPath: source.billingPath } : {}),
        ownership: source.ownership,
        source: source.source,
        sourceKey: source.sourceKey,
        name: model.name,
        available: source.available !== false,
        configured: source.configured ?? null,
        authorizationStatus: source.authorizationStatus ?? candidate.authorizationStatus ?? 'unknown',
        observedSettingsRevision: Number.isSafeInteger(source.settingsRevision) && source.settingsRevision >= 0 ? source.settingsRevision : null,
        capability: structuredClone(model.capability),
        maxContextTokens: model.maxContextTokens ?? null,
        supportScope: source.supportScope ?? (source.ownership === 'router-owned' ? 'controlled-protocol-fixture' : 'host-public-metadata'),
        settingsNs: source.settingsNs ?? null,
        settingsPath: source.settingsPath ?? null,
      });
      delete candidate.tombstone;
    }
  }
  #withdraw(provider, reason) {
    for (const candidate of this.#state.connections.candidates) if (candidate.provider === provider && candidate.available) {
      candidate.available = false;
      candidate.authEpoch += 1;
      candidate.tombstone = { reason, at: new Date().toISOString() };
      this.#bump();
    }
    this.#dirty();
  }
  #bump() { this.#state.connections.revision += 1; }
  resolve(candidateId, { allowLegacyControlled = true } = {}) {
    const candidate = this.#state.connections.candidates.find(item => item.candidateId === candidateId || (allowLegacyControlled && item.ownership === 'router-owned' && item.model === candidateId));
    if (!candidate) throw new TypeError('Unknown candidate');
    return candidate;
  }
  candidateForRoute(route) {
    const matches = this.#state.connections.candidates.filter(item => sameRoute(item, route));
    return matches.length === 1 ? matches[0] : null;
  }
  markManaged(candidateId) {
    const candidate = this.resolve(candidateId);
    if (!candidate.managed) { candidate.managed = true; this.#bump(); this.#dirty(); }
    return candidate;
  }
  markInference(candidateId, status) {
    const candidate = this.resolve(candidateId, { allowLegacyControlled: false });
    candidate.inferenceVerification = { status, at: new Date().toISOString() };
    this.#dirty();
  }
  isManagedRoute(route) { return this.#state.connections.candidates.some(item => sameRoute(item, route)); }
  capture(candidateId, stableRouterSnapshot = this.#config()) {
    const candidate = this.resolve(candidateId);
    const pool = stableRouterSnapshot.pool ?? [];
    const entry = pool.find(item => item.candidateId === candidate.candidateId || (candidate.ownership === 'router-owned' && item.model === candidate.model));
    const priced = (stableRouterSnapshot.prices ?? []).find(item => item.candidateId === candidate.candidateId || sameIdentity(item, candidate));
    const contextWindow = candidate.maxContextTokens === null ? { value: null, confidence: 'unknown', source: 'host-public-contract' } : { value: candidate.maxContextTokens, confidence: candidate.ownership === 'router-owned' ? 'known' : 'declared', source: candidate.ownership === 'router-owned' ? candidate.source : 'provider-model-metadata' };
    const unknownCapacity = { value: null, confidence: 'unknown', source: 'host-public-contract' };
    return structuredClone({
      candidateId: candidate.candidateId,
      identity: completeIdentity(candidate),
      registryEpoch: this.epoch,
      connectionConfigRevision: candidate.connectionConfigRevision,
      authEpoch: candidate.authEpoch,
      capability: candidate.capability,
      capabilities: { text: candidate.capability.text, image: candidate.capability.image, tools: candidate.capability.tools, contextWindow, inputLimit: unknownCapacity, maxOutput: unknownCapacity },
      maxContextTokens: candidate.maxContextTokens,
      quote: priced?.quote ?? null,
      quoteVersion: priced?.quoteVersion ?? null,
      enabled: Boolean(entry?.enabled),
    });
  }
  assertCurrent(selection) {
    const candidate = this.resolve(selection.candidateId, { allowLegacyControlled: false });
    const liveProviders = new Set(this.#ctx.llm.listProviders().map(item => item.id));
    if (!candidate.available || !liveProviders.has(candidate.provider)) throw Object.assign(new Error('Host connection is no longer available'), { code: 'CONNECTION_REMOVED' });
    if (candidate.authEpoch !== selection.authEpoch || candidate.connectionConfigRevision !== selection.connectionConfigRevision) throw Object.assign(new Error('Host connection changed after capture'), { code: 'CONNECTION_CHANGED' });
    const entry = (this.#config().pool ?? []).find(item => item.candidateId === candidate.candidateId || (candidate.ownership === 'router-owned' && item.model === candidate.model));
    if (!entry) throw Object.assign(new Error('Candidate was removed'), { code: 'MODEL_REMOVED' });
    if (!entry.enabled) throw Object.assign(new Error('Candidate is disabled'), { code: 'MODEL_DISABLED' });
  }
  snapshot(config = this.#config()) {
    const candidates = this.#state.connections.candidates.map(candidate => {
      const entry = (config.pool ?? []).find(item => item.candidateId === candidate.candidateId || (candidate.ownership === 'router-owned' && item.model === candidate.model));
      const quote = (config.prices ?? []).find(item => item.candidateId === candidate.candidateId || sameIdentity(item, candidate));
      const knownCapacity = candidate.maxContextTokens === null ? { value: null, confidence: 'unknown', source: 'host-public-contract' } : { value: candidate.maxContextTokens, confidence: candidate.ownership === 'router-owned' ? 'known' : 'declared', source: candidate.ownership === 'router-owned' ? candidate.source : 'provider-model-metadata' };
      const unknownCapacity = { value: null, confidence: 'unknown', source: 'host-public-contract' };
      const normalizedQuote = quote ? { ...structuredClone(quote.quote), quoteVersion: quote.quoteVersion ?? null, estimatedCost: null } : null;
      return {
        ...structuredClone(candidate),
        id: candidate.candidateId,
        identity: completeIdentity(candidate),
        enabled: Boolean(entry?.enabled),
        inPool: Boolean(entry),
        routerAuthorization: { status: entry?.enabled ? 'enabled' : 'disabled' },
        providerAuthorization: { status: candidate.source === 'controlled-protocol-fixture' ? 'controlled-fixture' : candidate.authorizationStatus ?? 'unknown' },
        authorization: { status: entry?.enabled ? 'enabled' : 'disabled', providerStatus: candidate.source === 'controlled-protocol-fixture' ? 'controlled-fixture' : candidate.authorizationStatus ?? 'unknown' },
        availability: { status: candidate.available ? 'available' : 'unavailable' },
        inferenceVerification: structuredClone(candidate.inferenceVerification ?? { status: 'unknown' }),
        capabilities: { modalities: { text: candidate.capability.text, image: candidate.capability.image }, text: candidate.capability.text, image: candidate.capability.image, tools: candidate.capability.tools, contextWindow: knownCapacity, inputLimit: unknownCapacity, maxOutput: unknownCapacity, maxContextTokens: candidate.maxContextTokens, confidence: candidate.capability.text.confidence, source: candidate.capability.text.source ?? candidate.source },
        quote: normalizedQuote,
        observations: [],
        compatibility: { confidence: candidate.ownership === 'router-owned' ? 'known' : 'declared', scope: candidate.supportScope },
      };
    });
    return candidateSnapshotSchema.parse({ epoch: this.epoch, snapshotEpoch: this.epoch, capturedAt: this.#state.connections.capturedAt, candidates, unsupported: structuredClone(this.#state.connections.unsupported) });
  }
}
