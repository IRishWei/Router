import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';

const disabledCoordination = {
  enabled: false,
  candidateId: null,
  allowCrossModel: false,
  allowFixedModel: false,
  maxTokens: 256,
  maxAdviceChars: 4096,
  forecastTokens: 4096,
};

test('shared coordination settings are opt-in, Host CAS stays private, and each Task freezes its policy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-policy-'));
  let ctx;
  try {
    ctx = await startNative(home);
    const initial = await ctx.router.snapshot();
    assert.deepEqual(initial.config.coordination, disabledCoordination);
    assert.equal(descriptors.some(item => item.method === 'publishCoordination'), false);

    const enabled = { ...disabledCoordination, enabled: true };
    await ctx.router.setCoordinationPolicy(enabled);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply OK');
    assert.deepEqual(task.coordinationPolicy, {
      ...enabled,
      objective: 'balanced',
      selectionBasis: null,
    });
    assert.equal(task.coordination, null);

    await ctx.router.setCoordinationPolicy(disabledCoordination);
    assert.equal((await ctx.router.snapshot()).tasks.find(item => item.id === task.id).coordinationPolicy.enabled, true);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('Task coordination candidate preference must agree with real objective ranking', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-objective-policy-'));
  let ctx;
  const registrations = [];
  try {
    ctx = await startNative(home);
    await ctx.router.setModelEnabled('controlled', false);
    await ctx.router.setModelEnabled('controlled-tools', false);
    registrations.push(await registerTextCandidate(ctx, 't16-objective-a', 'advisor-a', new T16ConsultantAdapter()));
    registrations.push(await registerTextCandidate(ctx, 't16-objective-b', 'advisor-b', new T16ConsultantAdapter()));
    const candidates = (await ctx.router.snapshot()).candidateSnapshot.candidates
      .filter(item => registrations.some(entry => entry.candidate.candidateId === item.candidateId));
    assert.equal(candidates.length, 2);
    const [rankedFirst, preference] = candidates;
    const enabled = { ...disabledCoordination, enabled: true, candidateId: preference.candidateId, allowCrossModel: true };
    await ctx.router.setRoutingObjective('tokens');
    await ctx.router.setCoordinationPolicy(enabled);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const tokenTask = await submit(ctx, sessionId, 'Reply TOKEN_OBJECTIVE');
    assert.equal(tokenTask.coordinationPolicy.objective, 'tokens');
    assert.equal(tokenTask.coordinationPolicy.candidateId, preference.candidateId);
    assert.equal(tokenTask.coordinationPolicy.selectionBasis, 'objective-mismatch');

    await ctx.router.setRoutingObjective('quality');
    await ctx.router.setCoordinationPolicy({ ...enabled, candidateId: preference.candidateId });
    const qualityTask = await submit(ctx, sessionId, 'Reply QUALITY_OBJECTIVE');
    assert.equal(qualityTask.coordinationPolicy.objective, 'quality');
    assert.equal(qualityTask.coordinationPolicy.candidateId, preference.candidateId);
    assert.equal(qualityTask.coordinationPolicy.selectionBasis, 'objective-qualified');
    assert.notEqual(preference.candidateId, rankedFirst.candidateId);
  } finally {
    for (const registration of registrations) registration.dispose();
    if (ctx) {
      await ctx.router.flush();
      await ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true });
  }
});

