import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskCoordinationController } from '../src/coordination.mjs';

const clone = value => structuredClone(value);

const failedAcceptance = ({ revision = 1, observed = { value: 1 }, reason, source = { kind: 'deterministic-rule', rule: 'character-length', checkerVersion: 1 } } = {}) => ({
  version: 1,
  schemaVersion: 1,
  revision,
  taskId: 'task-1',
  requirementRevision: 1,
  requirementHash: 'a'.repeat(64),
  artifact: { id: `artifact-${revision}`, revision, hash: `${revision}`.repeat(64).slice(0, 64), text: 'CURRENT ARTIFACT', complete: true },
  requirements: [{ id: 'requirement-1', version: 1, kind: 'character-length', description: '正文长度为2至2个字符', required: true }],
  evidence: [{ id: `evidence-${revision}`, version: 1, requirementId: 'requirement-1', artifactHash: `${revision}`.repeat(64).slice(0, 64), verdict: 'failed', source, observed, ...(reason ? { reason } : {}) }],
  coverage: { required: 1, requiredIds: ['requirement-1'], covered: 1, coveredIds: ['requirement-1'], failedIds: ['requirement-1'], uncovered: [], uncoveredIds: [] },
  verdict: 'failed',
  scope: 'explicit-requirements',
  limitations: ['finite-explicit-requirement-dsl'],
  reviews: [],
  blocking: [{ id: 'blocking-1', version: 1, key: 'character-length:failed:evidence', requirementIds: ['requirement-1'], evidenceIds: [`evidence-${revision}`], repairable: true, category: 'requirement-failed', artifactRevision: revision, selfRepairAttempted: false, newEvidenceVersion: 1 }],
  history: [],
  phase: 'checked',
});

const consultant = {
  candidateId: 'candidate-expert',
  identity: { connectionId: 'expert-connection', accountId: 'expert-account', billingPath: 'expert-billing', provider: 'expert-provider', model: 'expert-model' },
  enabled: true,
  authEpoch: 1,
  connectionConfigRevision: 1,
  capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } },
  capabilities: { contextWindow: { value: 8192, confidence: 'declared', source: 'test' } },
  quote: null,
  quoteVersion: null,
};

const policy = {
  enabled: true,
  candidateId: consultant.candidateId,
  allowCrossModel: true,
  allowFixedModel: false,
  objective: 'balanced',
  selectionBasis: 'objective-qualified',
  maxTokens: 128,
  maxAdviceChars: 2048,
  forecast: { totalTokens: 4096 },
};

