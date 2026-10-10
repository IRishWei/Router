import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const root = 'E:/GPT/Router项目', stage = process.argv[2] ?? 'controlled', label = process.argv[3];
assert(['controlled', 'restart'].includes(stage)); assert(/^t17-v016\d[a-z]$/.test(label));
const { rpc, snapshot, save, initial, owner } = await import(pathToFileURL(`${directory}/${label}-host-rpc.mjs`).href);
const require = createRequire(root + '/package.json');
const client = owner.home + '/profiles/desktop/node_modules/@irishwei/dsh-router/lib/client.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const manifest = JSON.parse(await readFile(`${directory}/${label}-package-identity.json`, 'utf8'));
assert.equal(hash(await readFile(client)), manifest.files.find(entry => entry.file === 'lib/client.js').sha256);
let harness = await readFile(root + '/test/client-harness.mjs', 'utf8');
for (const dependency of ['@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-slots','react','react/jsx-runtime','react-test-renderer']) {
  harness = harness.replace(`from '${dependency}';`, `from '${pathToFileURL(require.resolve(dependency)).href}';`);
}
harness = harness.replace("loadClient('lib/client.js', imports, diagnostics, openedUrls, openPopup)", `loadClient(${JSON.stringify(client)}, imports, diagnostics, openedUrls, openPopup)`);
const { mountSettings } = await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'));
const { act } = require('react-test-renderer');
const recent = initial.tasks.slice(-20).reverse();
const textOf = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node.children.map(textOf).join('');
let verifiedRows = [];
const takeoverRows = [];
const mounted = await mountSettings(initial, async (_path, endpoint, payload) => {
  assert.equal(endpoint, 'router/snapshot');
  return { ok: true, value: await rpc('router', 'snapshot', payload.args) };
});
try {
  const button = mounted.page.root.findAllByType('button').find(node => node.children.includes('任务记录'));
  assert(button);
  await act(async () => { await button.props.onClick(); });
  const deadline = Date.now() + 10000;
  let rows;
  do {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    rows = mounted.page.root.findAllByType('li').map(textOf);
  } while (rows.length !== recent.length && Date.now() < deadline);
  assert.equal(rows.length, recent.length);
  for (const task of recent) {
    const matches = rows.filter(text => text.includes(task.id));
    assert.equal(matches.length, 1, 'Each visible Task must map to its own installed Renderer row');
    const text = matches[0];
    assert(text.includes(task.result || '尚无输出'));
    const verdict = task.acceptance?.verdict ?? 'unconfirmed';
    assert(text.includes(verdict === 'passed' ? '通过' : verdict === 'failed' ? '失败' : '无法确认'));
    for (const requirement of task.acceptance?.image?.requirements ?? []) {
      assert(text.includes(requirement.question ?? requirement.description));
      const image = task.acceptance.image.images.find(image => image.id === requirement.imageId);
      if (image) { assert(text.includes(image.attachment.mediaType)); assert(text.includes(image.hash.slice(0, 12))); }
      const answer = task.acceptance.evidence.find(item => item.requirementId === requirement.id && item.aspect === 'answer-match');
      if (answer?.reason) assert(text.includes(answer.reason));
    }
    const plan = task.takeover?.plan;
    if (plan) {
      const row = mounted.page.root.findAllByType('li').find(node => textOf(node).includes(task.id));
      const paragraphs = row.findAllByType('p').map(textOf);
      for (const [label, identity] of [['接管前执行候选：', plan.source?.identity],
        ['计划接管目标：', plan.target?.identity ?? task.plannedSelection],
        ['最后派发记录：', task.executionOwner?.identity]]) {
        const matches = paragraphs.filter(value => value.startsWith(label));
        assert.equal(matches.length, 1, 'Plan and actual owner need separate exact Task paragraphs');
        if (identity) for (const key of ['provider','model','connectionId','accountId','billingPath']) assert(matches[0].includes(identity[key]));
        else assert(matches[0].includes('尚未确认'));
      }
      assert(text.includes(`尝试 ${task.takeover.attempts} 次`));
      assert(text.includes(plan.episodeId));
      assert(text.includes(`新证据版本 ${plan.evidenceVersion}`));
      if (plan.reason) assert(text.includes(plan.reason));
      const owner = paragraphs.find(value => value.startsWith('最后派发记录：'));
      if (task.executionOwner?.confidence === 'response-observed') assert(owner.includes('已观察到响应'));
      if (task.executionOwner?.confidence === 'possible') assert(owner.includes('可能已派发，尚无响应证据'));
      takeoverRows.push(task.id);
    }
    verifiedRows.push(task.id);
  }
  assert(recent.some(task => task.acceptance?.image?.requirements?.length));
  assert(rows.some(text => text.includes('无法确认')));
  assert.equal(takeoverRows.length, 10);
  assert.equal(mounted.errors.length, 0);
  assert.equal(mounted.diagnostics.length, 0);
} finally { await mounted.dispose(); }
assert.deepEqual(await snapshot(), initial);
await save(`${label}-renderer-evidence.json`, { passed: true, stage, installedClientSha256: hash(await readFile(client)),
  nativeRenderer: true, nativeRpcCodec: true, livePublicRpc: true, imageTaskArtifactsDisplayed: true,
  takeoverPlanningAndObservedOwnerDisplayed: true, takeoverRows,
  storedTasks: initial.tasks.length, recentWindow: 20, verifiedRows, earlyTasksOutsideWindow: initial.tasks.length - recent.length,
  unconfirmedDisplayed: true, snapshotUnchanged: true, visualScreenshotVerified: false, realModelRequests: 0 });
console.log(JSON.stringify({ installedRenderer: true, passed: true, realModelRequests: 0 }));