class T16MainAdapter extends LlmAdapter {
  requests = [];
  async *stream(request) {
    this.requests.push(request);
    const sources = request.messages.map(message => message.source?.kind).filter(Boolean);
    const text = sources.includes('router-consultation') ? 'A'.repeat(14)
      : sources.includes('router-self-repair') ? 'A'.repeat(9)
        : 'A'.repeat(4);
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class T16ConsultantAdapter extends LlmAdapter {
  requests = [];
  failureCode = null;
  async *stream(request) {
    this.requests.push(request);
    if (this.failureCode) throw new LlmError('Controlled consultation failure', this.failureCode);
    yield { type: 'text-delta', index: 0, text: 'Expand the artifact to the required character range.' };
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function registerTextCandidate(ctx, provider, model, adapter) {
  ctx.llm.registerAdapter([provider], adapter);
  const dispose = ctx.router.registerOwned({
    provider,
    connectionId: `${provider}-connection`,
    accountId: `${provider}-account`,
    billingPath: 't16-controlled-fixture',
    ownership: 'router-owned',
    source: 't16-integration-registration',
    sourceKey: `${provider}:v1`,
    configRevision: 1,
    configured: true,
    authorizationStatus: 'configured',
    models: [{ model, name: provider, maxContextTokens: 8192, capability: {
      text: { supported: true, confidence: 'declared' },
      image: { supported: false, confidence: 'declared' },
      tools: { supported: false, confidence: 'declared' },
    } }],
  });
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider && item.identity.model === model);
  assert(candidate);
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidate, dispose };
}

async function waitForState(ctx, predicate) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('T16 Task did not reach the expected state');
}

async function prepareCoordinatedTask(home, { tokens = null, allowFixedModel = true } = {}) {
  const ctx = await startNative(home);
  const main = new T16MainAdapter();
  const consultant = new T16ConsultantAdapter();
  const mainRegistration = await registerTextCandidate(ctx, `t16-main-${randomUUID()}`, 'writer', main);
  const consultantRegistration = await registerTextCandidate(ctx, `t16-consultant-${randomUUID()}`, 'advisor', consultant);
  await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
  await ctx.router.setBudgetDefaults({ tokens, durationMs: null, money: [] });
  await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
  await ctx.router.setCoordinationPolicy({ enabled: true, candidateId: consultantRegistration.candidate.candidateId, allowCrossModel: true, allowFixedModel, maxTokens: 128, maxAdviceChars: 1024, forecastTokens: 4096 });
  const { sessionId } = await ctx.sessionController.create({ cwd: home });
  return { ctx, main, consultant, mainRegistration, consultantRegistration, sessionId };
}

test('one real Task uses canonical 4 → 9 → 14 character evidence through self-repair and consultation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-complete-'));
  let ctx;
  let mainRegistration;
  let consultantRegistration;
  try {
    ctx = await startNative(home);
    const main = new T16MainAdapter();
    const consultant = new T16ConsultantAdapter();
    mainRegistration = await registerTextCandidate(ctx, 't16-main', 'writer', main);
    consultantRegistration = await registerTextCandidate(ctx, 't16-consultant', 'advisor', consultant);
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    await ctx.router.setCoordinationPolicy({
      enabled: true,
      candidateId: consultantRegistration.candidate.candidateId,
      allowCrossModel: true,
      allowFixedModel: true,
      maxTokens: 128,
      maxAdviceChars: 1024,
      forecastTokens: 4096,
    });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '仅检查以下明确要求：正文长度为10至20个字符。');

    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(task.acceptance.history.map(item => item.evidence[0].measurement.value), [4, 9]);
    assert.equal(task.acceptance.evidence[0].measurement.value, 14);
    assert.equal(task.acceptance.requirements.length, 1);
    assert.equal(task.inputs.length, 1);
    assert.equal(task.inputs[0].requestId !== null, true);
    assert.equal(task.acceptance.revision, 3);
    assert.equal(task.coordination.selfRepair.used, true);
    assert.equal(task.coordination.consultationAttempts, 1);
    assert.equal(task.coordination.episodes[0].status, 'resolved');
    assert.equal(task.calls.filter(call => call.purpose === 'consultation').length, 1);
    assert.equal(consultant.requests.length, 1);
    assert.equal(main.requests.length, 3);
    assert.equal(new Set(task.calls.map(call => call.taskId)).size, 1);
    assert.equal(task.turn, 1);
    assert.deepEqual(main.requests.flatMap(request => request.messages.map(message => message.source?.kind).filter(kind => kind?.startsWith('router-'))), ['router-self-repair', 'router-self-repair', 'router-consultation']);
  } finally {
    consultantRegistration?.dispose();
    mainRegistration?.dispose();
    if (ctx) {
      const flush = ctx.router.flush;
      await flush();
      await ctx.fiber.dispose();
      await flush();
    }
    await rm(home, { recursive: true, force: true });
  }
});