function harness({ acceptance = failedAcceptance(), coordination = null, fixed = false, advice = 'Inspect the failing boundary and correct only that requirement.', reserveError = null, onStreamFinish = null, onCapture = null, onPublish = null, onReserve = null, capturedCandidate = consultant, policyValue = policy } = {}) {
  const publications = [];
  const reservations = [];
  const requests = [];
  const steers = [];
  const task = {
    id: 'task-1', sessionId: 'session-1', turn: 1, lifecycle: 'running', configVersion: 7,
    activeSelection: { connectionId: 'main-connection', accountId: 'main-account', billingPath: 'main-billing', provider: 'main-provider', model: 'main-model' },
    routing: { objective: 'balanced', reasonCodes: fixed ? ['FIXED_CANDIDATE'] : ['OBJECTIVE_BALANCED'] },
    acceptance: clone(acceptance), coordination: clone(coordination), calls: [{ purpose: 'execution', routerSnapshot: { automatic: true, routingObjective: 'balanced' } }],
  };
  const router = {
    exactTask(sessionId, turn) { return sessionId === task.sessionId && turn === task.turn ? clone(task) : null; },
    async publishCoordination(taskId, expected, next) {
      assert.equal(taskId, task.id);
      if (task.acceptance.revision !== expected.acceptanceRevision || (task.coordination?.revision ?? 0) !== expected.coordinationRevision) {
        const error = new Error('stale coordination write');
        error.code = 'COORDINATION_STALE';
        throw error;
      }
      task.coordination = clone(next);
      publications.push(clone(next));
      onPublish?.(task, next, agent);
      return clone(next);
    },
    async captureCandidate(candidateId, { signal }) {
      assert.equal(candidateId, capturedCandidate.candidateId);
      assert.equal(signal, harness.signal);
      captureCount++;
      onCapture?.(task, captureCount, agent);
      return clone(capturedCandidate);
    },
    async reserveCall(taskId, details, signal) {
      assert.equal(taskId, task.id);
      reservations.push({ details: clone(details), signal });
      onReserve?.(task, agent);
      if (reserveError) throw reserveError;
      return 'consultation-call-1';
    },
    streamReservedCall(taskId, callId, request) {
      assert.equal(taskId, task.id);
      assert.equal(callId, 'consultation-call-1');
      requests.push(request);
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: advice };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
        onStreamFinish?.(task);
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  let captureCount = 0;
  const agent = { session: { id: task.sessionId }, inbox: { nextStep: [] }, steer(message) { steers.push(message); } };
  const controller = new TaskCoordinationController({ router, policyForTask: () => clone(policyValue) });
  return { controller, router, task, agent, publications, reservations, requests, steers };
}

harness.signal = new AbortController().signal;

test('missing or disabled coordination policy adds no model step or Call', async () => {
  for (const policyValue of [null, { enabled: false, candidateId: consultant.candidateId }]) {
    const run = harness({ policyValue });
    const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
    assert.equal(action.kind, 'none');
    assert.equal(action.reason, 'COORDINATION_DISABLED');
    assert.equal(run.steers.length, 0);
    assert.equal(run.reservations.length, 0);
    assert.equal(run.task.coordination, null);
  }
});

test('an enabled policy permits self-repair without using candidate settings as an implicit switch', async () => {
  const run = harness({ policyValue: { enabled: true } });
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'self-repair');
  assert.equal(run.steers.length, 1);
  assert.equal(run.reservations.length, 0);
});

test('paused automatic routing suppresses T16 even when its frozen policy is enabled', async () => {
  const run = harness({ policyValue: { enabled: true } });
  run.task.calls[0].routerSnapshot.automatic = false;
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'none');
  assert.equal(action.reason, 'AUTOMATIC_ROUTING_PAUSED');
  assert.equal(run.steers.length, 0);
  assert.equal(run.reservations.length, 0);
});

test('human input queued while the self-repair intent is persisted prevents the synthetic steer', async () => {
  let injected = false;
  const run = harness({ onPublish(_task, next, agent) {
    if (!injected && next.selfRepair?.state === 'intent-persisted') {
      injected = true;
      agent.inbox.nextStep.push({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Human correction' }] });
    }
  } });
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stale');
  assert.equal(action.reason, 'HUMAN_INPUT_PENDING');
  assert.equal(run.steers.length, 0);
  assert.equal(run.reservations.length, 0);
  assert.equal(run.task.coordination.selfRepair.state, 'delivery-unknown');
});

test('the first trusted repairable failure persists one Task-wide intent before a producer-owned same-turn steer', async () => {
  const run = harness();
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });

  assert.equal(action.kind, 'self-repair');
  assert.equal(run.task.coordination.selfRepair.used, true);
  assert.equal(run.task.coordination.selfRepair.state, 'claimed');
  assert.equal(run.task.coordination.consultationAttempts, 0);
  assert.equal(run.steers.length, 1);
  assert.equal(run.steers[0].role, 'user');
  assert.equal(run.steers[0].source.kind, 'router-self-repair');
  assert.equal(run.steers[0].source.form, 'notice');
  assert.equal(run.steers[0].source.taskId, run.task.id);
  assert.equal(run.steers[0].source.evidenceVersion, 1);
  assert.equal(run.steers[0].source.kind === 'user', false);
  assert.equal(run.publications[0].selfRepair.state, 'intent-persisted');

  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(run.steers.length, 1);
  assert.equal(run.reservations.length, 0);
});

