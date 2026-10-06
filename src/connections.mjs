import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discoverNativeConnections } from './native-connections.mjs';

export const IDENTITY_KEYS = ['connectionId', 'accountId', 'billingPath', 'provider', 'model'];
export const sameIdentity = (left, right) => IDENTITY_KEYS.every(key => left?.[key] === right?.[key]);
export const sameRoute = (left, right) => left?.provider === right?.provider && left?.model === right?.model;
const CONTROLLED_PROVIDER = 'router-controlled';
const CONTROLLED_SOURCE = 'controlled-protocol-fixture';
const CONTROLLED_MODELS = new Set(['controlled', 'controlled-tools']);
const isControlledFixture = candidate => candidate?.provider === CONTROLLED_PROVIDER
  && candidate?.connectionId === 'controlled-local'
  && candidate?.accountId === 'local'
  && candidate?.billingPath === 'controlled'
  && candidate?.ownership === 'router-owned'
  && candidate?.source === CONTROLLED_SOURCE
  && CONTROLLED_MODELS.has(candidate?.model)
  && candidate?.candidateId === candidate?.model;
const matchesCandidate = (entry, candidate) => entry?.candidateId === candidate.candidateId || (isControlledFixture(candidate) && entry?.candidateId === undefined && entry?.model === candidate.model);

const identitySchema = z.object(Object.fromEntries(IDENTITY_KEYS.map(key => [key, z.string().min(1)]))).strict();
const confidenceSchema = z.enum(['known', 'declared', 'unknown']);
const providerAuthorizationSchema = z.enum(['controlled-fixture', 'unknown', 'configured', 'authorized', 'unauthorized', 'error']);
const publicProviderAuthorizationSchema = z.enum(['unknown', 'configured', 'authorized', 'unauthorized', 'error']);
const supportFactSchema = z.object({ supported: z.boolean().nullable(), confidence: confidenceSchema, source: z.string().min(1).optional() });
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
    providerAuthorization: z.object({ status: providerAuthorizationSchema }).strict(),
    availability: z.object({ status: z.enum(['available', 'unavailable']) }).strict(),
    inferenceVerification: z.object({ status: z.enum(['unknown', 'verified', 'error']) }).passthrough(),
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

export function identityOf(value) {
  return Object.fromEntries(IDENTITY_KEYS.map(key => [key, value?.[key]]));
}

const ownedModelSchema = z.object({
  model: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  maxContextTokens: z.number().int().positive().safe().nullable().default(null),
  capability: z.object({ text: supportFactSchema, image: supportFactSchema, tools: supportFactSchema }),
});
const ownedSourceSchema = z.object({
  provider: z.string().min(1).max(200).refine(value => value !== CONTROLLED_PROVIDER, 'The controlled provider is reserved'),
  connectionId: z.string().min(1).max(500),
  accountId: z.string().min(1).max(500),
  billingPath: z.string().min(1).max(500),
  ownership: z.literal('router-owned'),
  source: z.string().min(1).max(200).refine(value => value !== CONTROLLED_SOURCE, 'The controlled source is reserved'),
  sourceKey: z.string().min(1).max(1000),
  configRevision: z.number().int().positive().safe(),
  configured: z.boolean().nullable().default(null),
  authorizationStatus: publicProviderAuthorizationSchema.default('unknown'),
  supportScope: z.string().min(1).max(200).refine(value => value !== CONTROLLED_SOURCE, 'The controlled scope is reserved').optional(),
  models: z.array(ownedModelSchema).min(1).max(1000),
}).refine(source => new Set(source.models.map(model => model.model)).size === source.models.length, 'Owned model routes must be unique');

function normalizeControlledSource(source) {
  const validIdentity = source?.provider === CONTROLLED_PROVIDER
    && source?.connectionId === 'controlled-local'
    && source?.accountId === 'local'
    && source?.billingPath === 'controlled'
    && source?.ownership === 'router-owned'
    && source?.source === CONTROLLED_SOURCE
    && source?.sourceKey === 'router-controlled:v1'
    && source?.configRevision === 1
    && source?.configured === true
    && Array.isArray(source?.models)
    && source.models.length === CONTROLLED_MODELS.size
    && source.models.every(model => CONTROLLED_MODELS.has(model.model) && source.candidateIds?.[model.model] === model.model);
  if (!validIdentity) throw new TypeError('Invalid controlled fixture registration');
  return structuredClone(source);
}