test('fixed execution requires its independent consultation grant', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-fixed-denied-'));
  let run;
  try {
    run = await prepareCoordinatedTask(home, { allowFixedModel: false });
    const task = await submit(run.ctx, run.sessionId, '仅检查以下明确要求：正文长度为10至20个字符。');
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.calls.filter(call => call.purpose === 'consultation').length, 0);
    assert.equal(run.consultant.requests.length, 0);
    assert.equal(task.coordination.timeline.at(-1).reason, 'FIXED_MODEL_CONSULTATION_NOT_AUTHORIZED');
  } finally {
    run?.consultantRegistration.dispose();
    run?.mainRegistration.dispose();
    if (run?.ctx) {
      await run.ctx.router.flush();
      await run.ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true });
  }
});

test('a real consultation transport failure stays a failed coordination attempt and preserves the main artifact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-transport-'));
  let run;
  try {
    run = await prepareCoordinatedTask(home);
    run.consultant.failureCode = 'TRANSPORT';
    const task = await submit(run.ctx, run.sessionId, '仅检查以下明确要求：正文长度为10至20个字符。');
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.acceptance.evidence[0].measurement.value, 9);
    assert.equal(task.result, `${'A'.repeat(4)}${'A'.repeat(9)}`);
    assert.equal(task.calls.filter(call => call.purpose === 'consultation').length, 1);
    assert.equal(task.coordination.episodes[0].consultation.state, 'failed');
    assert.equal(task.coordination.episodes[0].consultation.reason, 'TRANSPORT');
    assert.equal(task.coordination.consultationAttempts, 1);
  } finally {
    run?.consultantRegistration.dispose();
    run?.mainRegistration.dispose();
    if (run?.ctx) {
      await run.ctx.router.flush();
      await run.ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true });
  }
});