test('new evidence for the repaired episode makes one bounded consultation Call and returns advice to the main agent', async () => {
  const run = harness();
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });

  const restarted = new TaskCoordinationController({ router: run.router, policyForTask: () => clone(policy) });
  const action = await restarted.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });

  assert.equal(action.kind, 'consultation');
  assert.equal(run.reservations.length, 1);
  assert.equal(run.reservations[0].signal, harness.signal);
  assert.equal(run.reservations[0].details.purpose, 'consultation');
  assert.equal(run.reservations[0].details.candidateId, consultant.candidateId);
  assert.deepEqual(run.reservations[0].details.selectionSnapshot, consultant);
  assert.deepEqual(run.reservations[0].details.selection, consultant.identity);
  assert.equal(run.reservations[0].details.forecast.totalTokens, 4096);
  assert.equal(run.requests.length, 1);
  assert.equal(run.requests[0].signal, harness.signal);
  assert.equal(run.requests[0].maxTokens, 128);
  const payload = JSON.parse(run.requests[0].messages[1].content[0].text);
  assert.deepEqual(Object.keys(payload).sort(), ['blocking', 'evidence', 'requirement', 'task'].sort());
  assert.equal(JSON.stringify(payload).includes('expert-account'), false);
  assert.equal(run.steers.length, 1);
  assert.equal(run.steers[0].source.kind, 'router-consultation');
  assert.equal(run.steers[0].source.callId, 'consultation-call-1');
  assert.match(run.steers[0].content[0].text, /advice/i);
  assert.equal(run.task.coordination.consultationAttempts, 1);
  assert.equal(run.task.coordination.episodes[0].consultation.state, 'advice-delivered');

  await restarted.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(run.reservations.length, 1);
  assert.equal(run.steers.length, 1);
});

test('an unrelated artifact replacement is not new obstacle evidence, but a changed relevant measurement is', async () => {
  const run = harness();
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 1 } });
  run.task.acceptance.artifact.text = 'UNRELATED WORDING CHANGED';
  const unchanged = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(unchanged.kind, 'none');
  assert.equal(unchanged.reason, 'NO_NEW_EVIDENCE');
  assert.equal(run.reservations.length, 0);

  run.task.acceptance = failedAcceptance({ revision: 3, observed: { value: 2 } });
  const changed = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(changed.kind, 'consultation');
  assert.equal(run.reservations.length, 1);
  assert.equal(run.task.coordination.episodes[0].evidenceVersion, 2);
});

test('trusted explicit capability deficiency can consult without spending the local repair opportunity', async () => {
  const acceptance = failedAcceptance({
    reason: 'MODEL_CAPABILITY_MISSING',
    observed: { capability: 'tools', supported: false },
    source: { kind: 'host-check', planId: 'capability-check', checkKind: 'behavior', execution: { planVersion: 1, commandId: 'capability-v1', exitCode: 1, outputHash: 'c'.repeat(64) } },
  });
  const run = harness({ acceptance });
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'consultation');
  assert.equal(run.task.coordination.selfRepair, null);
  assert.equal(run.task.coordination.episodes[0].consultation.trigger, 'capability-deficiency');
  assert.equal(run.reservations.length, 1);
});

test('unknown consultant context capacity stalls before reservation', async () => {
  const candidate = clone(consultant);
  candidate.capabilities.contextWindow.value = null;
  const run = harness({ capturedCandidate: candidate });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stalled');
  assert.equal(action.reason, 'CONSULTATION_CONTEXT_CAPACITY_UNKNOWN');
  assert.equal(run.reservations.length, 0);
  assert.equal(run.steers.length, 0);
});

test('fixed execution does not authorize a different consultation candidate', async () => {
  const run = harness({ fixed: true });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });
  run.steers.length = 0;

  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stalled');
  assert.equal(action.reason, 'FIXED_MODEL_CONSULTATION_NOT_AUTHORIZED');
  assert.equal(run.reservations.length, 0);
  assert.equal(run.steers.length, 0);
});

test('network evidence is recovery state rather than task difficulty', async () => {
  const acceptance = failedAcceptance({ reason: 'NETWORK', source: { kind: 'host-check', planId: 'network', checkKind: 'behavior' } });
  const run = harness({ acceptance });
  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'none');
  assert.equal(action.reason, 'NO_TRUSTED_REPAIRABLE_OBSTACLE');
  assert.equal(run.steers.length, 0);
  assert.equal(run.reservations.length, 0);
});

