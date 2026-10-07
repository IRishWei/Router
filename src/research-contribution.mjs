import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { artifactClaimMatches } from './research-artifact.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const ID = /^(?:claim|requirement|evidence|source-reference|source-snapshot|review-case):v1:[a-f0-9]{24}$/u;
const REASON = /^[A-Z][A-Z0-9_]+$/u;
const CONTENT_TYPES = new Set(['text/plain', 'text/html', 'application/json']);
const LIMITATIONS = new Set(['finite-explicit-research-dsl', 'source-access-does-not-prove-claim-support', 'semantic-support-requires-coordinator-review']);
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = label => { throw new TypeError(`Invalid research contribution: ${label}`); };
const string = value => typeof value === 'string' && value.length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = (value, label, required, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) fail(label);
  return value;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(label);
};
const locator = (value, label) => {
  record(value, label, ['kind', 'start', 'end']);
  if (value.kind !== 'unicode-code-points' || !integer(value.start) || !integer(value.end) || value.end < value.start) fail(label);
};
const artifactIdentity = artifact => artifact ? Object.fromEntries(['id', 'version', 'revision', 'kind', 'sessionId', 'turn', 'step', 'messageId', 'seq', 'hash', 'complete'].filter(key => artifact[key] !== undefined).map(key => [key, structuredClone(artifact[key])])) : null;
const freeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const validateOrigin = (origin, artifact) => {
  if (origin?.kind === 'user-message') {
    record(origin, 'requirement origin', ['kind', 'messageId', 'requestId', 'seq', 'clause']);
    if (!string(origin.messageId) || !(origin.requestId === null || string(origin.requestId)) || !(origin.seq === null || integer(origin.seq)) || !integer(origin.clause)) fail('requirement origin');
    return;
  }
  if (origin?.kind === 'host-limit') {
    record(origin, 'limit origin', ['kind']);
    return;
  }
  if (origin?.kind === 'assistant-artifact') {
    record(origin, 'source origin', ['kind', 'artifactId', 'revision', 'messageId', 'seq', 'line']);
    if (origin.artifactId !== artifact?.id || origin.revision !== artifact?.revision || origin.messageId !== artifact?.messageId || origin.seq !== artifact?.seq || !integer(origin.line)) fail('source origin');
    return;
  }
  fail('origin kind');
};

const validateSource = source => {
  if (source?.kind === 'deterministic-rule') {
    record(source, 'evidence source', ['kind', 'rule', 'checkerVersion']);
    if (!string(source.rule) || source.checkerVersion !== 1) fail('evidence source');
    return;
  }
  if (source?.kind === 'source-adapter') {
    record(source, 'evidence source', ['kind', 'checkerVersion']);
    if (source.checkerVersion !== 1) fail('evidence source');
    return;
  }
  if (source?.kind === 'research-review') {
    record(source, 'evidence source', ['kind', 'confidence']);
    if (source.confidence !== 'unconfirmed') fail('evidence source');
    return;
  }
  fail('evidence source');
};

/**
 * Host trust boundary for AcceptanceCoordinator contributors. It accepts data only,
 * verifies the complete reference closure, returns a detached deeply frozen record,
 * and deliberately has no publish, budget, model or tool capability.
 */
