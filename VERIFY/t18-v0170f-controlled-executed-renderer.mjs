import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const root = 'E:/GPT/Router项目', stage = process.argv[2] ?? 'controlled', label = process.argv[3], live = process.argv.includes('--live');
assert(['controlled', 'restart'].includes(stage)); assert(/^t18-v017\d[a-z]$/.test(label));
assert(!live || stage === 'controlled');
const { rpc, snapshot, save, initial, owner } = await import(pathToFileURL(`${directory}/${label}-host-rpc.mjs`).href);
const require = createRequire(root + '/package.json');
const client = owner.home + '/profiles/desktop/node_modules/@irishwei/dsh-router/lib/client.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const manifest = JSON.parse(await readFile(`${directory}/${label}-package-identity.json`, 'utf8'));
assert.equal(hash(await readFile(client)), manifest.files.find(entry => entry.file === 'lib/client.js').sha256);
let harness = await readFile(root + '/test/client-harness.mjs', 'utf8');
for (const dependency of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime', 'react-test-renderer']) {
  harness = harness.replace(`from '${dependency}';`, `from '${pathToFileURL(require.resolve(dependency)).href}';`);
}
harness = harness.replace("loadClient('lib/client.js', imports, diagnostics, openedUrls, openPopup)", `loadClient(${JSON.stringify(client)}, imports, diagnostics, openedUrls, openPopup)`);
const { mountSettings } = await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'));
const { act } = require('react-test-renderer');
const textOf = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children ?? []).map(textOf).join('');
const mounted = await mountSettings(initial, async (_path, endpoint, payload) => {
  assert(['router/snapshot', ...(live ? ['router/resolveTaskRecovery'] : [])].includes(endpoint));
  return { ok: true, value: await rpc('router', endpoint.slice('router/'.length), payload.args) };
});
const click = async label => {
  const button = mounted.page.root.findAllByType('button').find(node => node.children.includes(label)); assert(button, label);
  await act(async () => { await button.props.onClick(); });
};
const calls = [];
let beforeTask = null, afterTask = null, verifiedRows = [], recoveryRows = [], authorizationRows = [];
try {
  await click('任务记录');
  if (live) {
    const context = JSON.parse(await readFile(`${directory}/${label}-live-renderer-context.json`, 'utf8'));
    beforeTask = initial.tasks.find(task => task.id === context.taskId);
    assert(beforeTask && beforeTask.sessionId === context.sessionId && beforeTask.inputs.some(input => input.requestId === context.requestId));
    assert.equal(beforeTask.recovery.state, 'waiting-user'); assert.equal(beforeTask.recovery.id, context.recoveryId);
    assert.equal(beforeTask.recovery.revision, context.expectedRevision);
    const retry = mounted.page.root.findAllByType('button').find(node => node.children.includes(`重试当前模型 ${beforeTask.id}`));
    const stop = mounted.page.root.findAllByType('button').find(node => node.children.includes(`停止恢复 ${beforeTask.id}`));
    assert(retry && stop && !retry.props.disabled && !stop.props.disabled);
    await click(`停止恢复 ${beforeTask.id}`);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      afterTask = (await snapshot()).tasks.find(task => task.id === beforeTask.id);
      if (afterTask && ['paused', 'stopped'].includes(afterTask.lifecycle) && afterTask.nativeLifecycle
        && afterTask.calls.every(call => call.status !== 'running' && call.reservation.state !== 'reserved')) break;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    }
    assert(afterTask && ['paused', 'stopped'].includes(afterTask.lifecycle) && afterTask.nativeLifecycle);
    await click('刷新任务记录');
    assert.equal(mounted.page.root.findAllByType('button').some(node => node.children.includes(`重试当前模型 ${beforeTask.id}`)), false);
    assert.equal(mounted.page.root.findAllByType('button').some(node => node.children.includes(`停止恢复 ${beforeTask.id}`)), false);
    assert.match(JSON.stringify(mounted.page.toJSON()), /新任务.*不会复活旧任务/);
    const resolves = mounted.calls.filter(call => call.endpoint === 'router/resolveTaskRecovery');
    assert.equal(resolves.length, 1);
    assert.deepEqual(resolves[0].payload.args.request, { taskId: beforeTask.id, recoveryId: context.recoveryId, expectedRevision: context.expectedRevision, action: 'stop' });
    calls.push(...resolves.map(call => ({ endpoint: call.endpoint, payload: call.payload })));
  } else {
    const recent = initial.tasks.slice(-20).reverse();
    const deadline = Date.now() + 10000;
    let nodes;
    do {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
      nodes = mounted.page.root.findAllByType('li');
    } while (nodes.length !== recent.length && Date.now() < deadline);
    assert.equal(nodes.length, recent.length);
    for (const task of recent) {
      const matches = nodes.filter(node => textOf(node).includes(task.id)); assert.equal(matches.length, 1);
      const row = matches[0], text = textOf(row);
      assert(text.includes(task.result || '尚无输出'));
      if (task.recovery) {
        assert(text.includes('故障恢复：')); assert(text.includes(task.recovery.failure.code));
        assert(text.includes(`已用 ${task.recovery.attempts}/2 次`));
        assert(text.includes(`计划等待 ${task.recovery.waitMs}ms`));
        if (task.recovery.failure.status) assert(text.includes(`HTTP ${task.recovery.failure.status}`));
        if (task.recovery.reason) assert(text.includes(task.recovery.reason));
        if (task.nativeLifecycle || ['completed', 'paused', 'stopped'].includes(task.lifecycle)) {
          assert.equal(row.findAllByType('button').some(button => button.children.includes(`重试当前模型 ${task.id}`)), false);
          assert(text.includes('不会复活旧任务'));
        }
        if (task.recovery.category === 'authorization') {
          assert(row.findAllByType('button').some(button => button.children.includes('前往连接设置重新授权')));
          authorizationRows.push(task.id);
        }
        recoveryRows.push(task.id);
      }
      verifiedRows.push(task.id);
    }
    assert(recoveryRows.length > 0); assert(authorizationRows.length > 0);
    assert.deepEqual(await snapshot(), initial);
  }
  assert.equal(mounted.errors.length, 0); assert.equal(mounted.diagnostics.length, 0);
} finally { await mounted.dispose(); }
if (live) {
  await save(`${label}-live-renderer-evidence.json`, { passed: true, stage, installedClientSha256: hash(await readFile(client)),
    nativeRenderer: true, nativeRpcCodec: true, livePublicRpc: true, beforeTask, afterTask, calls,
    liveRecoveryStopDisplayedAndExecuted: true, terminalTaskHasNoResumeControl: true,
    visualScreenshotVerified: false, realModelRequests: 0 });
} else {
  await save(`${label}-${stage === 'restart' ? 'restart-' : ''}renderer-evidence.json`, { passed: true, stage,
    installedClientSha256: hash(await readFile(client)), nativeRenderer: true, nativeRpcCodec: true, livePublicRpc: true,
    storedTasks: initial.tasks.length, recentWindow: 20, verifiedRows, recoveryRows, authorizationRows,
    earlyTasksOutsideWindow: Math.max(0, initial.tasks.length - 20), snapshotUnchanged: true,
    terminalTaskHasNoResumeControl: true, visualScreenshotVerified: false, realModelRequests: 0 });
}
console.log(JSON.stringify({ installedRenderer: true, live, stage, passed: true, realModelRequests: 0 }));
