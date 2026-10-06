import { costOf, tokensOf } from './ledger.mjs';
import { candidateSnapshotSchema } from './connections.mjs';

const OBJECTIVES = new Set(['balanced', 'cost', 'tokens', 'speed', 'quality']);
const MODALITIES = new Set(['text', 'image']);
const MAX_ASSESSMENT_OUTPUT_TOKENS = 512;
const MAX_ASSESSMENT_OUTPUT_CHARS = 65_536;
const BLOCKED_PROVIDER_AUTHORIZATION = new Set(['unauthorized', 'error']);

function validRequirements(requirements) {
  if (!requirements || typeof requirements !== 'object') return false;
  if (requirements.modalities !== undefined && (!Array.isArray(requirements.modalities) || requirements.modalities.some(item => !MODALITIES.has(item)))) return false;
  if (requirements.tools !== undefined && typeof requirements.tools !== 'boolean') return false;
  if (requirements.contextTokens !== undefined && (!Number.isFinite(requirements.contextTokens) || requirements.contextTokens < 0)) return false;
  return true;
}

function mergeRequirements(explicit, supplemental) {
  const modalities = [...new Set([...(explicit.modalities ?? ['text']), ...(supplemental?.modalities ?? [])])];
  const merged = { modalities };
  if (explicit.tools || supplemental?.tools) merged.tools = true;
  const contextTokens = Math.max(explicit.contextTokens ?? 0, supplemental?.contextTokens ?? 0);
  if (contextTokens) merged.contextTokens = contextTokens;
  return merged;
}

function validAssessment(result) {
  return result?.purpose === 'assessment'
    && typeof result.callId === 'string'
    && result.callId.length > 0
    && result.evidence === 'sufficient'
    && validRequirements(result.requirements);
}

function assessmentRequirements(value) {
  const normalized = {};
  if (value.modalities !== undefined) normalized.modalities = [...new Set(value.modalities)];
  if (value.tools === true) normalized.tools = true;
  if (value.contextTokens !== undefined) normalized.contextTokens = value.contextTokens;
  return normalized;
}

function parseSnapshot(snapshot) {
  const parsed = candidateSnapshotSchema.parse(snapshot);
  const ids = new Set();
  for (const candidate of parsed.candidates) {
    if (ids.has(candidate.candidateId)) throw new TypeError(`duplicate candidateId: ${candidate.candidateId}`);
    ids.add(candidate.candidateId);
  }
  return parsed;
}

function capabilityStatus(capability) {
  if (capability?.supported === true) return 'supported';
  if (capability?.supported === false) return 'unsupported';
  return 'unknown';
}

function exclusionReasons(candidate, requirements) {
  const reasons = [];
  if (candidate.routerAuthorization?.status !== 'enabled') reasons.push('CANDIDATE_NOT_AUTHORIZED');
  if (BLOCKED_PROVIDER_AUTHORIZATION.has(candidate.providerAuthorization?.status)) reasons.push('CANDIDATE_PROVIDER_NOT_AUTHORIZED');
  if (!candidate.enabled) reasons.push('CANDIDATE_DISABLED');
  if (!candidate.inPool) reasons.push('CANDIDATE_NOT_IN_POOL');
  if (candidate.availability?.status !== 'available') reasons.push('CANDIDATE_UNAVAILABLE');
  if (reasons.length) return reasons;

  for (const modality of requirements.modalities ?? ['text']) {
    const status = capabilityStatus(candidate.capabilities?.modalities?.[modality]);
    if (status === 'unsupported') reasons.push(`${modality.toUpperCase()}_CAPABILITY_UNSUPPORTED`);
    if (status === 'unknown') reasons.push(`${modality.toUpperCase()}_CAPABILITY_UNKNOWN`);
  }
  if (requirements.tools) {
    const status = capabilityStatus(candidate.capabilities?.tools);
    if (status === 'unsupported') reasons.push('TOOLS_CAPABILITY_UNSUPPORTED');
    if (status === 'unknown') reasons.push('TOOLS_CAPABILITY_UNKNOWN');
  }
  if (Number.isFinite(requirements.contextTokens)) {
    const capacity = candidate.capabilities?.maxContextTokens;
    if (!Number.isFinite(capacity)) reasons.push('CONTEXT_CAPACITY_UNKNOWN');
    else if (capacity < requirements.contextTokens) reasons.push('CONTEXT_CAPACITY_INSUFFICIENT');
  }
  return reasons;
}

