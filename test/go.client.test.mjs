import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { mountSettings, taskState } from './client-harness.mjs';

test('installed Go settings use native RPC codecs, clear key input and show only sanitized errors', async () => {
  const state = { ...taskState(), openCodeGo: { configured: false, connected: false, accountId: null, model: 'gpt-6-luna', detectionClaimed: false, lastDetectionTaskId: null } };
  const key = 'controlled-private-client-key'; let submitted;
  const mounted = await mountSettings(state, async (_path, endpoint, payload) => {
    if (endpoint === 'router/openCodeGoSaveCredential') { submitted = payload.args.request.apiKey; return { ok: false, error: { message: key, code: 'INVALID_CREDENTIAL' } }; }
    assert.equal(endpoint, 'router/snapshot'); return { ok: true, value: state };
  });
  try {
    const button = label => mounted.page.root.findAllByType('button').find(node => node.children.includes(label));
    await act(async () => { await button('OpenCode Go').props.onClick(); });
    const field = mounted.page.root.findAllByType('input').find(node => node.props['aria-label'] === 'Go API key');
    assert.equal(field.props.type, 'password');
    await act(async () => { field.props.onChange({ target: { value: key } }); });
    assert(!JSON.stringify(mounted.page.toJSON()).includes(key));
    await act(async () => { await button('保存 Go 密钥').props.onClick(); });
    assert.equal(submitted, key); assert(!JSON.stringify(mounted.page.toJSON()).includes(key));
    assert.equal(mounted.page.root.findAllByType('p').find(node => node.props.role === 'alert').children[0], '操作未完成；请检查连接状态。密钥不会显示在错误详情中。');
    submitted = undefined;
    await act(async () => { await button('保存 Go 密钥').props.onClick(); });
    assert.equal(submitted, ''); // The credential is cleared even when the save fails.
    assert.equal(button('运行有界 Go 检测').props.disabled, true);
    assert.equal(mounted.diagnostics.length, 0);
  } finally { await mounted.dispose(); }
});

test('Go waiting detection offers stop without a generic budget extension entry', async () => {
  const task = { id: 'go-waiting', lifecycle: 'waiting-budget', configVersion: 1, result: '', timeline: [], openCodeGoDetection: { maxCalls: 2 }, budget: { limits: { tokens: 1, durationMs: 1000, money: [] }, extensions: [], waiting: { proposedTokens: 2000, blockedBy: [] } } };
  const mounted = await mountSettings({ ...taskState(), tasks: [task] });
  try {
    await act(async () => { await mounted.page.root.findAllByType('button').find(node => node.children.includes('任务记录')).props.onClick(); });
    const labels = mounted.page.root.findAllByType('button').map(node => node.children.join(''));
    assert(labels.includes('停止任务 go-waiting')); assert(!labels.includes('扩展任务预算 go-waiting'));
    assert.equal(mounted.diagnostics.length, 0);
  } finally { await mounted.dispose(); }
});
