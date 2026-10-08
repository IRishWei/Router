import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { mountSettings, taskState } from './client-harness.mjs';

const chatGptState = () => ({
  ...taskState(),
  application: { status: 'applied', desiredVersion: 1, active: [] },
  candidateSnapshot: { epoch: 1, snapshotEpoch: 1, capturedAt: null, candidates: [], unsupported: [] },
  unsupportedProviders: [],
  deepSeek: { bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] }, lastDetectionTaskId: null },
  chatGpt: {
    hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111',
    servicesAvailable: true,
    account: null,
    connection: null,
    catalog: { status: 'not-requested', models: [] },
    authorization: { status: 'idle' },
    inference: {},
    lastDetectionTaskId: null,
  },
});

test('the Renderer consumes the one-time authorization URL in a synchronously opened browser window', async () => {
  const state = chatGptState();
  const secretURL = 'https://auth.openai.com/api/accounts/authorize?state=state-sensitive&id_token_hint=id-sensitive';
  const carrier = async (_path, endpoint) => {
    if (endpoint === 'router/chatGptStartAuthorization') {
      state.chatGpt.authorization = { status: 'waiting', attemptId: '22222222-2222-4222-8222-222222222222' };
      return { ok: true, value: { attemptId: state.chatGpt.authorization.attemptId, authorizationURL: secretURL } };
    }
    if (endpoint === 'router/snapshot') return { ok: true, value: structuredClone(state) };
    throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
  };
  const mounted = await mountSettings(state, carrier);
  try {
    const button = label => mounted.page.root.findAllByType('button').find(item => item.children.includes(label));
    await act(async () => { button('ChatGPT OAuth').props.onClick(); });
    await act(async () => { await button('Continue with ChatGPT').props.onClick(); });
    assert.equal(mounted.openedUrls.length, 1);
    assert.equal(mounted.openedUrls[0].url, secretURL);
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes('state-sensitive'), false);
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes('id-sensitive'), false);
    assert.deepEqual(mounted.calls.find(call => call.endpoint === 'router/chatGptStartAuthorization').payload.args, {});
  } finally {
    await mounted.dispose();
  }
});

test('a pending browser flow remains cancellable without retaining its URL', async () => {
  const state = chatGptState();
  let cancelled = false;
  const carrier = async (_path, endpoint) => {
    if (endpoint === 'router/chatGptStartAuthorization') { state.chatGpt.authorization = { status: 'waiting', attemptId: '33333333-3333-4333-8333-333333333333' }; return { ok: true, value: { attemptId: state.chatGpt.authorization.attemptId, authorizationURL: 'https://auth.openai.com/api/accounts/authorize?state=blocked-sensitive' } }; }
    if (endpoint === 'router/chatGptCancelAuthorization') { cancelled = true; state.chatGpt.authorization = { status: 'cancelled' }; return { ok: true, value: structuredClone(state) }; }
    if (endpoint === 'router/snapshot') return { ok: true, value: structuredClone(state) };
    throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
  };
  const mounted = await mountSettings(state, carrier);
  try {
    await act(async () => { mounted.page.root.findAllByType('button').find(item => item.children.includes('ChatGPT OAuth')).props.onClick(); });
    await act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes('Continue with ChatGPT')).props.onClick(); });
    const cancel = mounted.page.root.findAllByType('button').find(item => item.children.includes('取消 ChatGPT 授权'));
    assert.ok(cancel);
    await act(async () => { await cancel.props.onClick(); });
    assert.equal(cancelled, true);
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes('blocked-sensitive'), false);
  } finally {
    await mounted.dispose();
  }
});

test('a blocked popup does not start OAuth', async () => {
  const state = chatGptState();
  const mounted = await mountSettings(state, async (_path, endpoint) => {
    if (endpoint === 'router/snapshot') return { ok: true, value: structuredClone(state) };
    throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
  }, { openPopup: () => null });
  try {
    await act(async () => { mounted.page.root.findAllByType('button').find(item => item.children.includes('ChatGPT OAuth')).props.onClick(); });
    await act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes('Continue with ChatGPT')).props.onClick(); });
    assert.equal(mounted.calls.some(call => call.endpoint === 'router/chatGptStartAuthorization'), false);
    assert.match(JSON.stringify(mounted.page.toJSON()), /允许弹出窗口/u);
  } finally { await mounted.dispose(); }
});

test('waiting OAuth completion refreshes account and catalog without another authorization call', async () => {
  const state = chatGptState();
  let snapshots = 0;
  const mounted = await mountSettings(state, async (_path, endpoint) => {
    if (endpoint === 'router/chatGptStartAuthorization') {
      state.chatGpt.authorization = { status: 'waiting', attemptId: '44444444-4444-4444-8444-444444444444' };
      return { ok: true, value: { attemptId: state.chatGpt.authorization.attemptId, authorizationURL: 'https://auth.openai.com/api/accounts/authorize?state=one-time' } };
    }
    if (endpoint === 'router/snapshot') {
      snapshots += 1;
      if (snapshots >= 3) {
        state.chatGpt.authorization = { status: 'authorized', attemptId: '44444444-4444-4444-8444-444444444444' };
        state.chatGpt.account = { accountId: 'account-visible', issuedClientId: 'client-visible', configured: true, directUseEnabled: true };
        state.chatGpt.catalog = { status: 'listed', models: [{ slug: 'gpt-visible', displayName: 'GPT Visible' }] };
      }
      return { ok: true, value: structuredClone(state) };
    }
    throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
  });
  try {
    await act(async () => { mounted.page.root.findAllByType('button').find(item => item.children.includes('ChatGPT OAuth')).props.onClick(); });
    await act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes('Continue with ChatGPT')).props.onClick(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    assert.match(JSON.stringify(mounted.page.toJSON()), /GPT Visible/u);
    assert.equal(mounted.calls.filter(call => call.endpoint === 'router/chatGptStartAuthorization').length, 1);
  } finally { await mounted.dispose(); }
});