for (const action of ['extend', 'stop', 'revoke']) test(`a real consultation budget wait ${action === 'extend' ? 'resumes the same Task' : action === 'stop' ? 'releases the unsent Call' : 'rechecks candidate authorization'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), `router-t16-budget-${action}-`));
  let run;
  try {
    run = await prepareCoordinatedTask(home, { tokens: 100 });
    const prompt = run.ctx.sessionController.prompt({ sessionId: run.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: '仅检查以下明确要求：正文长度为10至20个字符。' }] }, new AbortController().signal);
    const waitingState = await waitForState(run.ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget' && state.tasks.at(-1).calls.some(call => call.purpose === 'consultation' && call.status === 'waiting'));
    const waiting = waitingState.tasks.at(-1);
    assert.equal(run.consultant.requests.length, 0);
    if (action === 'extend') await run.ctx.router.extendTaskBudget(waiting.id, { tokens: 4096 });
    else if (action === 'stop') await run.ctx.router.stopTask(waiting.id);
    else {
      await run.ctx.router.setModelEnabled(run.consultantRegistration.candidate.candidateId, false);
      await run.ctx.router.extendTaskBudget(waiting.id, { tokens: 4096 });
    }
    await prompt.catch(() => {});
    await run.ctx.agents.get(run.sessionId).whenIdle();
    const task = (await run.ctx.router.snapshot()).tasks.find(item => item.id === waiting.id);
    const consultation = task.calls.find(call => call.purpose === 'consultation');
    if (action === 'extend') {
      assert.equal(task.acceptance.verdict, 'passed');
      assert.equal(consultation.status, 'completed');
      assert.equal(run.consultant.requests.length, 1);
      assert.equal(task.budget.extensions.length, 1);
    } else {
      assert.notEqual(task.acceptance.verdict, 'passed');
      assert.equal(consultation.status, 'not-dispatched');
      assert.equal(run.consultant.requests.length, 0);
      if (action === 'stop') assert.equal(task.pauseReason, 'BUDGET_STOPPED');
      else assert.equal(consultation.failureCode, 'MODEL_NOT_FOUND');
    }
  } finally {
    run?.consultantRegistration.dispose();
    run?.mainRegistration.dispose();
    if (run?.ctx) {
      await run.ctx.router.flush();
      await run.ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true });
  }
});

test('Host restart preserves completed coordination without replaying history', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-restart-'));
  let run;
  let restarted;
  try {
    run = await prepareCoordinatedTask(home);
    const completed = await submit(run.ctx, run.sessionId, '仅检查以下明确要求：正文长度为10至20个字符。');
    const completedRecord = structuredClone(completed);
    run.consultantRegistration.dispose();
    run.mainRegistration.dispose();
    await run.ctx.router.flush();
    await run.ctx.fiber.dispose();
    run.ctx = null;

    restarted = await startNative(home);
    const snapshot = await restarted.router.snapshot();
    const restored = snapshot.tasks.find(item => item.id === completedRecord.id);
    assert.deepEqual(restored.coordination, completedRecord.coordination);
    assert.deepEqual(restored.acceptance, completedRecord.acceptance);
    assert.deepEqual(restored.calls, completedRecord.calls);
  } finally {
    if (run?.ctx) await run.ctx.fiber.dispose();
    if (restarted) await restarted.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

function persistedCoordinationTask(id, pendingState) {
  const consultation = pendingState === 'self-repair' ? null : {
    evidenceVersion: 2,
    candidateId: 'persisted-consultant',
    selectionSnapshot: {},
    callId: pendingState === 'intent-persisted' ? null : `${id}-call`,
    trigger: 'repeated-obstacle',
    state: pendingState,
    adviceHash: pendingState === 'advice-ready' ? 'b'.repeat(64) : null,
    adviceText: pendingState === 'advice-ready' ? 'Persisted advice' : null,
    noticeMessageId: pendingState === 'advice-ready' ? `${id}-notice` : null,
    reason: null,
  };
  const episode = {
    episodeId: `${id}-episode`, blockingId: `${id}-blocking`, blockingKey: 'character-length:failed:evidence',
    requirementIds: [`${id}-requirement`], firstAcceptanceRevision: 1, latestAcceptanceRevision: 1,
    evidenceVersion: pendingState === 'self-repair' ? 1 : 2, evidenceFingerprint: 'a'.repeat(64),
    status: pendingState === 'advice-ready' ? 'advice-ready' : pendingState === 'self-repair' ? 'repair-requested' : 'consulting',
    consultation,
  };
  return {
    id, sessionId: `${id}-session`, turn: 1, lifecycle: 'paused', pauseReason: 'HOST_RESTARTED',
    acceptance: { revision: 1, verdict: 'failed', evidence: [] }, result: '', calls: [], timeline: [], configVersion: 1,
    coordinationPolicy: { ...disabledCoordination, enabled: true },
    coordination: {
      version: 1, revision: 1, acceptanceRevision: 1,
      selfRepair: pendingState === 'self-repair' ? { used: true, episodeId: episode.episodeId, evidenceVersion: 1, noticeMessageId: `${id}-notice`, state: 'intent-persisted' } : null,
      episodes: [episode], consultationAttempts: pendingState === 'self-repair' ? 0 : 1, timeline: [],
    },
  };
}

test('Host startup atomically persists every unconfirmed coordination delivery without replay', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-startup-recovery-'));
  let ctx;
  try {
    const directory = join(home, 'router', 'test');
    await mkdir(directory, { recursive: true });
    const pending = ['self-repair', 'intent-persisted', 'call-reserved', 'advice-ready'].map((state, index) => persistedCoordinationTask(`pending-${index}`, state));
    const completed = persistedCoordinationTask('completed-coordination', 'advice-ready');
    completed.coordination.episodes[0].status = 'resolved';
    completed.coordination.episodes[0].consultation.state = 'advice-delivered';
    const completedCoordination = structuredClone(completed.coordination);
    const legacy = { id: 'legacy-without-coordination', lifecycle: 'completed', acceptance: { verdict: 'unconfirmed', evidence: [] }, result: 'OLD_RESULT', calls: [], timeline: [], configVersion: 1 };
    const statePath = join(directory, 'state.json');
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, config: { automatic: false, version: 2 }, tasks: [...pending, completed, legacy] }), 'utf8');

    ctx = await startNative(home);
    const first = await ctx.router.snapshot();
    for (const [index, task] of pending.entries()) {
      const recovered = first.tasks.find(item => item.id === task.id);
      assert.equal(recovered.coordination.revision, 2);
      assert.equal(recovered.coordination.episodes[0].status, 'stalled');
      if (index === 0) assert.equal(recovered.coordination.selfRepair.state, 'delivery-unknown');
      else assert.equal(recovered.coordination.episodes[0].consultation.state, 'delivery-unknown');
      assert.equal(recovered.coordination.timeline.at(-1).reason, 'RESTART_WITH_UNCONFIRMED_DELIVERY');
    }
    assert.deepEqual(first.tasks.find(item => item.id === completed.id).coordination, completedCoordination);
    assert.deepEqual(first.tasks.find(item => item.id === legacy.id), legacy);
    const raw = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(raw.tasks.map(task => task.coordination), first.tasks.map(task => task.coordination));

    await ctx.fiber.dispose();
    ctx = await startNative(home);
    const second = await ctx.router.snapshot();
    assert.deepEqual(second.tasks.map(task => task.coordination), first.tasks.map(task => task.coordination));
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('Host preserves a legacy Task byte-for-value without adding coordination fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-legacy-'));
  let ctx;
  try {
    const directory = join(home, 'router', 'test');
    await mkdir(directory, { recursive: true });
    const legacy = {
      id: 'legacy-task-without-coordination',
      lifecycle: 'completed',
      acceptance: { verdict: 'unconfirmed', evidence: [] },
      result: 'OLD_RESULT',
      calls: [],
      timeline: [],
      configVersion: 1,
    };
    const statePath = join(directory, 'state.json');
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, config: { automatic: false, version: 2 }, tasks: [legacy] }), 'utf8');

    ctx = await startNative(home);
    const snapshot = await ctx.router.snapshot();
    assert.deepEqual(snapshot.tasks[0], legacy);
    assert.equal(Object.hasOwn(snapshot.tasks[0], 'coordination'), false);
    assert.equal(Object.hasOwn(snapshot.tasks[0], 'coordinationPolicy'), false);
    await ctx.router.flush();
    const rawAfterRestart = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(rawAfterRestart.tasks[0], legacy);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('Host coordination CAS validates both canonical revisions and publishes before resolving', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-cas-'));
  let ctx;
  try {
    ctx = await startNative(home);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply 你好世界\n仅检查以下明确要求：正文长度为10至20个字符。');
    assert.equal(task.acceptance.revision, 1);
    const coordination = {
      version: 1,
      revision: 1,
      acceptanceRevision: 1,
      selfRepair: null,
      episodes: [],
      consultationAttempts: 0,
      timeline: [],
    };
    const publication = ctx.router.publishCoordination(task.id, { acceptanceRevision: 1, coordinationRevision: 0 }, coordination);
    assert.deepEqual(ctx.router.exactTask(sessionId, task.turn).coordination, coordination);
    assert.deepEqual(await publication, coordination);
    const published = ctx.router.exactTask(sessionId, task.turn);
    assert.equal(published.timeline.at(-1).kind, 'coordination-published');
    await assert.rejects(
      ctx.router.publishCoordination(task.id, { acceptanceRevision: 1, coordinationRevision: 0 }, { ...coordination, revision: 2 }),
      error => error?.code === 'COORDINATION_STALE',
    );
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