function selected(candidate, snapshotEpoch) {
  const quote = candidate.quote ? structuredClone(candidate.quote) : null;
  const quoteVersion = quote?.quoteVersion ?? null;
  if (quote) {
    delete quote.quoteVersion;
    delete quote.estimatedCost;
  }
  return {
    candidateId: candidate.candidateId,
    identity: structuredClone(candidate.identity),
    snapshotEpoch,
    registryEpoch: snapshotEpoch,
    connectionConfigRevision: candidate.connectionConfigRevision,
    authEpoch: candidate.authEpoch,
    capabilities: structuredClone(candidate.capabilities),
    quote,
    quoteVersion,
    enabled: true,
  };
}

function insufficientAssessment(callId, reason) {
  return { purpose: 'assessment', evidence: 'insufficient', callId, reason };
}

/** Execute one Host-owned assessment call through the shared Task reservation runner. */
export async function runInitialAssessment({ router, taskId, decision, request, forecast, signal, routerSnapshot, configVersion }) {
  if (!router || typeof router.reserveCall !== 'function' || typeof router.streamReservedCall !== 'function') throw new TypeError('assessment router runner is required');
  if (typeof taskId !== 'string' || !taskId) throw new TypeError('assessment taskId is required');
  if (!signal || request?.signal !== signal) throw new TypeError('assessment request must use the original signal');
  if (decision?.kind !== 'assessment-required' || decision.assessment?.purpose !== 'assessment' || decision.assessment.maxCalls !== 1) throw new TypeError('assessment decision is invalid');
  const outputLimit = decision.assessment.maxOutputTokens;
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > MAX_ASSESSMENT_OUTPUT_TOKENS) throw new TypeError('assessment output limit is invalid');
  if (!forecast || !Number.isSafeInteger(forecast.outputTokens) || forecast.outputTokens < 0 || forecast.outputTokens > outputLimit || !Number.isSafeInteger(forecast.totalTokens) || forecast.totalTokens < forecast.outputTokens) throw new TypeError('assessment forecast is invalid or exceeds the output limit');
  if (!Array.isArray(request.messages)) throw new TypeError('assessment messages are required');
  signal.throwIfAborted();

  const assessor = decision.assessor;
  const callId = await router.reserveCall(taskId, {
    purpose: 'assessment',
    selection: structuredClone(assessor.identity),
    candidateId: assessor.candidateId,
    selectionSnapshot: structuredClone(assessor),
    forecast: structuredClone(forecast),
    ...(routerSnapshot === undefined ? {} : { routerSnapshot: structuredClone(routerSnapshot) }),
    ...(configVersion === undefined ? {} : { configVersion }),
  }, signal);
  signal.throwIfAborted();
  const { purpose: _purpose, provider: _provider, model: _model, maxTokens: _maxTokens, ...requestRest } = request;
  const stream = router.streamReservedCall(taskId, callId, {
    ...requestRest,
    provider: assessor.identity.provider,
    model: assessor.identity.model,
    maxTokens: outputLimit,
    signal,
  });
  let raw = '';
  let oversized = false;
  let finish = null;
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      if (raw.length + chunk.text.length > MAX_ASSESSMENT_OUTPUT_CHARS) oversized = true;
      if (!oversized) raw += chunk.text;
    }
    if (chunk.type === 'finish') finish = chunk.reason?.kind ?? null;
  }
  if (oversized || finish !== 'stop') return insufficientAssessment(callId, oversized ? 'ASSESSMENT_OUTPUT_TOO_LARGE' : 'ASSESSMENT_DID_NOT_STOP');
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.evidence !== 'sufficient' || !validRequirements(parsed.requirements)) return insufficientAssessment(callId, parsed?.evidence === 'insufficient' ? 'ASSESSMENT_EVIDENCE_INSUFFICIENT' : 'ASSESSMENT_RESULT_INVALID');
    return { purpose: 'assessment', evidence: 'sufficient', callId, requirements: assessmentRequirements(parsed.requirements) };
  } catch {
    return insufficientAssessment(callId, 'ASSESSMENT_RESULT_INVALID');
  }
}

function measured(candidate, metric, observationsByCandidate) {
  const observation = observationsByCandidate?.[candidate.candidateId]?.[metric];
  return observation?.source === 'measured'
    && observation.acceptance === 'passed'
    && observation.coverage === 'comparable'
    && Number.isFinite(observation.value)
    && observation.sampleCount > 0
    ? observation.value
    : null;
}

