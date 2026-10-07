import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { locateArtifactClaim, parseResearchArtifact } from './research-artifact.mjs';
import { createSourceNetworkReader } from './source-network.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const id = (kind, value) => `${kind}:v1:${digest(value).slice(0, 24)}`;
const DEFAULT_LIMITS = Object.freeze({ maxClaims: 16, maxSources: 8, maxSourceReferences: 32, maxInputBytes: 32_768, maxArtifactBytes: 262_144, maxClaimBytes: 2_048, maxQuoteBytes: 4_096, maxBytes: 65_536, timeoutMs: 5_000, maxRedirects: 2 });
const DIGEST = /^[a-f0-9]{64}$/u;
const REASON = /^[A-Z][A-Z0-9_]+$/u;
const CONTENT_TYPES = new Set(['text/plain', 'text/html', 'application/json']);
const byteLength = value => Buffer.byteLength(value, 'utf8');
const codedError = code => Object.assign(new Error(code), { code });
const boundedOperation = (start, { deadline, signal }) => new Promise((resolve, reject) => {
  let settled = false;
  let timer;
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  };
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    handler(value);
  };
  const abort = () => finish(reject, codedError('CANCELED'));
  if (signal?.aborted) return abort();
  const remaining = deadline - Date.now();
  if (remaining <= 0) return finish(reject, codedError('SOURCE_TIMEOUT'));
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => finish(reject, codedError('SOURCE_TIMEOUT')), remaining);
  try { Promise.resolve(start()).then(value => finish(resolve, value), error => finish(reject, error)); }
  catch (error) { finish(reject, error); }
});
const finiteLimits = values => {
  const result = { ...DEFAULT_LIMITS, ...values };
  const maxima = { maxClaims: 64, maxSources: 32, maxSourceReferences: 128, maxInputBytes: 262_144, maxArtifactBytes: 1_048_576, maxClaimBytes: 16_384, maxQuoteBytes: 16_384, maxBytes: 1_048_576, timeoutMs: 30_000, maxRedirects: 5 };
  for (const [key, maximum] of Object.entries(maxima)) {
    const minimum = key === 'maxRedirects' ? 0 : 1;
    if (!Number.isSafeInteger(result[key]) || result[key] < minimum || result[key] > maximum) throw new RangeError(`Invalid fixed source limit: ${key}`);
  }
  return Object.freeze(result);
};
const artifactRecord = artifact => artifact ? Object.fromEntries(['id', 'version', 'revision', 'kind', 'sessionId', 'turn', 'step', 'messageId', 'seq', 'hash', 'complete'].filter(key => artifact[key] !== undefined).map(key => [key, structuredClone(artifact[key])])) : null;
const sameArtifact = (left, right) => JSON.stringify(artifactRecord(left)) === JSON.stringify(artifactRecord(right));
const transferBudgets = new WeakSet();
const createTransferBudget = limit => {
  let used = 0;
  const budget = Object.freeze({
    consume(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Invalid transferred byte count');
      used += bytes;
      return used <= limit;
    },
    get used() { return used; },
    get remaining() { return Math.max(0, limit - used); },
  });
  transferBudgets.add(budget);
  return budget;
};

const displayUrl = value => {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
};

const canonicalSourceKey = value => {
  try {
    const url = new URL(value);
    url.hash = '';
    return `url:${url.href}`;
  } catch {
    return `invalid:${digest(String(value))}`;
  }
};

const parseClauses = inputs => inputs.flatMap(input => {
  if (!input || typeof input.text !== 'string') return [];
  const marker = '仅检查以下研究要求：';
  const start = input.text.indexOf(marker);
  if (start < 0) return [];
  const body = input.text.slice(start + marker.length);
  const explicitStart = body.indexOf('仅检查以下明确要求：');
  return (explicitStart < 0 ? body : body.slice(0, explicitStart)).split(/\r?\n/u).map(value => value.trim().replace(/。$/u, '')).filter(Boolean).map((text, index) => ({ text, input, index }));
});

