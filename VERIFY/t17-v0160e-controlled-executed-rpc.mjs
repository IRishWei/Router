import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preserveExistingEvidence } from './t17-preservation.mjs';

const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const stage = process.argv[2] ?? 'controlled', label = process.argv[3];
assert(['controlled', 'restart'].includes(stage));
assert(/^t17-v016\d[a-z]$/.test(label));
const { rpc, snapshot, save, initial, owner } = await import(pathToFileURL(directory + '/' + label + '-host-rpc.mjs').href);
const packageIdentity = JSON.parse(await readFile(directory + '/' + label + '-package-identity.json', 'utf8'));
assert(/^0\.16\.\d$/.test(packageIdentity.version));
const counts = async () => JSON.parse(await readFile(owner.home + '/t17-controlled-counts.json', 'utf8'));
const nativeDefault = (await rpc('session', 'modelCatalog')).default;
if (stage === 'restart') {
  const before = JSON.parse(await readFile(directory + '/' + label + '-desktop-evidence.json', 'utf8'));
  assert.deepEqual(initial.tasks, before.final.tasks);
  assert.deepEqual(initial.config, before.final.config);
  assert.deepEqual(nativeDefault, before.nativeDefault);
  assert.deepEqual(await counts(), before.counts);
  await save(label + '-restart-evidence.json', { passed: true, version: before.version,
    tasks: initial.tasks.length, fullTasksCallsLedgersUnchanged: true, configUnchanged: true,
    globalDefaultUnchanged: true, fixtureCounterUnchanged: true, newStreams: 0,
    preservation: await preserveExistingEvidence(), realModelRequests: 0 });
  console.log(JSON.stringify({ stage, passed: true, tasks: initial.tasks.length, realModelRequests: 0 }));
} else {
  assert.equal(initial.tasks.length, 0);
  assert.equal(initial.storageError, null);
  const allCandidates = initial.candidateSnapshot.candidates.filter(candidate =>
    candidate.identity.provider.startsWith('router-t17-controlled-fixture')
    && candidate.identity.billingPath === 't17-controlled-fixture');
  assert.equal(allCandidates.length, 7, 'Expected exact seven owned fixture candidates');
  const byModel = model => {
    const matches = allCandidates.filter(candidate => candidate.identity.model === model);
    assert.equal(matches.length, 1, 'Fixture model identity must be unambiguous');
    return matches[0];
  };
  const main = byModel('main'), advisor = byModel('advisor');
  const targetForecast = 65536;
  await save(label + '-desktop-initial.json', { initial, nativeDefault, counts: await counts(), realModelRequests: 0 });
  for (const row of initial.models.filter(model => model.enabled)) await rpc('router', 'setModelEnabled', { candidateId: row.candidateId, enabled: false });
  await rpc('router', 'setAutomatic', { automatic: true });
  await rpc('router', 'setRoutingObjective', { objective: 'balanced' });
  await rpc('router', 'setAcceptancePolicy', { policy: { enabled: true,
    review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 512, forecastTokens: 16384 } } });
  const imageBytes = await readFile(directory + '/implement-spec-go-20261009/t15-reference.png');
  const imageHash = createHash('sha256').update(imageBytes).digest('hex');
  assert.equal(imageHash, 'a5258c1d2fc60c919c9f1f539034ba6086a5dcee0d5f79c9ce7c20dd0bed038b');
  const observations = [];
  let waitBudgetBaseline = null;

  async function exactTask(sessionId, requestId, predicate, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const task = (await snapshot()).tasks.find(item => item.sessionId === sessionId
        && item.inputs?.some(input => input.requestId === requestId));
      if (task && predicate(task)) return task;
      await delay(50);
    }
    throw new Error('Exact request-bound controlled Task did not reach its required state');
  }
  const isSettled = task => ['completed', 'paused', 'stopped'].includes(task.lifecycle)
    && task.calls.every(call => call.status !== 'running' && call.reservation?.state !== 'reserved');
  async function settledTask(sessionId, requestId) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const first = await exactTask(sessionId, requestId, isSettled, Math.max(1, deadline - Date.now()));
      const counter = await counts();
      await delay(200);
      const second = (await snapshot()).tasks.find(item => item.sessionId === sessionId
        && item.inputs?.some(input => input.requestId === requestId));
      if (second && isSettled(second) && JSON.stringify(first) === JSON.stringify(second)
        && JSON.stringify(counter) === JSON.stringify(await counts())) return second;
    }
    throw new Error('Exact Task and auxiliary-call counter did not reach an observed stable settled state');
  }
  const takeoverReason = task => task.takeover?.plan?.reason
    ?? task.takeover?.timeline?.findLast(entry => typeof entry.reason === 'string' && entry.reason)?.reason ?? null;
  const refusalCodes = { 'fixed-denied': 'FIXED_MODEL_TAKEOVER_NOT_AUTHORIZED',
    'capacity-small': 'TAKEOVER_CONTEXT_CAPACITY_EXCEEDED',
    'handoff-unknown': 'TAKEOVER_PROTOCOL_UNKNOWN',
    'format-unsupported': 'TAKEOVER_TOOL_PROTOCOL_UNSUPPORTED',
    'image-text-target': 'TAKEOVER_IMAGE_CAPABILITY_UNSUPPORTED',
    'budget-revoked': 'MODEL_DISABLED' };
  async function setCasePolicy(targetModel, grant, tokens) {
    const wanted = new Set([main.candidateId, advisor.candidateId, byModel(targetModel).candidateId]);
    for (const candidate of allCandidates) await rpc('router', 'setModelEnabled', { candidateId: candidate.candidateId, enabled: wanted.has(candidate.candidateId) });
    await rpc('router', 'setFixedModel', { candidateId: main.candidateId });
    await rpc('router', 'setBudgetDefaults', { budget: { tokens, durationMs: 45000, money: [] } });
    await rpc('router', 'setCoordinationPolicy', { policy: { enabled: true, candidateId: advisor.candidateId,
      allowCrossModel: true, allowFixedModel: true, maxTokens: 256, maxAdviceChars: 1024, forecastTokens: 8192 } });
    await rpc('router', 'setTakeoverPolicy', { policy: { enabled: true, candidateId: byModel(targetModel).candidateId,
      allowCrossModel: true, allowFixedModel: grant, maxTokens: 512, forecastTokens: targetForecast } });
  }

  async function run({ name, mode = 'text', target = 'target', grant = true, image = false, revokeAtWait = false, expect = 'passed' }) {
    if (revokeAtWait) assert(waitBudgetBaseline && Number.isSafeInteger(waitBudgetBaseline.forecast) && waitBudgetBaseline.forecast > 8192);
    await setCasePolicy(target, grant, revokeAtWait ? waitBudgetBaseline.forecast : 262144);
    const { sessionId } = await rpc('session', 'create', { request: { cwd: owner.home } });
    let setupTask = null;
    if (image) {
      const primeRequestId = randomUUID();
      await rpc('session', 'prompt', { request: { sessionId, requestId: primeRequestId, mode: 'queue', content: [{ type: 'text', text: 'T17_PRIME_IMAGE_HEADER' }] } });
      setupTask = await settledTask(sessionId, primeRequestId);
      assert.equal(setupTask.lifecycle, 'completed');
      assert.equal(setupTask.calls.filter(call => call.purpose === 'consultation').length, 0);
    }
    const before = await counts();
    const requestId = randomUUID();
    const prompt = image
      ? 'T17_CASE image\nKeep this original user constraint and the admitted image.\n仅检查以下明确要求：正文长度为50至90个字符。\n仅检查以下图像要求：图像1识别「颜色与形状」的参考答案为「红色圆形」。'
      : 'T17_CASE ' + mode + '\nKeep this original user constraint and all completed work.\n仅检查以下明确要求：正文长度为20至30个字符。';
    const content = [{ type: 'text', text: prompt }];
    if (image) content.push({ type: 'image', mediaType: 'image/png', data: imageBytes.toString('base64'), name: 't17-reference.png' });
    await rpc('session', 'prompt', { request: { sessionId, requestId, mode: 'queue', content } });
    let waiting = null;
    if (revokeAtWait) {
      waiting = await exactTask(sessionId, requestId, task => task.lifecycle === 'waiting-budget' && task.takeover?.plan?.state === 'prepared');
      await save(label + '-budget-wait-before-revoke.json', { task: waiting, counts: await counts(), realModelRequests: 0 });
      await rpc('router', 'setModelEnabled', { candidateId: byModel(target).candidateId, enabled: false });
    }
    const task = await settledTask(sessionId, requestId);
    const after = await counts();
    const requests = after.requests.slice(before.requests.length);
    const seams = (after.nativeSeams ?? []).slice((before.nativeSeams ?? []).length);
    const bodies = after.toolExecutions.slice(before.toolExecutions.length);
    const dispatched = task.calls.filter(call => call.dispatchStarted);
    assert.equal(requests.length, dispatched.length, 'Every actual local stream, including title/consultation, belongs to its exact Task');
    assert(task.calls.filter(call => !call.dispatchStarted).every(call => call.status === 'not-dispatched'
      && call.reservation.state === 'released' && call.usage === null), 'Keep cancelled reservations without claiming an actual stream');
    assert(task.calls.every(call => call.selection.provider.startsWith('router-t17-controlled-fixture')));
    assert.equal(task.ledger.tokens.total, requests.length * 8, 'Preset usage arithmetic must include the complete Task');
    assert.equal(task.calls.filter(call => call.purpose === 'consultation').length, 1);
    assert.equal(task.budget.extensions?.length ?? 0, 0);
    assert.equal(task.turn, setupTask ? setupTask.turn + 1 : 1,
      'Keep the image-admission setup Task separate from the exact request-bound Task');
    assert(requests.every(request => request.historicalReplayPresent === false));
    const nativeTargets = seams.filter(seam => seam.nativeAgentLoop && seam.provider.endsWith('-target'));
    const targetRequests = requests.filter(request => request.provider.endsWith('-target') && request.purpose !== 'session-title');
    assert(nativeTargets.every(seam => seam.sessionId === sessionId), 'Every target native request retains the exact Session identity');
    assert(targetRequests.every(request => request.sessionId === sessionId));
    if (expect === 'passed') {
      assert.equal(task.lifecycle, 'completed');
      assert.equal(task.acceptance.verdict, 'passed');
      assert.equal(task.takeover.attempts, 1);
      assert.equal(task.takeover.plan.state, 'completed');
      assert.equal(task.executionOwner.candidateId, byModel(target).candidateId);
      assert.equal(task.executionOwner.confidence, 'response-observed');
      assert.equal(nativeTargets.length, targetRequests.length);
      assert(nativeTargets.length > 0 && nativeTargets.every(seam => seam.frozen));
      assert.equal(task.takeover.plan.finalRequest.callId, task.executionOwner.callId);
      const bound = task.takeover.plan.finalRequest, actual = nativeTargets.at(-1).nativeInput;
      assert.equal(bound.nativeRequest, true);
      assert.equal(bound.taskId, task.id);
      assert.equal(bound.sessionId, sessionId);
      assert.equal(bound.turn, task.turn);
      assert.equal(bound.step, task.executionOwner.step);
      for (const key of ['provider','model','maxTokens','system','tools','toolHistory']) {
        assert.deepEqual(actual[key], bound[key], 'The last exact native request must match the saved final request: ' + key);
      }
      const messageDtos = actual.messages.map(message => ({ id: message.id, role: message.role,
        content: message.content, sourceKind: message.source?.kind ?? null,
        ...(message.toolCallId ? { toolCallId: message.toolCallId, isError: Boolean(message.isError) } : {}) }));
      assert.deepEqual(messageDtos, bound.messages, 'Full canonical DTOs must retain every native message and content part');
      assert.equal(createHash('sha256').update(JSON.stringify(bound)).digest('hex'), task.takeover.plan.finalRequestHash);
      for (const request of targetRequests) {
        assert.equal(request.visible.messages.find(message => message.id === task.inputs[0].messageId)?.content[0]?.text, prompt);
        for (const prior of ['AAAA', 'AAAAAAAAA', 'AAAAAAAAAAAAAA']) assert(request.visible.messages.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === prior)));
      }
    } else if (expect === 'duplicate-operation') {
      assert.equal(task.lifecycle, 'paused');
      assert.equal(task.takeover.plan.reason, 'TAKEOVER_DUPLICATE_OPERATION');
      assert.equal(targetRequests.length, 1);
      assert.equal(bodies.filter(body => body.effect === 'side-effect').length, 1);
      assert.equal(task.acceptance.verdict, 'failed');
    } else {
      assert.equal(task.acceptance.verdict, 'failed');
      assert.equal(task.acceptance.artifact.text, 'AAAAAAAAAAAAAA', 'The current failed artifact remains intact; Task.result can contain earlier step output');
      assert.equal(targetRequests.length, 0);
      assert.equal(nativeTargets.length, 0);
      assert.equal(task.executionOwner.candidateId, main.candidateId);
      assert.equal(task.executionOwner.confidence, 'response-observed');
      assert.equal(typeof takeoverReason(task), 'string');
      assert(takeoverReason(task).length > 0, 'Refusal must be visible');
      assert.equal(takeoverReason(task), refusalCodes[name], 'The actual refusal must match this scenario cause');
    }
    if (mode === 'tools' || mode === 'duplicate-operation') {
      const id = 't17-original-' + mode;
      const literal = mode === 'tools' ? 'T17_COMPLETE_READ_RECEIPT:ORIGINAL_LITERAL_VALUE' : 'T17_COMPLETED_SIDE_EFFECT:t17-one-completed-operation';
      assert(targetRequests.length > 0);
      assert(targetRequests[0].visible.messages.some(message => message.content.some(part => part.type === 'tool-call' && part.id === id)));
      assert.equal(targetRequests[0].visible.messages.find(message => message.toolCallId === id)?.content[0]?.text, literal);
      assert(task.toolReceipts.some(receipt => receipt.callId === id && receipt.outcome === 'completed'));
      if (mode === 'tools') { assert.equal(bodies.length, 2); assert(bodies.every(body => body.effect === 'read')); }
    }
    if (image && expect === 'passed') {
      const admitted = task.acceptance.image.images;
      assert.equal(admitted.length, 1);
      assert.equal(admitted[0].origin.requestId, requestId);
      assert.equal(admitted[0].hash, imageHash);
      assert.equal(task.takeover.plan.imageForecast.visualTokens, 64);
      for (const request of targetRequests) {
        assert.equal(request.imageMetadata.length, 1);
        assert.equal(request.imageMetadata[0].attachmentId, admitted[0].attachment.attachmentId);
        assert.equal(request.imageMetadata[0].dataHash, admitted[0].hash);
      }
    }
    const observed = { name, prompt, requestId, sessionId, setupTaskId: setupTask?.id ?? null,
      task, requests, nativeSeams: seams, toolExecutions: bodies, waiting: waiting !== null,
      budgetWaitBaseline: revokeAtWait ? waitBudgetBaseline : null, refusalReason: takeoverReason(task), realModelRequests: 0 };
    await save(label + '-scenario-' + name + '.json', observed);
    observations.push({ name, taskId: task.id, setupTaskId: setupTask?.id ?? null, calls: task.calls.length,
      targetRequests: targetRequests.length, verdict: task.acceptance.verdict, refusalReason: takeoverReason(task) });
    return observed;
  }

  const textCase = await run({ name: 'text' });
  const baselineCall = textCase.task.calls.find(call => call.id === textCase.task.executionOwner.callId);
  waitBudgetBaseline = { taskId: textCase.task.id, callId: baselineCall.id, forecast: baselineCall.reservation.tokens.total };
  await run({ name: 'image', mode: 'image', image: true });
  await run({ name: 'tools', mode: 'tools' });
  await run({ name: 'duplicate-operation', mode: 'duplicate-operation', expect: 'duplicate-operation' });
  await run({ name: 'fixed-denied', grant: false, expect: 'refused' });
  await run({ name: 'capacity-small', target: 'target-small', expect: 'refused' });
  await run({ name: 'handoff-unknown', target: 'target-unknown', expect: 'refused' });
  await run({ name: 'format-unsupported', target: 'target-format-unsupported', expect: 'refused' });
  await run({ name: 'image-text-target', mode: 'image', image: true, target: 'target-text-only', expect: 'refused' });
  await run({ name: 'budget-revoked', revokeAtWait: true, expect: 'refused' });

  for (const [method, args] of [
    ['setAcceptancePolicy', { policy: initial.config.acceptance }],
    ['setCoordinationPolicy', { policy: initial.config.coordination }],
    ['setTakeoverPolicy', { policy: initial.config.takeover }],
    ['setRoutingObjective', { objective: initial.config.routingObjective }],
    ['setAutomatic', { automatic: initial.config.automatic }],
    ['setFixedModel', { candidateId: initial.config.fixedCandidateId ?? null }],
    ['setBudgetDefaults', { budget: initial.config.budget }],
  ]) await rpc('router', method, args);
  for (const candidate of allCandidates) await rpc('router', 'removeModel', { candidateId: candidate.candidateId });
  for (const row of initial.models.filter(model => model.enabled)) await rpc('router', 'setModelEnabled', { candidateId: row.candidateId, enabled: true });
  const final = await snapshot();
  for (const key of ['automatic','routingObjective','semanticAssessment','acceptance','coordination','takeover','fixedModel','fixedCandidateId','pool','prices','budget']) assert.deepEqual(final.config[key], initial.config[key], key);
  assert.deepEqual((await rpc('session', 'modelCatalog')).default, nativeDefault);
  const finalCounts = await counts();
  assert.equal(finalCounts.requests.length, final.tasks.reduce((sum, task) => sum + task.calls.filter(call => call.dispatchStarted).length, 0));
  assert.equal(final.tasks.reduce((sum, task) => sum + task.ledger.tokens.total, 0), finalCounts.requests.length * 8);
  assert.equal(finalCounts.realModelRequests, 0);
  await save(label + '-desktop-evidence.json', { passed: true, version: packageIdentity.version, initial, final,
    nativeDefault, counts: finalCounts, observations, imageAssetHash: imageHash,
    presetUsagePerStream: 8, productionVisionQualityVerified: false, productionBillingVerified: false,
    preservation: await preserveExistingEvidence(), realModelRequests: 0 });
  console.log(JSON.stringify({ stage, passed: true, scenarios: observations.length,
    tasks: final.tasks.length, controlledStreams: finalCounts.requests.length, realModelRequests: 0 }));
}
