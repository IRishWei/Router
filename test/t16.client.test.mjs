import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

test('the real Renderer configures frozen coordination permissions and shows durable episodes', async () => {
  let state = {
    schemaVersion: 1,
    config: {
      automatic: true,
      version: 1,
      routingObjective: 'balanced',
      semanticAssessment: false,
      coordination: { enabled: false, candidateId: null, allowCrossModel: false, allowFixedModel: false, maxTokens: 256, maxAdviceChars: 4096, forecastTokens: 4096 },
      acceptance: { enabled: false, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } },
      budget: { tokens: null, durationMs: null, money: [] },
    },
    storageError: null,
    models: [{
      candidateId: 'advisor', id: 'advisor', name: 'Advisor', provider: 'fixture', model: 'advisor', connectionId: 'connection', accountId: 'account', billingPath: 'fixture',
      enabled: true, available: true, inPool: true, ownership: 'router-owned', routerAuthorization: { status: 'enabled' }, providerAuthorization: { status: 'configured' },
      capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } },
      compatibility: { confidence: 'declared', scope: 'fixture' },
    }],
    tasks: [{
      id: 'task-one', activeSelection: { provider: 'fixture', model: 'main' }, lifecycle: 'completed', result: 'AAAAAAAAAAAAAA', configVersion: 1, timeline: [],
      coordinationPolicy: { enabled: true, candidateId: 'advisor', selectionBasis: 'objective-mismatch' },
      acceptance: { verdict: 'passed', evidence: [] },
      coordination: { version: 1, revision: 5, acceptanceRevision: 3, selfRepair: { used: true }, consultationAttempts: 1, timeline: [], episodes: [{ episodeId: 'episode', blockingKey: 'character-length:failed:evidence', evidenceVersion: 2, status: 'resolved', consultation: { reason: null } }] },
    }],
  };
  const mounted = await mountSettings(state, async (_path, endpoint, payload) => {
    const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
    assert(descriptor, `Unexpected public RPC ${endpoint}`);
    if (descriptor.method === 'setCoordinationPolicy') state = { ...state, config: { ...state.config, coordination: payload.args.policy, version: state.config.version + 1 } };
    else if (descriptor.method !== 'snapshot') throw new Error(`Unexpected RPC ${descriptor.method}`);
    return { ok: true, value: structuredClone(state) };
  });
  try {
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('路由与预算');
    await act(async () => { page.root.findByProps({ 'aria-label': '启用受阻协调' }).props.onChange({ target: { checked: true } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '咨询候选' }).props.onChange({ target: { value: 'advisor' } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '允许跨模型咨询' }).props.onChange({ target: { checked: true } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '允许固定任务咨询' }).props.onChange({ target: { checked: true } }); });
    await click('保存协调设置');
    assert.equal(state.config.coordination.enabled, true);
    assert.equal(state.config.coordination.candidateId, 'advisor');
    assert.equal(state.config.coordination.allowCrossModel, true);
    assert.equal(state.config.coordination.allowFixedModel, true);
    await click('任务记录');
    const rendered = JSON.stringify(page.toJSON());
    assert.match(rendered, /已使用一次自行修正/);
    assert.match(rendered, /咨询 1 次/);
    assert.match(rendered, /character-length:failed:evidence/);
    assert.match(rendered, /任务目标排序不一致/);
    const publicMethods = new Set(descriptors.map(item => item.method));
    assert.equal(publicMethods.has('setCoordinationPolicy'), true);
    assert.equal(publicMethods.has('publishCoordination'), false);
    assert.equal(mounted.errors.length, 0);
  } finally { await mounted.dispose(); }
});