const parseResearch = inputs => {
  const claims = new Map();
  const inferences = [];
  const unresolved = [];
  for (const clause of parseClauses(inputs)) {
    const missing = clause.text.match(/^论点「([^」]+)」必须有来源$/u);
    const conflict = clause.text.match(/^论点「([^」]+)」需要检查来源冲突$/u);
    const inference = clause.text.match(/^推论「([^」]+)」必须由论点「([^」]+)」支持$/u);
    if (inference) {
      inferences.push({ inference: inference[1], premise: inference[2], origin: { kind: 'user-message', messageId: clause.input.messageId, requestId: clause.input.requestId ?? null, seq: clause.input.seq ?? null, clause: clause.index } });
      continue;
    }
    if (!missing && !conflict) {
      unresolved.push({ description: clause.text, reason: 'RESEARCH_REQUIREMENT_UNRESOLVED', origin: { kind: 'user-message', messageId: clause.input.messageId, requestId: clause.input.requestId ?? null, seq: clause.input.seq ?? null, clause: clause.index } });
      continue;
    }
    const claim = (missing ?? conflict)[1];
    const key = digest(claim);
    if (!claims.has(key)) claims.set(key, { claim, origins: [], sources: [], conflict: false });
    const entry = claims.get(key);
    entry.origins.push({ kind: 'user-message', messageId: clause.input.messageId, requestId: clause.input.requestId ?? null, seq: clause.input.seq ?? null, clause: clause.index });
    if (conflict) entry.conflict = true;
  }
  return { claims: [...claims.values()], inferences, unresolved };
};

const parseArtifactSources = (artifact, maxSourceReferences) => {
  const parsed = parseResearchArtifact(artifact?.text, maxSourceReferences);
  return {
    ...parsed,
    sources: parsed.sources.map(source => ({
      claim: source.claim,
      url: source.url,
      quote: source.quote,
      origin: { kind: 'assistant-artifact', artifactId: artifact.id, revision: artifact.revision, messageId: artifact.messageId, seq: artifact.seq, line: source.line },
    })),
  };
};

const normalizeResolution = (value, maxBytes) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['available', 'unavailable', 'invalid'].includes(value.access)) return { access: 'unavailable', reason: 'SOURCE_RESULT_INVALID' };
  if (value.access !== 'available') return {
    access: value.access,
    reason: typeof value.reason === 'string' && REASON.test(value.reason) ? value.reason : 'SOURCE_RESULT_INVALID',
    ...(Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? { httpStatus: value.httpStatus } : {}),
    ...(typeof value.contentType === 'string' ? { contentType: value.contentType } : {}),
  };
  const contentType = typeof value.contentType === 'string' ? value.contentType.toLowerCase() : '';
  let safeDisplay;
  try { safeDisplay = displayUrl(value.displayUrl); } catch { return { access: 'unavailable', reason: 'SOURCE_RESULT_INVALID' }; }
  if (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 200 || value.httpStatus >= 300 || !CONTENT_TYPES.has(contentType)
    || typeof value.body !== 'string' || byteLength(value.body) > maxBytes || !DIGEST.test(value.urlHash ?? '') || !DIGEST.test(value.contentHash ?? '') || digest(value.body) !== value.contentHash) return { access: 'unavailable', reason: 'SOURCE_RESULT_INVALID' };
  return { access: 'available', displayUrl: safeDisplay, urlHash: value.urlHash, httpStatus: value.httpStatus, contentType, contentHash: value.contentHash, body: value.body };
};

const safeUrl = (value, authorizeUrl) => {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048) return null;
  if (url.port && url.port !== (url.protocol === 'http:' ? '80' : '443') && authorizeUrl?.({ url: new URL(url), reason: 'nonstandard-port' }) !== true) return null;
  url.hash = '';
  return url;
};

