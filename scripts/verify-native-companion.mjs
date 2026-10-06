import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const PROVIDER = 'router-t08-native-companion';
const [logPath, evidencePath, phase = 'execute', priorEvidencePath] = process.argv.slice(2);
assert(logPath && evidencePath, 'Launch log and evidence paths are required');
const log = await readFile(logPath, 'utf8');
const launchUrl = (log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s"<>]+/g) ?? []).at(-1);
assert(launchUrl, 'Owned localhost endpoint missing');
const launch = new URL(launchUrl);
const exchanged = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
const cookie = exchanged.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
assert(cookie, 'Browser session cookie missing');
async function rpc(endpoint, args = {}) {
  const rpcId = randomUUID();
  const response = await fetch(`${launch.origin}/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie, Origin: launch.origin }, body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }), signal: AbortSignal.timeout(60000) });
  assert(response.ok, `${endpoint} did not return HTTP success`);
  const envelope = await response.json();
  assert.equal(envelope.rpcId, rpcId);
  assert(envelope.result?.ok, `${endpoint} failed`);
  return envelope.result.value;
}
const refreshed = await rpc('router/refreshConnections');
const candidate = refreshed.models.find(model => model.provider === PROVIDER && model.model === 'controlled-native');
async function runTask(text) {
  const created = await rpc('session/create', { request: { cwd: process.cwd() } });
  await rpc('session/prompt', { request: { sessionId: created.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } });
  for (let attempt = 0; attempt < 120; attempt++) {
    const state = await rpc('router/snapshot');
    const task = state.tasks.find(item => item.sessionId === created.sessionId && ['completed', 'paused'].includes(item.lifecycle));
    if (task) return { task, sessionId: created.sessionId };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Task did not reach a terminal state');
}
async function restoreConfig(before) {
  for (const model of before.models) {
    const current = (await rpc('router/snapshot')).models.find(item => item.candidateId === model.candidateId);
    if (model.inPool) await rpc('router/setModelEnabled', { candidateId: model.candidateId, enabled: model.enabled });
    else if (current?.inPool) await rpc('router/removeModel', { candidateId: model.candidateId });
  }
  const fixed = before.config.fixedCandidateId ?? before.config.fixedModel ?? null;
  if (fixed === null || before.models.some(model => model.candidateId === fixed && model.enabled && model.available)) await rpc('router/setFixedModel', { candidateId: fixed });
  await rpc('router/setAutomatic', { automatic: before.config.automatic });
}

const before = await rpc('router/snapshot');
let evidence;
let restoreTarget = before;
let completed = false;
let restored = false;
try {
  if (phase === 'removed') {
    assert(candidate && !candidate.available, 'Removed companion must remain as an unavailable tombstone');
    assert(priorEvidencePath, 'Removed phase needs the execute-phase evidence path');
    const prior = JSON.parse(await readFile(priorEvidencePath, 'utf8'));
    restoreTarget = { config: prior.priorConfig, models: prior.priorModelStates };
    assert.equal(before.config.automatic, true);
    assert.equal(before.config.fixedCandidateId, candidate.candidateId);
    const { task } = await runTask('Reply REMOVED_MUST_NOT_RUN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.calls.length, 0);
    assert(['CONNECTION_REMOVED', 'FIXED_MODEL_UNAVAILABLE'].includes(task.pauseReason));
    await restoreConfig(restoreTarget);
    restored = true;
    const defaultAfter = (await rpc('session/modelCatalog')).default;
    assert.deepEqual(defaultAfter, prior.defaultBefore, 'Native default changed across companion lifecycle');
    const history = (await rpc('router/snapshot')).tasks.map(item => item.id);
    assert(history.includes(prior.taskId), 'Executed companion task history was not retained');
    evidence = { phase, candidateId: candidate.candidateId, authEpoch: candidate.authEpoch, available: candidate.available, provider: candidate.provider, blockedTask: { id: task.id, lifecycle: task.lifecycle, pauseReason: task.pauseReason, callCount: task.calls.length }, priorTaskRetained: true, defaultBefore: prior.defaultBefore, defaultAfter, configRestored: true };
  } else {
    assert(candidate, 'Native companion was not discovered');
    assert.equal(candidate.ownership, 'native-reference');
    assert.equal(candidate.enabled, false);
    await rpc('router/setAutomatic', { automatic: false });
    await rpc('router/setFixedModel', { candidateId: null });
    const defaultBefore = (await rpc('session/modelCatalog')).default;
    const preEnable = await runTask('Reply PRE_ENABLE_CONTROL');
    assert(preEnable.task.calls.every(call => call.selection.provider !== PROVIDER), 'A disabled native candidate received a call');
    await rpc('router/setModelEnabled', { candidateId: candidate.candidateId, enabled: true });
    await rpc('router/setFixedModel', { candidateId: candidate.candidateId });
    await rpc('router/setAutomatic', { automatic: true });
    const { task } = await runTask('Reply NATIVE_COMPANION_OK');
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.result, 'NATIVE_COMPANION_OK');
    const execution = task.calls.find(call => call.purpose === 'execution');
    assert(execution, 'Execution call missing');
    assert.equal(execution.candidateId, candidate.candidateId);
    assert.equal(execution.selection.provider, PROVIDER);
    assert.equal(execution.selection.model, 'controlled-native');
    assert.equal(execution.usage.totalTokens, 8);
    assert.equal(execution.quoteVersion, null);
    assert.equal(execution.dispatchIntent, 'possible');
    assert.equal(execution.dispatchStarted, true);
    assert.equal(task.ledger.tokens.total, task.calls.reduce((sum, call) => sum + call.usage.totalTokens, 0));
    evidence = { phase, candidateId: candidate.candidateId, authEpoch: candidate.authEpoch, disabledCandidateCalls: 0, taskId: task.id, result: task.result, selection: execution.selection, usage: execution.usage, quoteVersion: execution.quoteVersion, dispatchIntent: execution.dispatchIntent, dispatchStarted: execution.dispatchStarted, ledger: task.ledger, defaultBefore, priorConfig: before.config, priorModelStates: before.models.map(model => ({ candidateId: model.candidateId, enabled: model.enabled, inPool: model.inPool, available: model.available })), configRestored: false, restoreAfter: 'removed phase' };
  }
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  completed = true;
} finally {
  if ((phase === 'removed' && !restored) || (phase !== 'removed' && !completed)) await restoreConfig(restoreTarget);
}
