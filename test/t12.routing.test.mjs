import assert from 'node:assert/strict';
import test from 'node:test';
import { selectInitialRoute } from '../src/routing.mjs';

function candidate(candidateId, overrides = {}) {
  return {
    candidateId,
    connectionId: `connection-${candidateId}`,
    accountId: `account-${candidateId}`,
    billingPath: 'api',
    provider: `provider-${candidateId}`,
    model: `model-${candidateId}`,
    ownership: 'router',
    source: 'test-registry',
    authorization: { status: 'controlled-fixture' },
    availability: { status: 'available' },
    enabled: true,
    inPool: true,
    capabilities: {
      modalities: {
        text: { supported: true, confidence: 'verified' },
        image: { supported: false, confidence: 'verified' },
      },
      tools: { supported: true, confidence: 'verified' },
      maxContextTokens: 32_000,
      confidence: 'verified',
      source: 'adapter',
    },
    connectionConfigRevision: 4,
    authEpoch: 7,
    ...overrides,
  };
}

function snapshot(...candidates) {
  return { snapshotEpoch: 11, candidates };
}

function quote(candidateId, rate, currency = 'USD', kind = 'api-calculated') {
  return {
    quoteVersion: `quote-${candidateId}`,
    source: 'fixture quote',
    date: '2026-10-07',
    currency,
    kind,
    confidence: 'known',
    perMillion: { input: rate, output: rate },
    reasoning: 'included-in-output',
  };
}

const forecast = { inputTokens: 500_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 1_000_000 };

test('eligibility and required capabilities are enforced before a cheap candidate can win', () => {
  const cheapButUnauthorized = candidate('cheap', {
    availability: { status: 'unavailable' },
    quote: quote('cheap', 0.01),
  });
  const imageUnknown = candidate('unknown-image', {
    capabilities: {
      modalities: {
        text: { supported: true, confidence: 'verified' },
        image: { supported: null, confidence: 'unknown' },
      },
      tools: { supported: true, confidence: 'verified' },
      maxContextTokens: 32_000,
      confidence: 'verified',
      source: 'adapter',
    },
    quote: quote('unknown', 0.02),
  });
  const qualified = candidate('qualified', {
    capabilities: {
      modalities: {
        text: { supported: true, confidence: 'verified' },
        image: { supported: true, confidence: 'declared' },
      },
      tools: { supported: true, confidence: 'verified' },
      maxContextTokens: 64_000,
      confidence: 'declared',
      source: 'catalog',
    },
    quote: quote('qualified', 0.30),
  });

  const decision = selectInitialRoute({
    task: { requirements: { modalities: ['text', 'image'], tools: true, contextTokens: 48_000 } },
    candidateSnapshot: snapshot(cheapButUnauthorized, imageUnknown, qualified),
    objective: 'cost',
  });

  assert.equal(decision.kind, 'execute');
  assert.equal(decision.selected.candidateId, 'qualified');
  assert.deepEqual(decision.selected.identity, {
    connectionId: qualified.connectionId,
    accountId: qualified.accountId,
    billingPath: qualified.billingPath,
    provider: qualified.provider,
    model: qualified.model,
  });
  assert.equal(decision.selected.snapshotEpoch, 11);
  assert.equal(decision.selected.quoteVersion, 'quote-qualified');
  assert.deepEqual(decision.excluded, [
    { candidateId: 'cheap', reasons: ['CANDIDATE_UNAVAILABLE'] },
    { candidateId: 'unknown-image', reasons: ['IMAGE_CAPABILITY_UNKNOWN', 'CONTEXT_CAPACITY_INSUFFICIENT'] },
  ]);
  assert.ok(decision.reasonCodes.includes('SINGLE_ELIGIBLE_CANDIDATE'));
});

test('balanced, cost, token, speed and quality objectives choose from comparable measured evidence', () => {
  const measured = (candidateId, cost) => candidate(candidateId, {
    quote: quote(candidateId, cost),
  });
  const candidates = snapshot(
    measured('economy', 1),
    measured('fast', 3),
    measured('quality', 4),
    measured('balanced', 2),
  );
  const observations = {
    economy: { totalTokens: 100, latencyMs: 1_000, quality: 0.60 },
    fast: { totalTokens: 120, latencyMs: 100, quality: 0.70 },
    quality: { totalTokens: 180, latencyMs: 900, quality: 0.95 },
    balanced: { totalTokens: 110, latencyMs: 300, quality: 0.85 },
  };
  const observationHistory = Object.fromEntries(Object.entries(observations).map(([candidateId, metrics]) => [candidateId, Object.fromEntries(
    Object.entries(metrics).map(([metric, value]) => [metric, { value, sampleCount: 4, source: 'measured', acceptance: 'passed', coverage: 'comparable' }]),
  )]));
  const select = objective => selectInitialRoute({
    task: { requirements: { modalities: ['text'], contextTokens: 8_000 } },
    candidateSnapshot: candidates,
    objective,
    observationsByCandidate: observationHistory,
    forecastsByCandidate: Object.fromEntries(candidates.candidates.map(item => [item.candidateId, forecast])),
  });

  assert.equal(select('cost').selected.candidateId, 'economy');
  assert.equal(select('tokens').selected.candidateId, 'economy');
  assert.equal(select('speed').selected.candidateId, 'fast');
  assert.equal(select('quality').selected.candidateId, 'quality');
  const balanced = select('balanced');
  assert.equal(balanced.selected.candidateId, 'balanced');
  assert.deepEqual(balanced.reasonCodes, ['OBJECTIVE_BALANCED']);
  assert.deepEqual(balanced.comparison.evidence.map(item => item.metric), ['cost', 'tokens', 'speed', 'quality']);
});

