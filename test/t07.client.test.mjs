import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { mountSettings, taskState } from './client-harness.mjs';
import { compatibleHost } from './t07-harness.mjs';

test('compatible installed client codecs keep secrets out of React state and surface safe errors', async () => {
  const key = 'controlled-client-compatible-key'; let submitted;
  const state = { ...taskState(), compatible: { entries: [] } };
  const mounted = await mountSettings(state, async (_path, endpoint, payload) => { if (endpoint === 'router/compatibleAdd') { submitted = payload.args.request; return { ok: false, error: { message: key, code: 'INVALID_CREDENTIAL' } }; } assert.equal(endpoint, 'router/snapshot'); return { ok: true, value: state }; });
  try {
    const button = label => mounted.page.root.findAllByType('button').find(node => node.children.includes(label));
    await act(async () => { await button('自定义兼容连接').props.onClick(); });
    const field = mounted.page.root.findAllByType('input').find(node => node.props['aria-label'] === '兼容连接 Key'); assert.equal(field.props.type, 'password');
    await act(async () => { field.props.onChange({ target: { value: key } }); }); assert(!JSON.stringify(mounted.page.toJSON()).includes(key));
    await act(async () => { await button('保存兼容连接').props.onClick(); }); assert.equal(submitted.apiKey, key); assert.equal(submitted.model, 'gpt-6-luna'); assert(!JSON.stringify(mounted.page.toJSON()).includes(key));
    await act(async () => { await button('保存兼容连接').props.onClick(); }); assert.equal(submitted.apiKey, '');
    assert.equal(mounted.diagnostics.length, 0); assert.equal(mounted.errors.length, 0);
  } finally { await mounted.dispose(); }
});
test('compatible candidate prices use strict native quote RPC; detection requires Go balance attestation', async () => {
  const f = await compatibleHost(); const id = f.id; let submitted;
  const state = await f.ctx.router.snapshot(); state.compatible.entries[0].endpoint = 'https://opencode.ai/zen/go/v1'; state.models.find(item => item.source === 'openai-compatible').enabled = true;
  const mounted = await mountSettings(state, async (_path, endpoint, payload) => { if (endpoint === 'router/setPriceQuote') submitted = payload.args; else assert.equal(endpoint, 'router/snapshot'); return { ok: true, value: state }; });
  try {
    const button = label => mounted.page.root.findAllByType('button').find(node => node.children.includes(label));
    await act(async () => { await button('自定义兼容连接').props.onClick(); }); assert.equal(button(`运行有界检测 ${id}`).props.disabled, true);
    for (const [label, value] of [['来源 URL', 'https://provider.example/prices'], ['报价日期', '2026-10-09'], ['每百万普通输入', '0.1'], ['每百万输出', '0.5']]) await act(async () => { mounted.page.root.findAllByType('input').find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); });
    await act(async () => { await button(`保存参考费率 ${id}`).props.onClick(); }); assert.equal(submitted.candidateId, f.candidate.candidateId); assert.equal(submitted.quote.confidence, 'declared'); assert.equal(submitted.quote.reasoning, 'unknown'); assert.equal(submitted.quote.perMillion.input, 0.1);
    assert.equal(mounted.diagnostics.length, 0);
  } finally { await mounted.dispose(); await f.close(); }
});
