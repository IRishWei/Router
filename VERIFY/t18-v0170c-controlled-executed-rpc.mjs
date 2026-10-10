// Prelaunch draft: final reviewed source/contract/plan gates are required by the launcher.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyFrozenT18Labels } from './t18-label-preservation.mjs';

const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const notes = directory + '/implement-spec-go-20261009';
const stage = process.argv[2] ?? 'controlled', label = process.argv[3];
assert(['controlled', 'restart'].includes(stage)); assert(/^t18-v017\d[a-z]$/.test(label));
const { rpc, snapshot, save, initial, owner } = await import(pathToFileURL(directory + '/' + label + '-host-rpc.mjs').href);
const identity = JSON.parse(await readFile(directory + '/' + label + '-package-identity.json', 'utf8'));
const plan = JSON.parse(await readFile(notes + '/' + label + '-validation-plan.json', 'utf8'));
assert.equal(identity.reviewedSourceSha, plan.source); assert.equal(identity.version, plan.version);
const counts = async () => JSON.parse(await readFile(owner.home + '/t18-controlled-counts.json', 'utf8'));
const nativeDefault = (await rpc('session', 'modelCatalog')).default;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const control = value => writeFile(owner.home + '/t18-controlled-scenario.json', JSON.stringify(value, null, 2));
if (stage === 'restart') {
  const before = JSON.parse(await readFile(directory + '/' + label + '-desktop-evidence.json', 'utf8'));
  assert.deepEqual(initial.tasks, before.final.tasks); assert.deepEqual(initial.config, before.final.config);
  assert.deepEqual(nativeDefault, before.nativeDefault); assert.deepEqual(await counts(), before.counts);
  await save(label + '-restart-evidence.json', { passed: true, version: before.version, tasks: initial.tasks.length,
    fullTasksCallsLedgersUnchanged: true, configUnchanged: true, globalDefaultUnchanged: true,
    fixtureCounterUnchanged: true, newStreams: 0, preservation: await verifyFrozenT18Labels(), realModelRequests: 0 });
  console.log(JSON.stringify({ stage, passed: true, tasks: initial.tasks.length, realModelRequests: 0 }));
} else {
  assert.equal(initial.tasks.length, 0); assert.equal(initial.storageError, null);
  const candidates = initial.candidateSnapshot.candidates.filter(candidate => candidate.identity.provider === plan.fixture.provider
    && candidate.identity.billingPath === 't18-controlled-fixture');
  assert.equal(candidates.length, plan.fixture.ownedModels);
  const byModel = model => { const matches = candidates.filter(candidate => candidate.identity.model === model); assert.equal(matches.length, 1); return matches[0]; };
  const main = byModel('main'), advisor = byModel('advisor');
  const baseRecovery = { enabled: true, automatic: true, alternativeCandidateId: null, maxTokens: 512, forecastTokens: 65536 };
  const acceptance = enabled => ({ enabled, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 512, forecastTokens: 16384 } });
  const coordination = enabled => ({ enabled, candidateId: enabled ? advisor.candidateId : null,
    allowCrossModel: enabled, allowFixedModel: enabled, maxTokens: 256, maxAdviceChars: 1024, forecastTokens: 8192 });
  const takeover = enabled => ({ enabled, candidateId: enabled ? byModel('alternative').candidateId : null,
    allowCrossModel: enabled, allowFixedModel: enabled, maxTokens: 512, forecastTokens: 65536 });
  await save(label + '-desktop-initial.json', { initial, nativeDefault, counts: await counts(), realModelRequests: 0 });
  for (const row of initial.models.filter(model => model.enabled)) await rpc('router', 'setModelEnabled', { candidateId: row.candidateId, enabled: false });
  await rpc('router', 'setAutomatic', { automatic: true });
  await rpc('router', 'setRoutingObjective', { objective: 'balanced' });
  const runDeadline = Date.now() + plan.controlledRunDeadlineMs;
  const isSettled = task => ['completed', 'paused', 'stopped'].includes(task.lifecycle)
    && task.calls.every(call => call.status !== 'running' && call.reservation?.state !== 'reserved');
  async function exactTask(sessionId, requestId, predicate) {
    const deadline = Math.min(runDeadline, Date.now() + 45000);
    while (Date.now() < deadline) {
      const matches = (await snapshot()).tasks.filter(task => task.sessionId === sessionId && task.inputs?.some(input => input.requestId === requestId));
      assert(matches.length <= 1);
      if (matches[0] && predicate(matches[0])) return matches[0];
      await delay(10);
    }
    throw new Error('The exact request-bound T18 Task did not reach its required public state');
  }
  async function settledTask(sessionId, requestId) {
    while (Date.now() < runDeadline) {
      const first = await exactTask(sessionId, requestId, isSettled), counter = await counts();
      await delay(200);
      const second = await exactTask(sessionId, requestId, isSettled);
      if (JSON.stringify(first) === JSON.stringify(second) && JSON.stringify(counter) === JSON.stringify(await counts())) return second;
    }
    throw new Error('The full Task, auxiliary Calls and counter did not settle within the predeclared local deadline');
  }
  async function prompt(sessionId, requestId, content) {
    await rpc('session', 'prompt', { request: { sessionId, requestId, mode: 'queue', content } });
  }
  const imageBytes = await readFile(notes + '/t15-reference.png');
  const imageHash = digest(imageBytes);
  assert.equal(imageHash, 'a5258c1d2fc60c919c9f1f539034ba6086a5dcee0d5f79c9ce7c20dd0bed038b');
  const observations = [];
  async function run(row) {
    assert(Date.now() < runDeadline);
    const alternative = row.alternative ? byModel(row.alternative) : null;
    const wanted = new Set([main.candidateId, ...(row.coordination ? [advisor.candidateId] : []),
      ...(alternative ? [alternative.candidateId] : []), ...(row.takeover ? [byModel('alternative').candidateId] : [])]);
    await rpc('router', 'setFixedModel', { candidateId: null });
    for (const candidate of candidates) await rpc('router', 'setModelEnabled', { candidateId: candidate.candidateId, enabled: wanted.has(candidate.candidateId) });
    await rpc('router', 'setFixedModel', { candidateId: main.candidateId });
    await rpc('router', 'setBudgetDefaults', { budget: { tokens: 262144, durationMs: 45000, money: row.money ? [{ currency: 'USD', kind: 'fixture-reference', amount: 1 }] : [] } });
    await rpc('router', 'setAcceptancePolicy', { policy: acceptance(Boolean(row.coordination)) });
    await rpc('router', 'setCoordinationPolicy', { policy: { ...coordination(Boolean(row.coordination)), maxTokens: row.coordinationMaxTokens ?? 256, forecastTokens: row.coordinationForecastTokens ?? 8192 } });
    await rpc('router', 'setTakeoverPolicy', { policy: { ...takeover(Boolean(row.takeover)), maxTokens: row.takeoverMaxTokens ?? 512, forecastTokens: row.takeoverForecastTokens ?? 65536 } });
    await rpc('router', 'setRecoveryPolicy', { policy: { ...baseRecovery, automatic: !row.manual,
      maxTokens: row.recoveryMaxTokens ?? baseRecovery.maxTokens, forecastTokens: row.recoveryForecastTokens ?? baseRecovery.forecastTokens, alternativeCandidateId: alternative?.candidateId ?? null } });
    const { sessionId } = await rpc('session', 'create', { request: { cwd: owner.home } });
    const setupTaskIds = [];
    if (row.setupPrime) {
      const primeId = randomUUID();
      await control({ mode: null, sessionId, requestId: primeId });
      await prompt(sessionId, primeId, [{ type: 'text', text: 'T18_PRIME_ORIGINAL_MODEL_AND_HISTORY' }]);
      const prime = await settledTask(sessionId, primeId);
      assert.equal(prime.lifecycle, 'completed'); setupTaskIds.push(prime.id);
    }
    if (row.alternative && !row.fixed) await rpc('router', 'setFixedModel', { candidateId: null });
    if (row.name === 'budget-stop') {
      assert.equal(row.budgetTokens, 20);
      await rpc('router', 'setBudgetDefaults', { budget: { tokens: row.budgetTokens, durationMs: 45000, money: [] } });
    }
    const before = await counts(), requestId = randomUUID();
    const text = 'T18_CASE ' + (row.mode ?? row.name) + '\nRetain this complete original input, every system instruction and all previous completed work.'
      + (row.coordination ? '\n仅检查以下明确要求：正文长度为20至30个字符。' : '');
    const content = [{ type: 'text', text }];
    if (row.image) content.push({ type: 'image', mediaType: 'image/png', data: imageBytes.toString('base64'), name: 't18-reference.png' });
    const presetControl = { mode: row.mode ?? row.name, sessionId, requestId };
    await control(presetControl); await prompt(sessionId, requestId, content);
    const live = [];
    if (row.name === 'manual-retry') {
      const waiting = await exactTask(sessionId, requestId, task => task.recovery?.state === 'waiting-user'); live.push(waiting);
      const request = { taskId: waiting.id, recoveryId: waiting.recovery.id, expectedRevision: waiting.recovery.revision, action: 'retry-current' };
      const replies = await Promise.allSettled([rpc('router', 'resolveTaskRecovery', { request }), rpc('router', 'resolveTaskRecovery', { request })]);
      assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
      assert.match(replies.find(reply => reply.status === 'rejected').reason.message, /RECOVERY_STALE|RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED/);
    } else if (row.name === 'manual-current-only') {
      for (const attempt of [1, 2]) {
        const waiting = await exactTask(sessionId, requestId, task => task.recovery?.state === 'waiting-user' && task.recovery.attempts === attempt); live.push(waiting);
        await rpc('router', 'resolveTaskRecovery', { request: { taskId: waiting.id, recoveryId: waiting.recovery.id, expectedRevision: waiting.recovery.revision, action: 'retry-current' } });
      }
    } else if (row.name === 'manual-stop') {
      const waiting = await exactTask(sessionId, requestId, task => task.recovery?.state === 'waiting-user'); live.push(waiting);
      await save(label + '-live-renderer-context.json', { sessionId, requestId, taskId: waiting.id, recoveryId: waiting.recovery.id, expectedRevision: waiting.recovery.revision, realModelRequests: 0 });
      const output = execFileSync(process.execPath, [notes + '/' + label + '-controlled-executed-renderer.mjs', 'controlled', label, '--live'], { windowsHide: true, timeout: 30000 });
      await writeFile(directory + '/' + label + '-live-renderer-run.log', output, { flag: 'wx' });
    } else if (row.name === 'permit-revoked') {
      const waiting = await exactTask(sessionId, requestId, task => task.recovery?.state === 'backoff'); live.push(waiting);
      await rpc('router', 'setAutomatic', { automatic: false });
    } else if (row.name === 'budget-stop') {
      const waiting = await exactTask(sessionId, requestId, task => task.lifecycle === 'waiting-budget'); live.push(waiting);
      await rpc('router', 'stopTask', { taskId: waiting.id });
    }
    const task = await settledTask(sessionId, requestId), after = await counts();
    const requests = after.requests.slice(before.requests.length), seams = after.nativeSeams.slice(before.nativeSeams.length), bodies = after.toolExecutions.slice(before.toolExecutions.length);
    const execution = requests.filter(request => request.model !== 'advisor' && request.purpose !== 'session-title');
    assert.equal(task.calls.filter(call => call.dispatchStarted).length, requests.length);
    assert(task.calls.every(call => ['settled', 'released'].includes(call.reservation.state)));
    assert(task.calls.filter(call => !call.dispatchStarted).every(call => call.usage === null && call.reservation.state === 'released'));
    assert.equal(task.budget.extensions.length, 0);
    const knownTokens = task.calls.reduce((sum, call) => sum + (call.usage?.totalTokens ?? 0), 0);
    const unknownCalls = task.calls.filter(call => call.dispatchStarted && call.usage?.totalTokens == null).length;
    assert.equal(task.ledger.knownTokens.total, knownTokens);
    assert.equal(task.ledger.unknownTokenCalls.total, unknownCalls);
    assert.equal(task.ledger.tokens.total, unknownCalls ? null : knownTokens);
    assert(task.recovery && task.recovery.attempts <= 2 && task.recovery.waitMs <= 1000);
    assert.equal(JSON.stringify(task).includes('T18_LOCAL_SECRET_BODY_MUST_NOT_ENTER_FAILURE_DTO'), false);
    assert(requests.every(request => !request.historicalReplayPresent));
    assert.equal(execution.length, row.entries);
    if (row.completed) assert.equal(task.lifecycle, 'completed'); else assert(['paused', 'stopped'].includes(task.lifecycle));
    if (row.category) assert.equal(task.recovery.category, row.category);
    if (row.reason) assert.match(task.recovery.reason, row.reason);
    if (row.alternative) {
      const targetEntries = execution.filter(request => request.model === row.alternative);
      assert.equal(targetEntries.length, row.targetEntries ?? 0);
      if (targetEntries.length) {
        assert.equal(task.recovery.target.candidateId, alternative.candidateId);
        const source = task.calls.find(call => call.dispatchStarted && call.purpose !== 'session-title').selection;
        for (const key of ['connectionId', 'accountId', 'billingPath']) assert.equal(task.recovery.target.identity[key], source[key]);
        assert(targetEntries[0].visible.messages.some(message => message.content.some(part => part.type === 'text' && part.text === text)));
        assert(targetEntries[0].visible.messages.some(message => message.content.some(part => part.type === 'text' && part.text.includes('T18_PRIME_ORIGINAL_MODEL_AND_HISTORY'))));
      }
    }
    if (row.coordination) {
      assert.equal(task.coordination.consultationAttempts, 1);
      assert.equal(task.coordination.episodes.filter(episode => episode.consultation?.state === 'advice-delivered').length, 1);
      assert.equal(requests.filter(request => request.model === 'advisor').length, row.takeover ? 1 : 2);
      assert.equal(task.acceptance.verdict, 'passed');
    } else assert.equal(task.takeover, null);
    if (row.takeover) { assert.equal(task.takeover.attempts, 1); assert.equal(task.recovery.phase, 'takeover'); }
    if (row.effectiveMaxTokens) {
      assert.equal(task.recovery.maxTokens, row.effectiveMaxTokens);
      assert.equal(task.recovery.finalRequest.maxTokens, row.effectiveMaxTokens);
      if (row.takeover) {
        assert.equal(execution.at(-1).maxTokens, row.effectiveMaxTokens);
        assert.deepEqual(execution.filter(request => request.model === 'alternative').map(request => request.maxTokens), [row.takeoverMaxTokens, row.effectiveMaxTokens]);
        assert.equal(task.takeover.plan.policy.maxTokens, row.takeoverMaxTokens);
      } else {
        assert.deepEqual(requests.filter(request => request.model === 'advisor').map(request => request.maxTokens), [row.coordinationMaxTokens, row.effectiveMaxTokens]);
        assert.equal(task.recovery.finalRequest.nativeRequest, false);
        assert.equal(task.recovery.finalRequest.ownedRequest, true);
      }
    }
    if (row.effectiveForecastTokens) {
      assert.equal(task.recovery.forecastTokens, row.effectiveForecastTokens);
      const recovered = task.calls.find(call => call.id === task.recovery.callId);
      assert.equal(recovered.reservation.tokens.total, row.effectiveForecastTokens);
      assert.equal(recovered.reservation.tokens.output, row.effectiveMaxTokens);
      if (row.takeover) {
        assert.equal(task.takeover.plan.forecast.totalTokens, row.effectiveForecastTokens);
        const takeoverCalls = task.calls.filter(call => call.takeoverPlanId);
        assert.equal(takeoverCalls[0].reservation.tokens.total, row.takeoverForecastTokens);
      } else {
        const consultationCalls = task.calls.filter(call => call.purpose === 'consultation');
        assert.equal(consultationCalls[0].reservation.tokens.total, row.coordinationForecastTokens);
      }
    }
    if (row.name === 'duplicate-operation') assert.equal(bodies.filter(body => body.effect === 'side-effect').length, 1);
    if (row.name === 'operation-unproved') assert.equal(bodies.length, 1);
    if (row.completed && task.recovery.finalRequest?.nativeRequest) {
      const bound = task.recovery.finalRequest;
      const last = seams.findLast(seam => seam.nativeAgentLoop && seam.model === bound.model);
      assert(last && last.frozen && last.sessionId === sessionId);
      assert.equal(bound.taskId, task.id); assert.equal(bound.turn, task.turn);
      for (const key of ['provider', 'model', 'maxTokens', 'system', 'tools', 'toolHistory']) assert.deepEqual(last.nativeInput[key], bound[key]);
      assert.deepEqual(last.nativeInput.messages.map(message => ({ id: message.id, role: message.role, content: message.content,
        sourceKind: message.source?.kind ?? null, ...(message.toolCallId ? { toolCallId: message.toolCallId, isError: Boolean(message.isError) } : {}) })), bound.messages);
    }
    if ((row.mode ?? row.name) === 'consultation-recovery') {
      assert.equal(task.recovery.phase, 'consultation'); assert.equal(task.recovery.finalRequest.nativeRequest, false);
      const attempts = requests.filter(request => request.model === 'advisor'); assert.deepEqual(attempts[0].visible, attempts[1].visible);
    }
    if (row.image) {
      const admitted = execution[0]?.imageMetadata[0];
      assert(admitted && admitted.bytes > 0 && /^[a-f0-9]{64}$/.test(admitted.dataHash));
      assert(execution.every(request => request.imageMetadata.length === 1 && JSON.stringify(request.imageMetadata[0]) === JSON.stringify(admitted)),
        'Recovery must retain the exact attachment and actual SDK-admitted image bytes, including legitimate ingress conversion');
      if (row.completed) assert.equal(task.recovery.imageForecast.visualTokens, 64);
    }
    const observed = { name: row.name, prompt: text, requestId, sessionId, setupTaskIds, task, requests, nativeSeams: seams,
      toolExecutions: bodies, liveSnapshots: live, presetControl, expected: row,
      sourceImageHash: row.image ? imageHash : null,
      admittedImage: row.image ? execution[0].imageMetadata[0] : null, realModelRequests: 0 };
    await save(label + '-scenario-' + row.name + '.json', observed);
    observations.push({ name: row.name, taskId: task.id, setupTaskIds, calls: task.calls.length, localStreams: requests.length,
      recoveryPhase: task.recovery.phase, category: task.recovery.category, attempts: task.recovery.attempts, reason: task.recovery.reason });
    if (row.name === 'permit-revoked') await rpc('router', 'setAutomatic', { automatic: true });
  }
  for (const row of plan.scenarios) await run({ ...row, reason: row.reasonPattern ? new RegExp(row.reasonPattern) : null });
  for (const [method, args] of [
    ['setAcceptancePolicy', { policy: initial.config.acceptance }], ['setCoordinationPolicy', { policy: initial.config.coordination }],
    ['setTakeoverPolicy', { policy: initial.config.takeover }], ['setRecoveryPolicy', { policy: initial.config.recovery }],
    ['setRoutingObjective', { objective: initial.config.routingObjective }], ['setAutomatic', { automatic: initial.config.automatic }],
    ['setFixedModel', { candidateId: initial.config.fixedCandidateId ?? null }], ['setBudgetDefaults', { budget: initial.config.budget }],
  ]) await rpc('router', method, args);
  for (const candidate of candidates) await rpc('router', 'removeModel', { candidateId: candidate.candidateId });
  for (const row of initial.models.filter(model => model.enabled)) await rpc('router', 'setModelEnabled', { candidateId: row.candidateId, enabled: true });
  await control({ mode: null, sessionId: null, requestId: null });
  const final = await snapshot(), finalCounts = await counts();
  for (const key of ['automatic', 'routingObjective', 'semanticAssessment', 'acceptance', 'coordination', 'takeover', 'recovery', 'fixedModel', 'fixedCandidateId', 'pool', 'prices', 'budget']) assert.deepEqual(final.config[key], initial.config[key], key);
  assert.deepEqual((await rpc('session', 'modelCatalog')).default, nativeDefault);
  assert.equal(finalCounts.requests.length, final.tasks.reduce((sum, task) => sum + task.calls.filter(call => call.dispatchStarted).length, 0));
  assert.equal(finalCounts.realModelRequests, 0); assert.equal(observations.length, plan.scenarios.length);
  await save(label + '-desktop-evidence.json', { passed: true, version: identity.version, initial, final, nativeDefault,
    counts: finalCounts, observations, presetUsagePerStream: 8, imageAssetHash: imageHash,
    productionBillingVerified: false, productionVisionQualityVerified: false, preservation: await verifyFrozenT18Labels(), realModelRequests: 0 });
  console.log(JSON.stringify({ stage, passed: true, scenarios: observations.length, tasks: final.tasks.length,
    controlledStreams: finalCounts.requests.length, realModelRequests: 0 }));
}