export function createHttpSourceEvidenceResolver({ authorizeUrl, authorizeAddress, lookup = dnsLookup, discoverProxy, resolveProxyAddresses, platform, tlsOptions, limits = {} } = {}) {
  const fixed = finiteLimits(limits);
  const readSource = createSourceNetworkReader({ lookup, discoverProxy, resolveProxyAddresses, platform, tlsOptions, directOnly: lookup !== dnsLookup && !discoverProxy });
  return async ({ sourceRef, signal, limits: requestLimits, transferBudget: suppliedTransferBudget }) => {
    const timeoutMs = Number.isSafeInteger(requestLimits?.timeoutMs) && requestLimits.timeoutMs > 0 ? Math.min(fixed.timeoutMs, requestLimits.timeoutMs) : fixed.timeoutMs;
    const maxBytes = Number.isSafeInteger(requestLimits?.maxBytes) && requestLimits.maxBytes > 0 ? Math.min(fixed.maxBytes, requestLimits.maxBytes) : fixed.maxBytes;
    const transferBudget = transferBudgets.has(suppliedTransferBudget) ? suppliedTransferBudget : createTransferBudget(maxBytes);
    const deadline = Date.now() + timeoutMs;
    let current = safeUrl(sourceRef.url, authorizeUrl);
    if (!current) return { access: 'invalid', reason: 'SOURCE_REFERENCE_INVALID' };
    const initialHost = current.hostname;
    for (let redirect = 0; redirect <= fixed.maxRedirects; redirect++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { access: 'unavailable', reason: 'SOURCE_TIMEOUT' };
      const outcome = await readSource(current, { authorizeAddress, deadline, signal, maxBytes, transferBudget });
      if (outcome.error) return { access: 'unavailable', reason: outcome.error.code ?? 'SOURCE_UNAVAILABLE' };
      const { response, body } = outcome;
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        if (redirect === fixed.maxRedirects) return { access: 'unavailable', reason: 'SOURCE_REDIRECT_LIMIT' };
        const next = safeUrl(new URL(response.headers.location, current).href, authorizeUrl);
        if (!next || next.hostname !== initialHost) return { access: 'unavailable', reason: 'SOURCE_REDIRECT_NOT_AUTHORIZED' };
        current = next;
        continue;
      }
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (response.statusCode < 200 || response.statusCode >= 300) return { access: 'unavailable', reason: 'SOURCE_HTTP_ERROR', httpStatus: response.statusCode };
      if (!['text/plain', 'text/html', 'application/json'].includes(contentType)) return { access: 'unavailable', reason: 'SOURCE_MEDIA_UNSUPPORTED', httpStatus: response.statusCode, contentType };
      return {
        access: 'available', displayUrl: displayUrl(current), urlHash: digest(current.href),
        httpStatus: response.statusCode, contentType, contentHash: digest(body), body,
      };
    }
    return { access: 'unavailable', reason: 'SOURCE_UNAVAILABLE' };
  };
}

