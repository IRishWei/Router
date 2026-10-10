import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

test('the real Renderer configures independent takeover grants and distinguishes planned targets, response owners, and dispatch uncertainty', async () => {
  const identity = model => ({ provider: 't17-fixture', model, connectionId: 'connection', accountId: 'account', billingPath: 'fixture' });
  const source = { identity: identity('main'), confidence: 'response-observed' };
  const target = { identity: identity('target') };
  const policy = { enabled: false, candidateId: null, allowCrossModel: false, allowFixedModel: false, maxTokens: 512, forecastTokens: 32768 };
  let state = {
    schemaVersion: 1, config: { automatic: true, version: 1, routingObjective: 'balanced', semanticAssessment: false, takeover: policy, budget: { tokens: null, durationMs: null, money: [] } }, storageError: null,
    models: [{ candidateId: 'target', id: 'target', name: 'Target', ...target.identity, enabled: true, available: true, inPool: true, ownership: 'router-owned', capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: true, confidence: 'declared' } }, compatibility: { confidence: 'declared', scope: 'controlled-native-task' } }],
    tasks: [
      { id: 'capacity-refused', activeSelection: target.identity, executionOwner: source, plannedSelection: target.identity, lifecycle: 'paused', result: 'AAAAAAAA', configVersion: 1, timeline: [], acceptance: { verdict: 'failed', evidence: [] }, takeover: { attempts: 1, plan: { source, target, state: 'refused', reason: 'TAKEOVER_CONTEXT_CAPACITY_EXCEEDED', episodeId: 'episode', evidenceVersion: 3, acceptanceVerdict: null } } },
      { id: 'dispatch-unknown', activeSelection: target.identity, executionOwner: { ...target, confidence: 'possible' }, plannedSelection: target.identity, lifecycle: 'paused', result: 'AAAAAAAA', configVersion: 1, timeline: [], acceptance: { verdict: 'failed', evidence: [] }, takeover: { attempts: 1, plan: { source, target, state: 'dispatch-unknown', reason: 'TARGET_RESPONSE_NOT_COMPLETED', episodeId: 'episode', evidenceVersion: 3, acceptanceVerdict: null } } },
    ],
  };
  const mounted = await mountSettings(state, async (_path, endpoint, payload) => {
    const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
    assert(descriptor, `Unexpected RPC ${endpoint}`);
    if (descriptor.method === 'setTakeoverPolicy') state = { ...state, config: { ...state.config, version: state.config.version + 1, takeover: payload.args.policy } };
    else assert.equal(descriptor.method, 'snapshot');
    return { ok: true, value: structuredClone(state) };
  });
  try {
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('路由与预算');
    assert.equal(page.root.findByProps({ 'aria-label': '启用受阻接管' }).props.checked, false);
    assert.equal(page.root.findByProps({ 'aria-label': '允许跨模型接管' }).props.checked, false);
    assert.equal(page.root.findByProps({ 'aria-label': '允许固定任务接管' }).props.checked, false);
    for (const label of ['启用受阻接管', '允许跨模型接管', '允许固定任务接管']) await act(async () => { page.root.findByProps({ 'aria-label': label }).props.onChange({ target: { checked: true } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '接管候选' }).props.onChange({ target: { value: 'target' } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '接管输出 token 上限' }).props.onChange({ target: { value: '128' } }); });
    await click('保存接管设置');
    assert.deepEqual(structuredClone(state.config.takeover), { ...policy, enabled: true, candidateId: 'target', allowCrossModel: true, allowFixedModel: true, maxTokens: 128 });
    assert.equal(mounted.calls.filter(call => call.endpoint === 'router/setTakeoverPolicy').length, 1);
    await click('任务记录');
    const rendered = JSON.stringify(page.toJSON());
    assert.match(rendered, /计划接管目标：t17-fixture\/target/);
    assert.match(rendered, /最后派发记录：t17-fixture\/main/);
    assert.match(rendered, /已观察到响应/);
    assert.match(rendered, /可能已派发，尚无响应证据/);
    assert.match(rendered, /接管取消/);
    assert.match(rendered, /TAKEOVER_CONTEXT_CAPACITY_EXCEEDED/);
    assert.match(rendered, /目标派发未知/);
    assert.equal(new Set(descriptors.map(item => item.method)).has('publishTakeover'), false);
    assert.equal(mounted.errors.length, 0);
  } finally { await mounted.dispose(); }
});
