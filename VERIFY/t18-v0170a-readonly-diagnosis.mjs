import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const home = directory + '/t18-v0170a-controlled-home';
const stateBytes = await readFile(home + '/router/desktop/state.json');
const state = JSON.parse(stateBytes);
const countsBytes = await readFile(home + '/t18-controlled-counts.json');
const counts = JSON.parse(countsBytes);
const tasks = Array.isArray(state.tasks) ? state.tasks : Object.values(state.tasks ?? {});
const summary = {
  readonly: true, realModelRequests: counts.realModelRequests, stateKeys: Object.keys(state),
  tasks: tasks.map(task => ({ id: task.id, sessionId: task.sessionId, lifecycle: task.lifecycle,
    nativeLifecycle: task.nativeLifecycle, pauseReason: task.pauseReason, ledger: task.ledger,
    recovery: task.recovery, calls: task.calls.map(call => ({ id: call.id, purpose: call.purpose,
      state: call.status, dispatched: call.dispatchStarted, usage: call.usage, failure: call.failure,
      usageState: call.usageState, reservation: call.reservation, snapshot: call.snapshot })) })),
  requests: counts.requests.map(request => ({ model: request.model, purpose: request.purpose, mode: request.mode,
    attempt: request.attempt, nativeAgentLoop: request.nativeAgentLoop, maxTokens: request.maxTokens })),
  seams: counts.nativeSeams.map(seam => ({ nativeAgentLoop: seam.nativeAgentLoop, model: seam.model, maxTokens: seam.nativeInput.maxTokens })),
  toolBodies: counts.toolExecutions.length,
  stateSha256: createHash('sha256').update(stateBytes).digest('hex'),
};
assert.equal(counts.realModelRequests, 0);
assert.deepEqual(await readFile(home + '/router/desktop/state.json'), stateBytes);
assert.deepEqual(await readFile(home + '/t18-controlled-counts.json'), countsBytes);
await writeFile(directory + '/implement-spec-go-20261009/t18-v0170a-readonly-diagnosis.json', JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