test('a persisted consultation intent is marked delivery-unknown after restart and is never replayed', async () => {
  const reservationFailure = new Error('simulated interruption after intent');
  reservationFailure.code = 'TEST_INTERRUPTION';
  const first = harness({ reserveError: reservationFailure });
  await first.controller.afterAcceptance({ agent: first.agent, turn: 1, signal: harness.signal, acceptance: clone(first.task.acceptance) });
  first.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });
  await first.controller.afterAcceptance({ agent: first.agent, turn: 1, signal: harness.signal, acceptance: clone(first.task.acceptance) });
  first.task.coordination = clone(first.publications.find(item => item.episodes[0].consultation?.state === 'intent-persisted'));

  const restarted = new TaskCoordinationController({ router: first.router, policyForTask: () => clone(policy) });
  const reservationsBeforeRestart = first.reservations.length;
  const action = await restarted.afterAcceptance({ agent: first.agent, turn: 1, signal: harness.signal, acceptance: clone(first.task.acceptance) });
  assert.equal(action.kind, 'none');
  assert.equal(action.reason, 'CONSULTATION_DELIVERY_UNKNOWN');
  assert.equal(first.task.coordination.episodes[0].consultation.state, 'delivery-unknown');
  assert.equal(first.reservations.length, reservationsBeforeRestart);
  assert.equal(first.steers.length, 1);
});

test('advice completed against a stale acceptance revision is recorded but never steered', async () => {
  const run = harness({ onStreamFinish(task) { task.acceptance = failedAcceptance({ revision: 3, observed: { value: 3 } }); } });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });

  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stale');
  assert.equal(run.reservations.length, 1);
  assert.equal(run.steers.length, 0);
  assert.equal(run.task.coordination.episodes[0].consultation.state, 'stale');
  assert.equal(run.task.coordination.episodes[0].consultation.reason, 'ACCEPTANCE_CHANGED');
  assert.match(run.task.coordination.episodes[0].consultation.adviceHash, /^[a-f0-9]{64}$/u);
});

test('acceptance changed by the final candidate refresh prevents advice steer', async () => {
  const run = harness({ onCapture(task, captureCount) {
    if (captureCount === 2) task.acceptance = failedAcceptance({ revision: 3, observed: { value: 3 } });
  } });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });

  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stale');
  assert.equal(action.reason, 'ACCEPTANCE_CHANGED');
  assert.equal(run.reservations.length, 1);
  assert.equal(run.steers.length, 0);
  assert.equal(run.task.coordination.episodes[0].consultation.state, 'stale');
  assert.equal(run.task.coordination.episodes[0].consultation.reason, 'ACCEPTANCE_CHANGED');
});

test('human input queued during reservation releases the unsent consultation and sends no advice', async () => {
  const run = harness({ onReserve(_task, agent) {
    agent.inbox.nextStep.push({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use this new constraint' }] });
  } });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });

  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stale');
  assert.equal(action.reason, 'HUMAN_INPUT_PENDING');
  assert.equal(run.reservations.length, 1);
  assert.equal(run.steers.length, 0);
  assert.equal(run.task.coordination.episodes[0].consultation.state, 'stale');
});

test('consultation reservation failure consumes the durable attempt without changing execution ownership or acceptance', async () => {
  const failure = new Error('controlled transport failure');
  failure.code = 'TRANSPORT';
  const run = harness({ reserveError: failure });
  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  run.steers.length = 0;
  const activeSelection = clone(run.task.activeSelection);
  run.task.acceptance = failedAcceptance({ revision: 2, observed: { value: 2 } });

  const action = await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(action.kind, 'stalled');
  assert.equal(action.reason, 'TRANSPORT');
  assert.deepEqual(run.task.activeSelection, activeSelection);
  assert.equal(run.task.acceptance.verdict, 'failed');
  assert.equal(run.task.coordination.consultationAttempts, 1);
  assert.equal(run.task.coordination.episodes[0].consultation.state, 'failed');
  assert.equal(run.steers.length, 0);

  await run.controller.afterAcceptance({ agent: run.agent, turn: 1, signal: harness.signal, acceptance: clone(run.task.acceptance) });
  assert.equal(run.reservations.length, 1);
});