export function validateResearchContribution(value, { taskId, artifact } = {}) {
  record(value, 'root', ['version', 'schemaVersion', 'domain', 'taskId', 'requirementHash', 'artifact', 'requirements', 'evidence', 'sourceReferences', 'sourceSnapshots', 'reviewCases', 'limitations']);
  if (value.version !== 1 || value.schemaVersion !== 1 || value.domain !== 'research' || !string(taskId) || value.taskId !== taskId || !DIGEST.test(value.requirementHash)) fail('root identity');
  if (!isDeepStrictEqual(value.artifact, artifactIdentity(artifact))) fail('artifact identity');
  for (const key of ['requirements', 'evidence', 'sourceReferences', 'sourceSnapshots', 'reviewCases', 'limitations']) if (!Array.isArray(value[key])) fail(key);
  if (value.limitations.length !== LIMITATIONS.size || new Set(value.limitations).size !== value.limitations.length || value.limitations.some(item => !LIMITATIONS.has(item))) fail('limitations');

  const requirements = new Map();
  for (const item of value.requirements) {
    const common = ['id', 'version', 'kind', 'required', 'origin'];
    const fields = item?.kind === 'research-claim' ? ['claimId', 'claim', 'conflict']
      : item?.kind === 'research-inference' ? ['claimId', 'claim', 'premiseClaimId', 'premise']
        : item?.kind === 'research-unresolved' ? ['description'] : fail('requirement kind');
    record(item, 'requirement', [...common, ...fields]);
    if (!ID.test(item.id) || item.version !== 1 || item.required !== true || requirements.has(item.id)) fail('requirement identity');
    if (item.kind === 'research-unresolved') {
      if (!string(item.description)) fail('unresolved requirement');
    } else if (!ID.test(item.claimId) || !string(item.claim) || (item.kind === 'research-claim' && typeof item.conflict !== 'boolean') || (item.kind === 'research-inference' && (!ID.test(item.premiseClaimId) || !string(item.premise)))) fail('claim requirement');
    validateOrigin(item.origin, value.artifact);
    requirements.set(item.id, item);
  }

  const references = new Map();
  for (const item of value.sourceReferences) {
    record(item, 'source reference', ['id', 'version', 'requirementId', 'claimId', 'quote', 'quoteHash', 'origin']);
    const requirement = requirements.get(item.requirementId);
    if (!ID.test(item.id) || item.version !== 1 || references.has(item.id) || requirement?.kind !== 'research-claim' || item.claimId !== requirement.claimId || !string(item.quote) || item.quoteHash !== digest(item.quote)) fail('source reference');
    validateOrigin(item.origin, value.artifact);
    if (item.origin.kind !== 'assistant-artifact') fail('source reference origin');
    references.set(item.id, item);
  }

  const snapshots = new Map();
  for (const item of value.sourceSnapshots) {
    record(item, 'source snapshot', ['id', 'version', 'sourceReferenceId', 'cacheKey', 'capturedAt', 'access'], ['displayUrl', 'urlHash', 'httpStatus', 'contentType', 'contentHash', 'reason']);
    if (!ID.test(item.id) || item.version !== 1 || snapshots.has(item.id) || !references.has(item.sourceReferenceId) || !DIGEST.test(item.cacheKey) || !string(item.capturedAt) || Number.isNaN(Date.parse(item.capturedAt)) || !['available', 'unavailable', 'invalid'].includes(item.access)) fail('source snapshot');
    if (item.access === 'available') {
      let displayed;
      try { displayed = new URL(item.displayUrl); } catch { fail('available source snapshot'); }
      if (!['http:', 'https:'].includes(displayed.protocol) || displayed.username || displayed.password || /[?#]/u.test(item.displayUrl) || !DIGEST.test(item.urlHash) || !integer(item.httpStatus) || item.httpStatus < 200 || item.httpStatus >= 300 || !CONTENT_TYPES.has(item.contentType) || !DIGEST.test(item.contentHash) || item.reason !== undefined) fail('available source snapshot');
    } else if (!REASON.test(item.reason ?? '') || ['displayUrl', 'urlHash', 'contentHash'].some(key => Object.hasOwn(item, key))
      || (item.httpStatus !== undefined && (!integer(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599))
      || (item.contentType !== undefined && (!string(item.contentType) || item.contentType.length > 100 || /[\r\n]/u.test(item.contentType)))) fail('unavailable source snapshot');
    snapshots.set(item.id, item);
  }

  const evidence = new Map();
  for (const item of value.evidence) {
    record(item, 'evidence', ['id', 'version', 'requirementId', 'aspect', 'verdict', 'source'], ['claimId', 'artifactHash', 'reason', 'artifactQuote', 'artifactLocator', 'sourceReferenceId', 'sourceSnapshotId', 'sourceQuote', 'sourceQuoteHash', 'sourceLocator', 'sourceReferenceIds', 'sourceSnapshotIds']);
    const requirement = requirements.get(item.requirementId);
    if (!ID.test(item.id) || item.version !== 1 || evidence.has(item.id) || !requirement || !['artifact-claim', 'source-access', 'quote-binding', 'claim-support', 'requirement-interpretation'].includes(item.aspect) || !['passed', 'failed', 'unconfirmed'].includes(item.verdict)) fail('evidence identity');
    if (requirement.claimId !== undefined && item.claimId !== requirement.claimId) fail('evidence claim');
    validateSource(item.source);
    if (item.reason !== undefined && !REASON.test(item.reason)) fail('evidence reason');
    if (item.aspect === 'artifact-claim') {
      if (item.artifactHash !== value.artifact?.hash) fail('artifact evidence');
      if (item.verdict === 'passed') {
        if (item.artifactQuote !== requirement.claim) fail('artifact quote');
        locator(item.artifactLocator, 'artifact locator');
        if (!artifactClaimMatches(artifact?.text, item.artifactQuote, item.artifactLocator)) fail('artifact locator');
      }
    } else if (item.aspect === 'source-access' || item.aspect === 'quote-binding') {
      const reference = references.get(item.sourceReferenceId);
      const snapshot = snapshots.get(item.sourceSnapshotId);
      if (!reference || !snapshot || snapshot.sourceReferenceId !== reference.id || reference.requirementId !== item.requirementId) fail('source evidence reference');
      if (item.aspect === 'source-access' && item.verdict !== (snapshot.access === 'available' ? 'passed' : snapshot.access === 'invalid' ? 'failed' : 'unconfirmed')) fail('source access verdict');
      if (item.aspect === 'quote-binding' && item.verdict === 'passed') {
        if (snapshot.access !== 'available' || item.sourceQuote !== reference.quote || item.sourceQuoteHash !== reference.quoteHash) fail('source quote');
        locator(item.sourceLocator, 'source locator');
      }
    } else if (item.aspect === 'claim-support') {
      if (!Array.isArray(item.sourceReferenceIds) || !Array.isArray(item.sourceSnapshotIds) || item.sourceReferenceIds.length !== item.sourceSnapshotIds.length) fail('claim support references');
      unique(item.sourceReferenceIds, 'claim support references');
      for (let index = 0; index < item.sourceReferenceIds.length; index++) {
        const reference = references.get(item.sourceReferenceIds[index]);
        const snapshot = snapshots.get(item.sourceSnapshotIds[index]);
        const ownsReference = reference && (reference.requirementId === item.requirementId
          || (requirement.kind === 'research-inference' && reference.claimId === requirement.premiseClaimId));
        if (!ownsReference || !snapshot || snapshot.sourceReferenceId !== reference.id) fail('claim support closure');
      }
    } else if (requirement.kind !== 'research-unresolved') fail('interpretation evidence');
    evidence.set(item.id, item);
  }

  for (const reference of references.values()) {
    const linked = [...evidence.values()].filter(item => item.sourceReferenceId === reference.id);
    if (!linked.some(item => item.aspect === 'source-access') || !linked.some(item => item.aspect === 'quote-binding')) fail('source evidence closure');
  }
  for (const snapshot of snapshots.values()) if (![...evidence.values()].some(item => item.sourceSnapshotId === snapshot.id || item.sourceSnapshotIds?.includes(snapshot.id))) fail('snapshot evidence closure');
  const expectedRequirementHash = digest(JSON.stringify({
    claims: [...requirements.values()].filter(item => item.kind === 'research-claim').map(item => ({ claim: item.claim, conflict: item.conflict })),
    inferences: [...requirements.values()].filter(item => item.kind === 'research-inference').map(item => ({ inference: item.claim, premise: item.premise })),
    unresolved: [...requirements.values()].filter(item => item.kind === 'research-unresolved').map(item => ({
      descriptionHash: digest(item.description),
      reason: [...evidence.values()].find(entry => entry.requirementId === item.id && entry.aspect === 'requirement-interpretation')?.reason,
    })),
  }));
  if (value.requirementHash !== expectedRequirementHash) fail('requirement hash');

  const reviewIds = [];
  for (const item of value.reviewCases) {
    record(item, 'review case', ['id', 'version', 'kind', 'requirementIds', 'evidenceIds', 'risk', 'subjectHash', 'anonymousPayload']);
    if (!ID.test(item.id) || item.version !== 1 || !['claim-support', 'source-conflict', 'inference-support'].includes(item.kind) || !['standard', 'high'].includes(item.risk) || !DIGEST.test(item.subjectHash) || !Array.isArray(item.requirementIds) || !item.requirementIds.length || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length) fail('review case');
    reviewIds.push(item.id);
    unique(item.requirementIds, 'review requirements'); unique(item.evidenceIds, 'review evidence');
    if (item.requirementIds.some(id => !requirements.has(id)) || item.evidenceIds.some(id => evidence.get(id)?.aspect !== 'claim-support' || evidence.get(id)?.verdict !== 'unconfirmed')) fail('review links');
    record(item.anonymousPayload, 'anonymous payload', ['claims', 'sources']);
    if (!Array.isArray(item.anonymousPayload.claims) || !item.anonymousPayload.claims.length || !Array.isArray(item.anonymousPayload.sources) || !item.anonymousPayload.sources.length) fail('anonymous payload');
    for (const claim of item.anonymousPayload.claims) {
      record(claim, 'anonymous claim', ['id', 'text'], ['premiseClaimId']);
      if (!ID.test(claim.id) || !string(claim.text) || ![...requirements.values()].some(requirement => requirement.claimId === claim.id && requirement.claim === claim.text)) fail('anonymous claim');
    }
    for (const source of item.anonymousPayload.sources) {
      record(source, 'anonymous source', ['id', 'contentHash', 'excerpts']);
      const snapshot = snapshots.get(source.id);
      if (!snapshot || snapshot.access !== 'available' || source.contentHash !== snapshot.contentHash || !Array.isArray(source.excerpts) || source.excerpts.length !== 1) fail('anonymous source');
      const excerpt = source.excerpts[0];
      record(excerpt, 'anonymous excerpt', ['text', 'hash', 'locator']);
      locator(excerpt.locator, 'anonymous excerpt locator');
      const binding = [...evidence.values()].find(entry => entry.aspect === 'quote-binding' && entry.sourceSnapshotId === source.id && entry.verdict === 'passed');
      if (!binding || excerpt.text !== binding.sourceQuote || excerpt.hash !== digest(excerpt.text) || !isDeepStrictEqual(excerpt.locator, binding.sourceLocator)) fail('anonymous excerpt');
    }
    const inference = item.anonymousPayload.claims.find(claim => claim.premiseClaimId);
    const expectedSubject = inference
      ? `${item.anonymousPayload.claims.find(claim => claim.id === inference.premiseClaimId)?.text ?? ''}\n${inference.text}`
      : `${item.anonymousPayload.claims[0].text}\n${item.anonymousPayload.sources.map(source => source.excerpts[0].text).join('\n')}`;
    if (item.subjectHash !== digest(expectedSubject) || (item.kind === 'source-conflict') !== (item.risk === 'high')) fail('review subject');
  }
  unique(reviewIds, 'review ids');
  return freeze(structuredClone(value));
}
