import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { mountSettings, taskState } from './client-harness.mjs';

test('the bundled Renderer exposes DeepSeek setup through the real Remote facade without retaining the key', async () => {
  const secret = 'renderer-controlled-secret';
  const state = {
    ...taskState(),
    application: { status: 'applied', desiredVersion: 1, active: [] },
    candidateSnapshot: { epoch: 1, snapshotEpoch: 1, capturedAt: null, candidates: [], unsupported: [] },
    unsupportedProviders: [],
    deepSeek: { bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] }, lastDetectionTaskId: null },
  };
  const carrier = async (_path, endpoint, payload) => {
    if (endpoint === 'router/deepSeekSaveCredential') {
      assert.equal(payload.args.request.apiKey, secret);
      state.deepSeek.bindings = [{ accountId: 'account-renderer', configured: true, writable: true }];
    } else if (endpoint === 'router/deepSeekDiscoverCatalog') {
      state.deepSeek.catalog = { status: 'listed', models: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }], unrecognizedModelIds: [] };
    } else if (endpoint !== 'router/snapshot') {
      throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
    }
    return { ok: true, value: structuredClone(state) };
  };
  const mounted = await mountSettings(state, carrier);
  try {
    const button = label => mounted.page.root.findAllByType('button').find(item => item.children.includes(label));
    await act(async () => { button('DeepSeek API').props.onClick(); });
    const input = mounted.page.root.findByProps({ 'aria-label': 'DeepSeek API key' });
    await act(async () => { input.props.onChange({ target: { value: secret } }); });
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes(secret), false);
    await act(async () => { await button('保存账号密钥').props.onClick(); });
    assert.match(JSON.stringify(mounted.page.toJSON()), /account-renderer/);
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes(secret), false);
    await act(async () => { await button('获取公开模型目录').props.onClick(); });
    assert.match(JSON.stringify(mounted.page.toJSON()), /DeepSeek V4.1 Flash/);
    assert.deepEqual(mounted.errors, []);
  } finally {
    await mounted.dispose();
  }
});