test('unknown or incomparable evidence retains a qualified current candidate without claiming a winner', () => {
  const configuredClaim = candidate('configured-claim', {
    quote: quote('configured-claim', 0.01, 'EUR'),
  });
  const current = candidate('current', {
    quote: quote('current', 0.20),
  });
  const observationsByCandidate = {
    'configured-claim': { quality: { value: 0.99, sampleCount: 20, source: 'measured', acceptance: 'unconfirmed', coverage: 'comparable' } },
    current: { quality: { value: 0.70, sampleCount: 3, source: 'measured', acceptance: 'passed', coverage: 'comparable' } },
  };

  const cost = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(configuredClaim, current),
    currentCandidateId: 'current',
    objective: 'cost',
    observationsByCandidate,
    forecastsByCandidate: { 'configured-claim': forecast, current: forecast },
  });
  assert.equal(cost.selected.candidateId, 'current');
  assert.deepEqual(cost.reasonCodes, ['CURRENT_CANDIDATE_RETAINED']);
  assert.deepEqual(cost.comparison.unknowns, ['COST_NOT_COMPARABLE']);

  const quality = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(configuredClaim, current),
    currentCandidateId: 'current',
    objective: 'quality',
    observationsByCandidate,
  });
  assert.equal(quality.selected.candidateId, 'current');
  assert.deepEqual(quality.comparison.unknowns, ['QUALITY_NOT_COMPARABLE']);
});

test('cold start uses an explicit declared prior and labels it separately from measured evidence', () => {
  const decision = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(
      candidate('economy'),
      candidate('general'),
    ),
    objective: 'quality',
    priorsByCandidate: {
      economy: { suitability: 0.4, source: 'declared' },
      general: { suitability: 0.8, source: 'declared' },
    },
  });

  assert.equal(decision.selected.candidateId, 'general');
  assert.deepEqual(decision.reasonCodes, ['COLD_START_DECLARED_PRIOR']);
  assert.deepEqual(decision.comparison.evidence, [{ metric: 'declared-prior', source: 'declared' }]);
  assert.deepEqual(decision.comparison.unknowns, ['QUALITY_NOT_COMPARABLE']);
});

test('fixed and native pending selections cannot be overridden by objective ranking', () => {
  const cheap = candidate('cheap', {
    quote: quote('cheap', 0.01),
  });
  const fixed = candidate('fixed', {
    quote: quote('fixed', 1),
  });
  const candidates = snapshot(cheap, fixed);

  const fixedDecision = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: candidates,
    objective: 'cost',
    fixedCandidateId: 'fixed',
    forecastsByCandidate: { cheap: forecast, fixed: forecast },
  });
  assert.equal(fixedDecision.selected.candidateId, 'fixed');
  assert.deepEqual(fixedDecision.reasonCodes, ['FIXED_CANDIDATE']);

  const manualDecision = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: candidates,
    objective: 'cost',
    manualCandidateId: 'fixed',
    forecastsByCandidate: { cheap: forecast, fixed: forecast },
  });
  assert.equal(manualDecision.selected.candidateId, 'fixed');
  assert.deepEqual(manualDecision.reasonCodes, ['NATIVE_PENDING_SELECTION']);

  const conflict = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: candidates,
    fixedCandidateId: 'fixed',
    manualCandidateId: 'cheap',
  });
  assert.equal(conflict.kind, 'pause');
  assert.deepEqual(conflict.reasonCodes, ['FIXED_NATIVE_SELECTION_CONFLICT']);
});

test('fixed, pending and empty-pool failures pause with their eligibility evidence', () => {
  const disabled = candidate('disabled', { enabled: false });
  const fixed = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(disabled),
    fixedCandidateId: 'disabled',
  });
  assert.equal(fixed.kind, 'pause');
  assert.deepEqual(fixed.reasonCodes, ['FIXED_CANDIDATE_INELIGIBLE']);
  assert.deepEqual(fixed.excluded, [{ candidateId: 'disabled', reasons: ['CANDIDATE_DISABLED'] }]);

  const missingPending = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(candidate('other')),
    manualCandidateId: 'not-in-snapshot',
  });
  assert.equal(missingPending.kind, 'pause');
  assert.deepEqual(missingPending.reasonCodes, ['NATIVE_PENDING_NOT_IN_SNAPSHOT']);

  const empty = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(),
  });
  assert.equal(empty.kind, 'pause');
  assert.deepEqual(empty.reasonCodes, ['NO_ELIGIBLE_CANDIDATE']);
});

