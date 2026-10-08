import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { mountSettings, taskState } from './client-harness.mjs';

const accountA = 'account-aaaaaaaaaaaaaaaaaaaaaaaa';
const accountB = 'account-bbbbbbbbbbbbbbbbbbbbbbbb';
function state() {
  return { ...taskState(), chatGpt: {
    servicesAvailable: true, hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111',
    account: { accountId: accountA, issuedClientId: 'oaiapp-a', configured: true, directUseEnabled: true },
    connection: { connectionId: 'connection-a', accountId: accountA, available: true },
    registrations: [
      { accountId: accountA, issuedClientId: 'oaiapp-a', label: 'ChatGPT 1', configured: true, selected: true },
      { accountId: accountB, issuedClientId: 'oaiapp-b', label: 'ChatGPT 2', configured: true, selected: false },
    ],
    catalog: { status: 'listed', models: [{ slug: 'gpt-lifecycle', displayName: 'GPT Lifecycle' }] },
    authorization: { status: 'idle' }, lifecycle: { status: 'authorized', failureCode: null, revocation: null },
    inference: {}, lastDetectionTaskId: 'old-claim',
  } };
}

test('Renderer switches by opaque registration ID and reports unconfirmed remote revocation while retaining other accounts', async () => {
  const snapshot = state();
  const mounted = await mountSettings(snapshot, async (_path, endpoint, payload) => {
    if (endpoint === 'router/chatGptSelectAccount') {
      assert.equal(payload.args.request.accountId, accountB);
      snapshot.chatGpt.account = { accountId: accountB, issuedClientId: 'oaiapp-b', configured: true, directUseEnabled: true };
      snapshot.chatGpt.connection = { connectionId: 'connection-b', accountId: accountB, available: true };
    } else if (endpoint === 'router/chatGptSignOut') {
      snapshot.chatGpt.account.configured = false;
      snapshot.chatGpt.connection = null;
      snapshot.chatGpt.lifecycle = { status: 'signed-out', failureCode: null, revocation: { status: 'unconfirmed' } };
    } else if (endpoint !== 'router/snapshot') throw new Error(`unexpected endpoint ${endpoint}`);
    return { ok: true, value: structuredClone(snapshot) };
  });
  try {
    const button = label => mounted.page.root.findAllByType('button').find(item => item.children.includes(label));
    await act(async () => { button('ChatGPT OAuth').props.onClick(); });
    const selector = mounted.page.root.findByProps({ 'aria-label': '当前 ChatGPT 账号' });
    assert.equal(selector.props.value, accountA);
    await act(async () => { await selector.props.onChange({ target: { value: accountB } }); });
    assert.equal(mounted.page.root.findByProps({ 'aria-label': '当前 ChatGPT 账号' }).props.value, accountB);
    await act(async () => { await button('退出当前 ChatGPT 账号').props.onClick(); });
    assert.deepEqual(mounted.calls.find(item => item.endpoint === 'router/chatGptSignOut').payload.args, {});
    const text = JSON.stringify(mounted.page.toJSON());
    assert.match(text, /远端撤销未确认/u);
    assert.match(text, /ChatGPT 1/u);
    assert.match(text, /ChatGPT 2/u);
    assert.equal(mounted.page.root.findAllByType('a').some(item => item.props.href === 'https://chatgpt.com/#settings'), true);
    assert.equal(mounted.calls.some(item => item.endpoint === 'router/chatGptStartAuthorization'), false);
  } finally { await mounted.dispose(); }
});

test('quota pause has an official Usage link and adding an account uses the separate browser flow', async () => {
  const snapshot = state();
  snapshot.chatGpt.connection = null;
  snapshot.chatGpt.lifecycle.failureCode = 'SUBSCRIPTION_SHARING_USAGE_LIMIT_EXCEEDED';
  const url = 'https://auth.openai.com/api/accounts/authorize?state=account-state-sensitive';
  const mounted = await mountSettings(snapshot, async (_path, endpoint) => {
    if (endpoint === 'router/chatGptAddAccount') {
      snapshot.chatGpt.authorization = { status: 'waiting', attemptId: '22222222-2222-4222-8222-222222222222' };
      return { ok: true, value: { attemptId: snapshot.chatGpt.authorization.attemptId, authorizationURL: url } };
    }
    if (endpoint !== 'router/snapshot') throw new Error(`unexpected endpoint ${endpoint}`);
    return { ok: true, value: structuredClone(snapshot) };
  });
  try {
    const button = label => mounted.page.root.findAllByType('button').find(item => item.children.includes(label));
    await act(async () => { button('ChatGPT OAuth').props.onClick(); });
    assert.match(JSON.stringify(mounted.page.toJSON()), /套餐总剩余额度和重置时间未知/u);
    assert.equal(mounted.page.root.findAllByType('a').some(item => item.props.href === 'https://chatgpt.com/settings/usage'), true);
    await act(async () => { await button('添加另一个 ChatGPT 账号').props.onClick(); });
    assert.equal(mounted.openedUrls[0].url, url);
    assert.equal(mounted.page.root.findByProps({ 'aria-label': '当前 ChatGPT 账号' }).props.disabled, true);
    assert.equal(JSON.stringify(mounted.page.toJSON()).includes('account-state-sensitive'), false);
    assert.equal(mounted.calls.some(item => item.endpoint === 'router/chatGptRunDetection'), false);
  } finally { await mounted.dispose(); }
});