function normalizeOwnedSource(source) {
  const normalized = ownedSourceSchema.parse(source);
  for (const model of normalized.models) for (const fact of Object.values(model.capability)) {
    fact.confidence = fact.supported === null ? 'unknown' : 'declared';
    fact.source ??= 'owned-provider-metadata';
  }
  return normalized;
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
    return this.#registerOwned(normalizeOwnedSource(source));
  }
  registerControlledFixture(source) {
    return this.#registerOwned(normalizeControlledSource(source));
  }
  #registerOwned(source) {
    if (this.#owned.has(source.provider)) throw new TypeError(`Owned route already registered: ${source.provider}`);
    this.#refreshGeneration += 1;
    this.#owned.set(source.provider, source);
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
    if (JSON.stringify(this.#state.connections.unsupported) !== JSON.stringify(discovered.unsupported)) this.#bump();
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
      const route = { provider: source.provider, model: model.model };
      const routeCandidates = this.#state.connections.candidates.filter(item => sameRoute(item, route));
      const hasExplicitIdentity = ['connectionId', 'accountId', 'billingPath'].every(key => typeof source[key] === 'string' && source[key]);
      const sourceIdentity = hasExplicitIdentity ? identityOf({ ...source, model: model.model }) : null;
      let candidate = sourceIdentity
        ? routeCandidates.find(item => sameIdentity(item, sourceIdentity))
        : routeCandidates.find(item => item.ownership === 'native-reference');
      for (const replaced of routeCandidates) if (replaced !== candidate && replaced.available) {
        replaced.available = false;
        replaced.connectionConfigRevision += 1;
        replaced.authEpoch += 1;
        replaced.tombstone = { reason: 'CONNECTION_IDENTITY_REPLACED', at: new Date().toISOString() };
        this.#bump();
      }
      const nextMetadata = {
        ownership: source.ownership,
        source: source.source,
        sourceKey: source.sourceKey,
        name: model.name,
        available: source.available !== false,
        configured: source.configured ?? null,
        authorizationStatus: source.authorizationStatus ?? candidate?.authorizationStatus ?? 'unknown',
        capability: model.capability,
        maxContextTokens: model.maxContextTokens ?? null,
        supportScope: source.supportScope ?? (source.source === 'controlled-protocol-fixture' ? 'controlled-protocol-fixture' : source.ownership === 'router-owned' ? 'owned-provider-metadata' : 'host-public-metadata'),
        settingsNs: source.settingsNs ?? null,
        settingsPath: source.settingsPath ?? null,
        observedSettingsRevision: Number.isSafeInteger(source.settingsRevision) && source.settingsRevision >= 0 ? source.settingsRevision : null,
      };
      const changed = candidate && JSON.stringify(Object.fromEntries(Object.keys(nextMetadata).map(key => [key, candidate[key]]))) !== JSON.stringify(nextMetadata);
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
        ...structuredClone(nextMetadata),
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
    const candidate = this.#state.connections.candidates.find(item => item.candidateId === candidateId) ?? (allowLegacyControlled ? this.#state.connections.candidates.find(item => isControlledFixture(item) && item.model === candidateId) : null);
    if (!candidate) throw new TypeError('Unknown candidate');
    return candidate;
  }
  candidateForRoute(route) {
    const matches = this.#state.connections.candidates.filter(item => sameRoute(item, route));
    const available = matches.filter(item => item.available);
    if (available.length === 1) return available[0];
    if (available.length > 1) return null;
    return matches.filter(item => item.managed || item.ownership === 'router-owned').at(-1) ?? (matches.length === 1 ? matches[0] : null);
  }
  markManaged(candidateId) {
    const candidate = this.resolve(candidateId);
    if (!candidate.managed) { candidate.managed = true; this.#bump(); this.#dirty(); }
    return candidate;
  }
  markInference(candidateId, status) {
    if (!['unknown', 'verified', 'error'].includes(status)) throw new TypeError('Invalid inference verification status');
    const candidate = this.resolve(candidateId, { allowLegacyControlled: false });
    candidate.inferenceVerification = { status, at: new Date().toISOString() };
    this.#dirty();
  }
  isManagedRoute(route) { return this.#state.connections.candidates.some(item => sameRoute(item, route)); }
  capture(candidateId, stableRouterSnapshot = this.#config()) {
    const candidate = this.resolve(candidateId);
    const pool = stableRouterSnapshot.pool ?? [];
    const entry = pool.find(item => matchesCandidate(item, candidate));
    const priced = (stableRouterSnapshot.prices ?? []).find(item => item.candidateId === candidate.candidateId || sameIdentity(item, candidate));
    const controlled = isControlledFixture(candidate);
    const contextWindow = candidate.maxContextTokens === null ? { value: null, confidence: 'unknown', source: 'host-public-contract' } : { value: candidate.maxContextTokens, confidence: controlled ? 'known' : 'declared', source: controlled ? candidate.source : 'provider-model-metadata' };
    const unknownCapacity = { value: null, confidence: 'unknown', source: 'host-public-contract' };
    return structuredClone({
      candidateId: candidate.candidateId,
      identity: identityOf(candidate),
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
    const entry = (this.#config().pool ?? []).find(item => matchesCandidate(item, candidate));
    if (!entry) throw Object.assign(new Error('Candidate was removed'), { code: 'MODEL_REMOVED' });
    if (!entry.enabled) throw Object.assign(new Error('Candidate is disabled'), { code: 'MODEL_DISABLED' });
  }
  snapshot(config = this.#config()) {
    const candidates = this.#state.connections.candidates.map(candidate => {
      const entry = (config.pool ?? []).find(item => matchesCandidate(item, candidate));
      const quote = (config.prices ?? []).find(item => item.candidateId === candidate.candidateId || sameIdentity(item, candidate));
      const controlled = isControlledFixture(candidate);
      const knownCapacity = candidate.maxContextTokens === null ? { value: null, confidence: 'unknown', source: 'host-public-contract' } : { value: candidate.maxContextTokens, confidence: controlled ? 'known' : 'declared', source: controlled ? candidate.source : 'provider-model-metadata' };
      const unknownCapacity = { value: null, confidence: 'unknown', source: 'host-public-contract' };
      const normalizedQuote = quote ? { ...structuredClone(quote.quote), quoteVersion: quote.quoteVersion ?? null, estimatedCost: null } : null;
      return {
        ...structuredClone(candidate),
        id: candidate.candidateId,
        identity: identityOf(candidate),
        enabled: Boolean(entry?.enabled),
        inPool: Boolean(entry),
        routerAuthorization: { status: entry?.enabled ? 'enabled' : 'disabled' },
        providerAuthorization: { status: controlled ? 'controlled-fixture' : candidate.authorizationStatus ?? 'unknown' },
        authorization: { status: entry?.enabled ? 'enabled' : 'disabled', providerStatus: controlled ? 'controlled-fixture' : candidate.authorizationStatus ?? 'unknown' },
        availability: { status: candidate.available ? 'available' : 'unavailable' },
        inferenceVerification: structuredClone(candidate.inferenceVerification ?? { status: 'unknown' }),
        capabilities: { modalities: { text: candidate.capability.text, image: candidate.capability.image }, text: candidate.capability.text, image: candidate.capability.image, tools: candidate.capability.tools, contextWindow: knownCapacity, inputLimit: unknownCapacity, maxOutput: unknownCapacity, maxContextTokens: candidate.maxContextTokens, confidence: candidate.capability.text.confidence, source: candidate.capability.text.source ?? candidate.source },
        quote: normalizedQuote,
        observations: [],
        compatibility: { confidence: controlled ? 'known' : 'declared', scope: candidate.supportScope },
      };
    });
    return candidateSnapshotSchema.parse({ epoch: this.epoch, snapshotEpoch: this.epoch, capturedAt: this.#state.connections.capturedAt, candidates, unsupported: structuredClone(this.#state.connections.unsupported) });
  }
}