test('semantic assessment is opt-in, budget-visible and bounded to one qualified candidate call', () => {
  const disabled = candidate('disabled', { enabled: false });
  const assessor = candidate('assessor');
  const base = {
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(disabled, assessor),
    assessmentRequest: {
      required: true,
      enabled: true,
      budgetApproved: false,
      maxOutputTokens: 2_000,
      budgetEstimate: { totalTokens: 256, cost: null },
    },
  };

  const waiting = selectInitialRoute(base);
  assert.equal(waiting.kind, 'pause');
  assert.deepEqual(waiting.reasonCodes, ['ASSESSMENT_BUDGET_REQUIRED']);
  assert.deepEqual(waiting.assessment.budgetEstimate, { totalTokens: 256, cost: null });

  const planned = selectInitialRoute({
    ...base,
    assessmentRequest: { ...base.assessmentRequest, budgetApproved: true },
  });
  assert.equal(planned.kind, 'assessment-required');
  assert.equal(planned.assessor.candidateId, 'assessor');
  assert.deepEqual(planned.assessment, {
    purpose: 'assessment',
    maxCalls: 1,
    maxOutputTokens: 512,
    budgetEstimate: { totalTokens: 256, cost: null },
  });

  const ordinary = selectInitialRoute({
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(assessor),
  });
  assert.equal(ordinary.kind, 'execute');
  assert.equal(ordinary.assessment, undefined);
});

test('a valid assessment can only add requirements and invalid evidence cannot change eligibility', () => {
  const textOnly = candidate('text-only');
  const multimodal = candidate('multimodal', {
    capabilities: {
      modalities: {
        text: { supported: true, confidence: 'verified' },
        image: { supported: true, confidence: 'declared' },
      },
      tools: { supported: true, confidence: 'verified' },
      maxContextTokens: 64_000,
      confidence: 'verified',
      source: 'adapter',
    },
  });
  const base = {
    task: { requirements: { modalities: ['text'], contextTokens: 8_000 } },
    candidateSnapshot: snapshot(textOnly, multimodal),
    currentCandidateId: 'text-only',
    assessmentRequest: { required: true, enabled: true, budgetApproved: true, maxOutputTokens: 128 },
  };
  const routed = selectInitialRoute({
    ...base,
    assessmentResult: {
      purpose: 'assessment',
      evidence: 'sufficient',
      requirements: { modalities: ['image'], tools: true, contextTokens: 48_000 },
      candidateEligibility: { 'text-only': true },
    },
  });
  assert.equal(routed.kind, 'execute');
  assert.equal(routed.selected.candidateId, 'multimodal');
  assert.deepEqual(routed.appliedRequirements, {
    modalities: ['text', 'image'],
    tools: true,
    contextTokens: 48_000,
  });

  const invalid = selectInitialRoute({
    ...base,
    assessmentResult: {
      purpose: 'assessment',
      evidence: 'insufficient',
      requirements: { modalities: ['image'] },
      candidateEligibility: { 'text-only': false },
    },
  });
  assert.equal(invalid.kind, 'pause');
  assert.deepEqual(invalid.reasonCodes, ['ASSESSMENT_EVIDENCE_INSUFFICIENT']);
  assert.deepEqual(invalid.excluded, []);
});

test('calibration stays off by default and exposes its budget before explicit authorization', () => {
  const input = {
    task: { requirements: { modalities: ['text'] } },
    candidateSnapshot: snapshot(candidate('only')),
  };
  const ordinary = selectInitialRoute(input);
  assert.equal(ordinary.calibration, undefined);

  const estimate = { calls: 2, totalTokens: 400, money: [{ currency: 'USD', kind: 'api-calculated', amount: 0.02 }] };
  const offered = selectInitialRoute({
    ...input,
    calibrationRequest: { requested: true, userAuthorized: false, budgetEstimate: estimate },
  });
  assert.equal(offered.kind, 'execute');
  assert.deepEqual(offered.calibration, { status: 'authorization-required', budgetEstimate: estimate });

  const enabled = selectInitialRoute({
    ...input,
    calibrationRequest: { requested: true, userAuthorized: true, budgetEstimate: estimate },
  });
  assert.deepEqual(enabled.calibration, { status: 'enabled', budgetEstimate: estimate });
});

test('the routing boundary rejects ambiguous candidate identities and duplicate candidate ids', () => {
  const duplicate = snapshot(candidate('same'), candidate('same', { provider: 'other-provider' }));
  assert.throws(() => selectInitialRoute({ task: { requirements: { modalities: ['text'] } }, candidateSnapshot: duplicate }), /duplicate candidateId/);

  const incomplete = candidate('incomplete', { accountId: '' });
  assert.throws(() => selectInitialRoute({ task: { requirements: { modalities: ['text'] } }, candidateSnapshot: snapshot(incomplete) }), /candidate identity/);
});