function comparableMetric(candidates, metric, observationsByCandidate, forecastsByCandidate) {
  if (metric === 'cost') {
    const costs = candidates.map(candidate => costOf(tokensOf(forecastsByCandidate?.[candidate.candidateId]), candidate.quote));
    if (costs.some(cost => cost.amount === null || !cost.currency || !cost.kind)) return null;
    if (new Set(costs.map(cost => `${cost.currency}:${cost.kind}`)).size !== 1) return null;
    return { metric, direction: 'lower', values: costs.map(cost => cost.amount), unit: `${costs[0].currency}:${costs[0].kind}`, source: 'quote+declared-forecast' };
  }
  if (metric === 'tokens') {
    const forecasts = candidates.map(candidate => forecastsByCandidate?.[candidate.candidateId]?.totalTokens);
    if (forecasts.every(value => Number.isSafeInteger(value) && value >= 0)) return { metric, direction: 'lower', values: forecasts, unit: 'tokens', source: 'declared-forecast' };
  }
  const field = metric === 'tokens' ? 'totalTokens' : metric === 'speed' ? 'latencyMs' : 'quality';
  const values = candidates.map(candidate => measured(candidate, field, observationsByCandidate));
  if (values.some(value => value === null || value < 0)) return null;
  return { metric, direction: metric === 'quality' ? 'higher' : 'lower', values, unit: metric === 'tokens' ? 'tokens' : metric === 'speed' ? 'ms' : 'score', source: 'accepted-measured-history' };
}

function objectiveRanking(candidates, objective, observationsByCandidate, forecastsByCandidate) {
  const metrics = objective === 'balanced' ? ['cost', 'tokens', 'speed', 'quality'] : [objective];
  const evidence = metrics.map(metric => comparableMetric(candidates, metric, observationsByCandidate, forecastsByCandidate));
  const unknowns = metrics.filter((_, index) => evidence[index] === null).map(metric => `${metric.toUpperCase()}_NOT_COMPARABLE`);
  const knownEvidence = evidence.filter(Boolean);
  if (unknowns.length) {
    return {
      winner: null,
      evidence: knownEvidence.map(({ metric, direction, unit, source }) => ({ metric, direction, unit, source })),
      unknowns,
    };
  }
  const scores = candidates.map(() => 0);
  for (const metric of knownEvidence) {
    const minimum = Math.min(...metric.values);
    const maximum = Math.max(...metric.values);
    metric.values.forEach((value, index) => {
      if (minimum === maximum) scores[index] += 1;
      else if (metric.direction === 'lower') scores[index] += (maximum - value) / (maximum - minimum);
      else scores[index] += (value - minimum) / (maximum - minimum);
    });
  }
  let winner = 0;
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] > scores[winner]) winner = index;
  }
  return {
    winner: candidates[winner],
    evidence: knownEvidence.map(({ metric, direction, unit, source }) => ({ metric, direction, unit, source })),
    unknowns: [],
  };
}