export function createResearchAcceptance({ resolveSourceEvidence, limits = {} } = {}) {
  if (typeof resolveSourceEvidence !== 'function') throw new TypeError('resolveSourceEvidence is required');
  const fixed = finiteLimits(limits);
  return {
    async contribute({ task, inputs, artifact, signal }) {
      const safeInputs = Array.isArray(inputs) ? inputs : [];
      const inputBytes = safeInputs.reduce((sum, item) => sum + (typeof item?.text === 'string' ? byteLength(item.text) : 0), 0);
      const inputLimitExceeded = inputBytes > fixed.maxInputBytes;
      let parsed = inputLimitExceeded ? { claims: [], inferences: [], unresolved: [] } : parseResearch(safeInputs);
      const artifactLimitExceeded = typeof artifact?.text === 'string' && byteLength(artifact.text) > fixed.maxArtifactBytes;
      const artifactSources = artifactLimitExceeded ? { sources: [], body: '', referenceLimitExceeded: false } : parseArtifactSources(artifact, fixed.maxSourceReferences);
      if (!inputLimitExceeded) for (const source of artifactSources.sources) {
        const claim = parsed.claims.find(item => item.claim === source.claim);
        if (claim) claim.sources.push({ url: source.url, quote: source.quote, origin: source.origin });
      }
      if (inputLimitExceeded || parsed.claims.length + parsed.inferences.length > fixed.maxClaims) {
        parsed = { claims: [], inferences: [], unresolved: [{ description: 'Research acceptance input exceeds its fixed limit.', reason: 'RESEARCH_INPUT_LIMIT_EXCEEDED', origin: { kind: 'host-limit' } }] };
      }
      const requirementHash = digest(JSON.stringify({
        claims: parsed.claims.map(item => ({ claim: item.claim, conflict: item.conflict })),
        inferences: parsed.inferences.map(item => ({ inference: item.inference, premise: item.premise })),
        unresolved: parsed.unresolved.map(item => ({ descriptionHash: digest(item.description), reason: item.reason })),
      }));
      const persistedHistory = Array.isArray(task?.acceptance?.history) ? task.acceptance.history : [];
      const persisted = [task?.acceptance?.research, ...persistedHistory.map(entry => entry?.research)]
        .find(item => item?.version === 1 && item.requirementHash === requirementHash && sameArtifact(item.artifact, artifact));
      const requirements = [];
      const evidence = [];
      const sourceReferences = [];
      const sourceSnapshots = [];
      const reviewCases = [];
      const compiledClaims = new Map();
      const allowedSourceKeys = new Set();
      for (const claim of parsed.claims) for (const source of claim.sources) {
        const key = canonicalSourceKey(source.url);
        if (allowedSourceKeys.has(key)) continue;
        if (allowedSourceKeys.size < fixed.maxSources) allowedSourceKeys.add(key);
      }
      const contributionDeadline = Date.now() + fixed.timeoutMs;
      const freshResolutions = new Map();
      const transferBudget = createTransferBudget(fixed.maxBytes);
      const resolveFresh = source => {
        const sourceKey = canonicalSourceKey(source.url);
        if (!allowedSourceKeys.has(sourceKey)) return Promise.resolve({ access: 'unavailable', reason: 'SOURCE_LIMIT_EXCEEDED' });
        if (freshResolutions.has(sourceKey)) return freshResolutions.get(sourceKey);
        const resolution = (async () => {
          const timeoutMs = contributionDeadline - Date.now();
          if (timeoutMs <= 0) return { access: 'unavailable', reason: 'SOURCE_TIMEOUT' };
          const byteLimit = transferBudget.remaining;
          if (byteLimit <= 0) return { access: 'unavailable', reason: 'SOURCE_TOTAL_BYTES_EXCEEDED' };
          let raw;
          try {
            const transferredBefore = transferBudget.used;
            raw = await boundedOperation(() => resolveSourceEvidence({ taskId: task.id, sourceRef: structuredClone(source), signal, limits: { ...structuredClone(fixed), maxBytes: byteLimit, timeoutMs }, transferBudget }), { deadline: contributionDeadline, signal });
            if (transferBudget.used === transferredBefore && raw?.access === 'available' && typeof raw.body === 'string' && !transferBudget.consume(byteLength(raw.body))) return { access: 'unavailable', reason: 'SOURCE_TOTAL_BYTES_EXCEEDED' };
          } catch (error) {
            return { access: 'unavailable', reason: ['SOURCE_TIMEOUT', 'CANCELED'].includes(error?.code) ? error.code : 'SOURCE_UNAVAILABLE' };
          }
          if (raw?.access === 'available' && typeof raw.body === 'string' && byteLength(raw.body) > byteLimit) return { access: 'unavailable', reason: 'SOURCE_TOTAL_BYTES_EXCEEDED' };
          if (raw?.reason === 'SOURCE_TOO_LARGE' && byteLimit < fixed.maxBytes) return { access: 'unavailable', reason: 'SOURCE_TOTAL_BYTES_EXCEEDED' };
          const normalized = normalizeResolution(raw, byteLimit);
          return normalized;
        })();
        freshResolutions.set(sourceKey, resolution);
        return resolution;
      };
      for (const claim of parsed.claims) {
        const claimId = id('claim', claim.claim);
        const requirement = { id: id('requirement', `${task.id}:${claimId}`), version: 1, kind: 'research-claim', claimId, claim: claim.claim, conflict: claim.conflict, required: true, origin: claim.origins[0] };
        requirements.push(requirement);
        const artifactLocator = artifactLimitExceeded ? null : locateArtifactClaim(artifact?.text, claim.claim);
        const artifactClaimEvidence = { id: id('evidence', `${requirement.id}:artifact-claim:${artifact?.id ?? 'missing'}`), version: 1, requirementId: requirement.id, claimId, artifactHash: artifact?.hash ?? null, aspect: 'artifact-claim', verdict: artifactLimitExceeded || !artifact?.complete ? 'unconfirmed' : artifactLocator ? 'passed' : 'failed', source: { kind: 'deterministic-rule', rule: 'exact-claim-presence', checkerVersion: 1 }, ...(artifactLimitExceeded ? { reason: 'RESEARCH_ARTIFACT_LIMIT_EXCEEDED' } : !artifact?.complete ? { reason: 'ARTIFACT_INCOMPLETE' } : !artifactLocator ? { reason: 'CLAIM_NOT_IN_ARTIFACT' } : { artifactQuote: claim.claim, artifactLocator }) };
        evidence.push(artifactClaimEvidence);
        const resolvedSources = [];
        const sourceLimitExceeded = claim.sources.some(source => !allowedSourceKeys.has(canonicalSourceKey(source.url)));
        const sourceContractExceeded = byteLength(claim.claim) > fixed.maxClaimBytes || claim.sources.some(source => byteLength(source.quote) > fixed.maxQuoteBytes);
        const sourcesToResolve = sourceContractExceeded ? [] : claim.sources;
        for (const [sourceIndex, source] of sourcesToResolve.entries()) {
          const referenceId = id('source-reference', `${requirement.id}:${sourceIndex}:${digest(source.url)}:${digest(source.quote)}`);
          const cacheKey = digest(JSON.stringify({ version: 1, urlHash: digest(source.url), quoteHash: digest(source.quote), maxBytes: fixed.maxBytes, maxRedirects: fixed.maxRedirects }));
          const cachedSnapshot = persisted?.sourceSnapshots?.find(item => item?.version === 1 && item.sourceReferenceId === referenceId && item.cacheKey === cacheKey);
          const cachedReference = persisted?.sourceReferences?.find(item => item?.version === 1 && item.id === referenceId && item.requirementId === requirement.id && item.claimId === claimId);
          const cachedQuote = persisted?.evidence?.find(item => item?.version === 1 && item.requirementId === requirement.id && item.sourceReferenceId === referenceId && item.aspect === 'quote-binding');
          const cachedAccess = persisted?.evidence?.find(item => item?.version === 1 && item.requirementId === requirement.id && item.sourceReferenceId === referenceId && item.aspect === 'source-access');
          const cachedAvailable = cachedSnapshot?.access === 'available';
          const validCachedLocator = cachedQuote?.verdict !== 'passed' || (cachedQuote.sourceQuote === source.quote && cachedQuote.sourceQuoteHash === digest(source.quote) && cachedQuote.sourceLocator?.kind === 'unicode-code-points' && Number.isSafeInteger(cachedQuote.sourceLocator.start) && Number.isSafeInteger(cachedQuote.sourceLocator.end) && cachedQuote.sourceLocator.start >= 0 && cachedQuote.sourceLocator.end >= cachedQuote.sourceLocator.start);
          const canReuse = cachedSnapshot && cachedReference && cachedQuote && cachedAccess && DIGEST.test(cachedSnapshot.cacheKey) && typeof cachedSnapshot.capturedAt === 'string'
            && ['available', 'unavailable', 'invalid'].includes(cachedSnapshot.access) && (!cachedAvailable || (DIGEST.test(cachedSnapshot.urlHash ?? '') && DIGEST.test(cachedSnapshot.contentHash ?? '') && Number.isSafeInteger(cachedSnapshot.httpStatus) && CONTENT_TYPES.has(cachedSnapshot.contentType)))
            && cachedReference.quote === source.quote && cachedReference.quoteHash === digest(source.quote)
            && cachedQuote.sourceSnapshotId === cachedSnapshot.id && cachedAccess.sourceSnapshotId === cachedSnapshot.id && validCachedLocator
            && ['passed', 'failed', 'unconfirmed'].includes(cachedQuote.verdict) && cachedAccess.verdict === (cachedAvailable ? 'passed' : cachedSnapshot.access === 'invalid' ? 'failed' : 'unconfirmed');
          const resolved = canReuse
            ? { access: cachedSnapshot.access, displayUrl: cachedSnapshot.displayUrl, urlHash: cachedSnapshot.urlHash, httpStatus: cachedSnapshot.httpStatus, contentType: cachedSnapshot.contentType, contentHash: cachedSnapshot.contentHash, reason: cachedSnapshot.reason }
            : signal?.aborted ? { access: 'unavailable', reason: 'CANCELED' } : await resolveFresh(source);
          const snapshotId = canReuse ? cachedSnapshot.id : id('source-snapshot', `${referenceId}:${resolved.contentHash ?? resolved.reason ?? 'unknown'}`);
          sourceReferences.push({ id: referenceId, version: 1, requirementId: requirement.id, claimId, quote: source.quote, quoteHash: digest(source.quote), origin: structuredClone(source.origin) });
          sourceSnapshots.push(canReuse ? structuredClone(cachedSnapshot) : { id: snapshotId, version: 1, sourceReferenceId: referenceId, cacheKey, capturedAt: new Date().toISOString(), access: resolved.access, ...(resolved.displayUrl ? { displayUrl: resolved.displayUrl } : {}), ...(resolved.urlHash ? { urlHash: resolved.urlHash } : {}), ...(resolved.httpStatus !== undefined ? { httpStatus: resolved.httpStatus } : {}), ...(resolved.contentType ? { contentType: resolved.contentType } : {}), ...(resolved.contentHash ? { contentHash: resolved.contentHash } : {}), ...(resolved.reason ? { reason: resolved.reason } : {}) });
          const accessPassed = resolved.access === 'available';
          evidence.push({ id: id('evidence', `${requirement.id}:${referenceId}:source-access`), version: 1, requirementId: requirement.id, claimId, aspect: 'source-access', sourceReferenceId: referenceId, sourceSnapshotId: snapshotId, verdict: accessPassed ? 'passed' : resolved.access === 'invalid' ? 'failed' : 'unconfirmed', source: { kind: 'source-adapter', checkerVersion: 1 }, ...(!accessPassed ? { reason: resolved.reason ?? 'SOURCE_UNAVAILABLE' } : {}) });
          const quoteStart = canReuse ? cachedQuote.sourceLocator?.start ?? -1 : accessPassed && typeof resolved.body === 'string' ? resolved.body.indexOf(source.quote) : -1;
          const quoteMatches = canReuse ? cachedQuote.verdict === 'passed' && quoteStart >= 0 : quoteStart >= 0;
          const sourceLocator = quoteMatches ? canReuse ? structuredClone(cachedQuote.sourceLocator) : { kind: 'unicode-code-points', start: [...resolved.body.slice(0, quoteStart)].length, end: [...resolved.body.slice(0, quoteStart + source.quote.length)].length } : null;
          evidence.push({ id: id('evidence', `${requirement.id}:${referenceId}:quote-binding`), version: 1, requirementId: requirement.id, claimId, aspect: 'quote-binding', sourceReferenceId: referenceId, sourceSnapshotId: snapshotId, verdict: !accessPassed ? 'unconfirmed' : quoteMatches ? 'passed' : 'failed', source: { kind: 'deterministic-rule', rule: 'exact-source-quote', checkerVersion: 1 }, ...(!accessPassed ? { reason: resolved.reason ?? 'SOURCE_UNAVAILABLE' } : !quoteMatches ? { reason: 'SOURCE_QUOTE_MISMATCH' } : { sourceQuote: source.quote, sourceQuoteHash: digest(source.quote), sourceLocator }) });
          resolvedSources.push({ referenceId, snapshotId, resolved, quote: source.quote, quoteMatches, sourceLocator });
        }
        const firstFailure = resolvedSources.find(item => item.resolved.access === 'available' && !item.quoteMatches);
        const firstUnavailable = resolvedSources.find(item => item.resolved.access !== 'available');
        const boundedArtifact = !artifactLimitExceeded && !artifactSources.referenceLimitExceeded;
        const reviewEligible = artifactClaimEvidence.verdict === 'passed' && boundedArtifact && resolvedSources.length > 0 && resolvedSources.every(item => item.quoteMatches) && !sourceLimitExceeded && !sourceContractExceeded;
        const supportVerdict = artifactClaimEvidence.verdict === 'unconfirmed' ? 'unconfirmed'
          : artifactClaimEvidence.verdict === 'failed' || boundedArtifact && (!claim.sources.length || firstFailure) ? 'failed' : 'unconfirmed';
        const supportReason = artifactLimitExceeded ? 'RESEARCH_ARTIFACT_LIMIT_EXCEEDED' : !artifact?.complete ? 'ARTIFACT_INCOMPLETE' : artifactClaimEvidence.verdict === 'failed' ? 'CLAIM_NOT_IN_ARTIFACT' : artifactSources.referenceLimitExceeded ? 'SOURCE_REFERENCE_LIMIT_EXCEEDED' : !claim.sources.length ? 'SOURCE_MISSING' : firstFailure ? 'SOURCE_QUOTE_MISMATCH' : sourceLimitExceeded ? 'SOURCE_LIMIT_EXCEEDED' : sourceContractExceeded ? 'RESEARCH_INPUT_LIMIT_EXCEEDED' : firstUnavailable ? firstUnavailable.resolved.reason ?? 'SOURCE_UNAVAILABLE' : claim.conflict ? 'SOURCE_CONFLICT' : 'SOURCE_SUPPORT_REVIEW_REQUIRED';
        const supportEvidence = { id: id('evidence', `${requirement.id}:claim-support`), version: 1, requirementId: requirement.id, claimId, aspect: 'claim-support', sourceReferenceIds: resolvedSources.map(item => item.referenceId), sourceSnapshotIds: resolvedSources.map(item => item.snapshotId), verdict: supportVerdict, source: reviewEligible ? { kind: 'research-review', confidence: 'unconfirmed' } : { kind: 'deterministic-rule', rule: 'research-source-requirement', checkerVersion: 1 }, reason: supportReason };
        evidence.push(supportEvidence);
        if (reviewEligible) {
          reviewCases.push({
            id: id('review-case', `${requirement.id}:${claim.conflict ? 'source-conflict' : 'claim-support'}`), version: 1,
            kind: claim.conflict ? 'source-conflict' : 'claim-support', requirementIds: [requirement.id], evidenceIds: [supportEvidence.id], risk: claim.conflict ? 'high' : 'standard',
            subjectHash: digest(`${claim.claim}\n${resolvedSources.map(item => item.quote).join('\n')}`),
            anonymousPayload: { claims: [{ id: claimId, text: claim.claim }], sources: resolvedSources.map(item => ({ id: item.snapshotId, contentHash: item.resolved.contentHash, excerpts: [{ text: item.quote, hash: digest(item.quote), locator: item.sourceLocator }] })) },
          });
        }
        compiledClaims.set(claim.claim, { claim, claimId, requirement, resolvedSources, sourceLimitExceeded, firstFailure, firstUnavailable, boundedArtifact, reviewEligible });
      }
      for (const inference of parsed.inferences) {
        const claimId = id('claim', inference.inference);
        const premise = compiledClaims.get(inference.premise);
        const requirement = { id: id('requirement', `${task.id}:${claimId}:inference`), version: 1, kind: 'research-inference', claimId, claim: inference.inference, premiseClaimId: id('claim', inference.premise), premise: inference.premise, required: true, origin: inference.origin };
        requirements.push(requirement);
        const artifactLocator = artifactLimitExceeded ? null : locateArtifactClaim(artifact?.text, inference.inference);
        const artifactClaimEvidence = { id: id('evidence', `${requirement.id}:artifact-claim:${artifact?.id ?? 'missing'}`), version: 1, requirementId: requirement.id, claimId, artifactHash: artifact?.hash ?? null, aspect: 'artifact-claim', verdict: artifactLimitExceeded || !artifact?.complete ? 'unconfirmed' : artifactLocator ? 'passed' : 'failed', source: { kind: 'deterministic-rule', rule: 'exact-claim-presence', checkerVersion: 1 }, ...(artifactLimitExceeded ? { reason: 'RESEARCH_ARTIFACT_LIMIT_EXCEEDED' } : !artifact?.complete ? { reason: 'ARTIFACT_INCOMPLETE' } : !artifactLocator ? { reason: 'CLAIM_NOT_IN_ARTIFACT' } : { artifactQuote: inference.inference, artifactLocator }) };
        evidence.push(artifactClaimEvidence);
        const eligible = artifactClaimEvidence.verdict === 'passed' && premise?.reviewEligible === true;
        const supportEvidence = { id: id('evidence', `${requirement.id}:claim-support`), version: 1, requirementId: requirement.id, claimId, aspect: 'claim-support', sourceReferenceIds: premise?.resolvedSources.map(item => item.referenceId) ?? [], sourceSnapshotIds: premise?.resolvedSources.map(item => item.snapshotId) ?? [], verdict: artifactClaimEvidence.verdict === 'unconfirmed' ? 'unconfirmed' : artifactClaimEvidence.verdict === 'failed' || !premise ? 'failed' : 'unconfirmed', source: eligible ? { kind: 'research-review', confidence: 'unconfirmed' } : { kind: 'deterministic-rule', rule: 'research-inference-requirement', checkerVersion: 1 }, reason: artifactLimitExceeded ? 'RESEARCH_ARTIFACT_LIMIT_EXCEEDED' : !artifact?.complete ? 'ARTIFACT_INCOMPLETE' : artifactClaimEvidence.verdict === 'failed' ? 'CLAIM_NOT_IN_ARTIFACT' : artifactSources.referenceLimitExceeded ? 'SOURCE_REFERENCE_LIMIT_EXCEEDED' : !premise ? 'PREMISE_MISSING' : premise.firstFailure ? 'SOURCE_QUOTE_MISMATCH' : premise.firstUnavailable ? premise.firstUnavailable.resolved.reason ?? 'SOURCE_UNAVAILABLE' : eligible ? 'INFERENCE_UNSUPPORTED' : 'SOURCE_MISSING' };
        evidence.push(supportEvidence);
        if (eligible) reviewCases.push({ id: id('review-case', `${requirement.id}:inference-support`), version: 1, kind: 'inference-support', requirementIds: [requirement.id], evidenceIds: [supportEvidence.id], risk: 'standard', subjectHash: digest(`${inference.premise}\n${inference.inference}`), anonymousPayload: { claims: [{ id: premise.claimId, text: inference.premise }, { id: claimId, text: inference.inference, premiseClaimId: premise.claimId }], sources: premise.resolvedSources.map(item => ({ id: item.snapshotId, contentHash: item.resolved.contentHash, excerpts: [{ text: item.quote, hash: digest(item.quote), locator: item.sourceLocator }] })) } });
      }
      for (const unresolved of parsed.unresolved) {
        const requirement = { id: id('requirement', `${task.id}:unresolved:${digest(unresolved.description)}`), version: 1, kind: 'research-unresolved', description: unresolved.description, required: true, origin: unresolved.origin };
        requirements.push(requirement);
        evidence.push({ id: id('evidence', `${requirement.id}:interpretation`), version: 1, requirementId: requirement.id, aspect: 'requirement-interpretation', verdict: 'unconfirmed', source: { kind: 'deterministic-rule', rule: 'finite-research-dsl', checkerVersion: 1 }, reason: unresolved.reason });
      }
      return { version: 1, schemaVersion: 1, domain: 'research', taskId: task.id, requirementHash, artifact: artifactRecord(artifact), requirements, evidence, sourceReferences, sourceSnapshots, reviewCases, limitations: ['finite-explicit-research-dsl', 'source-access-does-not-prove-claim-support', 'semantic-support-requires-coordinator-review'] };
    },
  };
}