export function selectInitialRoute({
  task,
  candidateSnapshot,
  objective = 'balanced',
  currentCandidateId = null,
  fixedCandidateId = null,
  manualCandidateId = null,
  assessmentRequest = null,
  assessmentResult = null,
  observationsByCandidate = {},
  priorsByCandidate = {},
  forecastsByCandidate = {},
  calibrationRequest = null,
}) {
  if (!OBJECTIVES.has(objective)) throw new TypeError(`Unsupported routing objective: ${objective}`);
  candidateSnapshot = parseSnapshot(candidateSnapshot);
  const explicitRequirements = task?.requirements ?? {};
  if (!validRequirements(explicitRequirements)) throw new TypeError('task requirements are invalid');
  const assessmentApplied = assessmentResult !== null && validAssessment(assessmentResult);
  const requirements = mergeRequirements(explicitRequirements, assessmentApplied ? assessmentResult.requirements : null);
  const calibration = calibrationRequest?.requested
    ? {
      status: calibrationRequest.userAuthorized ? 'enabled' : 'authorization-required',
      budgetEstimate: structuredClone(calibrationRequest.budgetEstimate ?? null),
    }
    : null;
  const eligible = [];
  const excluded = [];
  for (const candidate of candidateSnapshot.candidates) {
    const reasons = exclusionReasons(candidate, requirements);
    if (reasons.length) excluded.push({ candidateId: candidate.candidateId, reasons });
    else eligible.push(candidate);
  }
  const pause = (reason, details = {}) => ({
    kind: 'pause',
    snapshotEpoch: candidateSnapshot.snapshotEpoch,
    reasonCodes: [reason],
    excluded,
    ...(calibration ? { calibration } : {}),
    ...details,
  });
  const explicit = (candidateId, missingReason, ineligibleReason) => {
    const candidate = candidateSnapshot.candidates.find(entry => entry.candidateId === candidateId);
    if (!candidate) return pause(missingReason);
    if (!eligible.includes(candidate)) return pause(ineligibleReason);
    return candidate;
  };
  if (fixedCandidateId && manualCandidateId && fixedCandidateId !== manualCandidateId) return pause('FIXED_NATIVE_SELECTION_CONFLICT');
  const forced = manualCandidateId
    ? explicit(manualCandidateId, 'NATIVE_PENDING_NOT_IN_SNAPSHOT', 'NATIVE_PENDING_INELIGIBLE')
    : fixedCandidateId
      ? explicit(fixedCandidateId, 'FIXED_CANDIDATE_NOT_IN_SNAPSHOT', 'FIXED_CANDIDATE_INELIGIBLE')
      : null;
  if (forced?.kind === 'pause') return forced;
  if (!eligible.length) {
    return pause('NO_ELIGIBLE_CANDIDATE');
  }
  if (assessmentRequest?.required) {
    if (assessmentResult !== null && !assessmentApplied) return pause('ASSESSMENT_EVIDENCE_INSUFFICIENT');
    if (assessmentResult === null) {
      const assessment = {
        purpose: 'assessment',
        maxCalls: 1,
        maxOutputTokens: Math.min(MAX_ASSESSMENT_OUTPUT_TOKENS, Math.max(1, Math.trunc(assessmentRequest.maxOutputTokens ?? 256))),
        budgetEstimate: structuredClone(assessmentRequest.budgetEstimate ?? null),
      };
      if (!assessmentRequest.enabled) return pause('ASSESSMENT_NOT_ENABLED', { assessment });
      if (!assessmentRequest.budgetApproved) return pause('ASSESSMENT_BUDGET_REQUIRED', { assessment });
      const assessor = forced
        ?? eligible.find(candidate => candidate.candidateId === currentCandidateId)
        ?? [...eligible].sort((left, right) => left.candidateId.localeCompare(right.candidateId))[0];
      return {
        kind: 'assessment-required',
        assessor: selected(assessor, candidateSnapshot.snapshotEpoch),
        snapshotEpoch: candidateSnapshot.snapshotEpoch,
        reasonCodes: ['SEMANTIC_ASSESSMENT_REQUIRED'],
        excluded,
        assessment,
        ...(calibration ? { calibration } : {}),
      };
    }
  }
  if (forced) {
    return {
      kind: 'execute',
      selected: selected(forced, candidateSnapshot.snapshotEpoch),
      reasonCodes: [manualCandidateId ? 'NATIVE_PENDING_SELECTION' : 'FIXED_CANDIDATE'],
      excluded,
      comparison: { objective, evidence: [], unknowns: [] },
      ...(assessmentApplied ? { appliedRequirements: requirements } : {}),
      ...(calibration ? { calibration } : {}),
    };
  }
  const ranking = eligible.length > 1 ? objectiveRanking(eligible, objective, observationsByCandidate, forecastsByCandidate) : null;
  const current = eligible.find(candidate => candidate.candidateId === currentCandidateId);
  const prior = ranking && !ranking.winner
    ? [...eligible]
      .filter(candidate => priorsByCandidate[candidate.candidateId]?.source === 'declared' && Number.isFinite(priorsByCandidate[candidate.candidateId].suitability))
      .sort((left, right) => priorsByCandidate[right.candidateId].suitability - priorsByCandidate[left.candidateId].suitability || left.candidateId.localeCompare(right.candidateId))[0]
    : null;
  const winner = ranking?.winner ?? current ?? prior ?? [...eligible].sort((left, right) => left.candidateId.localeCompare(right.candidateId))[0];
  const reasonCodes = eligible.length === 1
    ? ['SINGLE_ELIGIBLE_CANDIDATE']
    : ranking?.winner
      ? [`OBJECTIVE_${objective.toUpperCase()}`]
      : current
        ? ['CURRENT_CANDIDATE_RETAINED']
        : prior
          ? ['COLD_START_DECLARED_PRIOR']
          : ['COLD_START_STABLE_ORDER'];
  const comparisonEvidence = [...(ranking?.evidence ?? [])];
  if (prior) comparisonEvidence.push({ metric: 'declared-prior', source: 'declared' });
  return {
    kind: 'execute',
    selected: selected(winner, candidateSnapshot.snapshotEpoch),
    reasonCodes,
    excluded,
    comparison: { objective, evidence: comparisonEvidence, unknowns: ranking?.unknowns ?? [] },
    ...(assessmentApplied ? { appliedRequirements: requirements } : {}),
    ...(calibration ? { calibration } : {}),
  };
}
