import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay, setImmediate as tick } from 'node:timers/promises';
import test from 'node:test';
import { ChatGptHost } from '../src/chatgpt-host.mjs';
import { chatGptSessionKey } from '../src/chatgpt-sessions.mjs';
import { lifecycleServer, registrationFor, stateFor, credentialsContext } from './t10-harness.mjs';

async function fixture(options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'router-t10-host-'));
  const remote = await lifecycleServer(options);
  const ctx = await credentialsContext(home);
  const record = remote.grant({ hostId: `urn:uuid:${randomUUID()}` });
  const registration = registrationFor(record);
  await ctx.credentials.modifyRecord(chatGptSessionKey(registration), () => record);
  const state = { chatGpt: stateFor(record) };
  const mounts = [];
  const hostOptions = { ...remote, mountConnection: async (_ctx, spec) => { mounts.push(spec); return { disconnect: async () => {} }; } };
  const host = new ChatGptHost(ctx, state, async () => {}, hostOptions);
  await host.initialize();
  return { home, remote, ctx, record, registration, state, hostOptions, host, mounts,
    async close() { await host.dispose(); await ctx.fiber.dispose(); await remote.close(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); },
  };
}
const credentialRequest = spec => ({ provider: spec.provider, accountId: spec.accountId });
async function waitAuthorization(host) {
  for (let index = 0; index < 150; index += 1) {
    const snapshot = await host.snapshot();
    if (snapshot.authorization.status !== 'waiting') return snapshot;
    await delay(20);
  }
  throw new Error('controlled authorization did not settle');
}

test('add, switch, sign out, reauthorize, and restart preserve separate registrations and historical claims', async () => {
  const f = await fixture();
  let restored;
  try {
    const generationA = f.mounts.at(-1);
    const first = await f.host.startAuthorization({ newAccount: true });
    assert.equal(new URL(first.authorizationURL).searchParams.get('client_id'), 'dynamic_agent_client');
    await f.remote.authorize(first.authorizationURL, { client: 'oaiapp-b', subject: 'subject-b', models: [{ slug: 'gpt-b', displayName: 'GPT B' }] });
    let snapshot = await waitAuthorization(f.host);
    assert.equal(snapshot.authorization.status, 'authorized');
    assert.equal(snapshot.registrations.length, 2);
    const registrationB = f.state.chatGpt.registrations.find(item => item.accountId !== f.registration.accountId);
    assert.equal(snapshot.account.accountId, registrationB.accountId);
    assert.equal(snapshot.catalog.models[0].slug, 'gpt-b');
    assert.equal((await f.ctx.credentials.readRecord(chatGptSessionKey(f.registration))).payload.refreshToken, f.record.payload.refreshToken);
    await assert.rejects(generationA.getAuthorizedCredential(credentialRequest(generationA)), cause => cause.code === 'AUTHORIZATION_CHANGED');
    await f.host.selectAccount({ accountId: f.registration.accountId });
    snapshot = await f.host.snapshot();
    assert.equal(snapshot.catalog.models[0].slug, 'gpt-lifecycle');
    assert.equal(snapshot.account.accountId, f.registration.accountId);
    await f.host.selectAccount({ accountId: registrationB.accountId });
    await f.host.signOut();
    snapshot = await f.host.snapshot();
    assert.equal(snapshot.connection, null);
    assert.equal(snapshot.lifecycle.revocation.status, 'confirmed');
    assert.equal(snapshot.account.configured, false);
    assert.equal(snapshot.registrations.find(item => item.accountId === f.registration.accountId).configured, true);
    const returning = await f.host.startAuthorization();
    const returningURL = new URL(returning.authorizationURL);
    assert.equal(returningURL.searchParams.get('client_id'), 'oaiapp-b');
    assert.equal(returningURL.searchParams.get('ext_agent_host_id'), f.record.payload.hostId);
    assert.equal(returningURL.searchParams.has('id_token_hint'), false);
    assert.equal(returningURL.searchParams.has('login_hint'), false);
    await f.remote.authorize(returning.authorizationURL, { client: 'oaiapp-b', subject: 'subject-b', models: [{ slug: 'gpt-b', displayName: 'GPT B' }] });
    assert.equal((await waitAuthorization(f.host)).authorization.status, 'authorized');
    await f.host.dispose();
    restored = new ChatGptHost(f.ctx, f.state, async () => {}, f.hostOptions);
    await restored.initialize();
    snapshot = await restored.snapshot();
    assert.equal(snapshot.account.accountId, registrationB.accountId);
    assert.equal(snapshot.connection.available, true);
    assert.equal(snapshot.lastDetectionTaskId, 'historical-detection-must-remain');
    assert.equal(snapshot.registrations.length, 2);
    const publicText = JSON.stringify(snapshot);
    for (const secret of ['subject-a', 'subject-b', f.record.payload.accessToken, f.record.payload.refreshToken, f.record.payload.idToken]) assert.equal(publicText.includes(secret), false);
    assert.equal(f.remote.failures.length, 0);
  } finally { await restored?.dispose(); await f.close(); }
});

test('switch during an in-flight refresh saves replacement to the old account and rejects its stale caller', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ onRefresh: async ({ token }) => { enteredResolve(); await gate; return { token }; } });
  try {
    const recordB = f.remote.grant({ hostId: f.record.payload.hostId, client: 'oaiapp-b', subject: 'subject-b' });
    const registrationB = registrationFor(recordB, randomUUID(), 'ChatGPT 2');
    f.state.chatGpt.registrations.push(registrationB);
    await f.ctx.credentials.modifyRecord(chatGptSessionKey(registrationB), () => recordB);
    await f.ctx.credentials.modifyRecord(chatGptSessionKey(f.registration), current => ({ ...current, payload: { ...current.payload, savedAt: '2000-01-01T00:00:00Z' } }));
    const staleSpec = f.mounts.at(-1);
    const pending = assert.rejects(staleSpec.getAuthorizedCredential(credentialRequest(staleSpec)), cause => cause.code === 'AUTHORIZATION_CHANGED');
    await entered;
    const switching = f.host.selectAccount({ accountId: registrationB.accountId });
    await tick();
    assert.equal(f.state.chatGpt.account.accountId, registrationB.accountId);
    release();
    await Promise.all([pending, switching]);
    const rotatedA = await f.ctx.credentials.readRecord(chatGptSessionKey(f.registration));
    assert.notEqual(rotatedA.payload.refreshToken, f.record.payload.refreshToken);
    assert.equal(rotatedA.payload.issuedClientId, 'oaiapp-a');
    const selected = f.mounts.at(-1);
    const credential = await selected.getAuthorizedCredential(credentialRequest(selected));
    assert.equal(credential.client_id, 'oaiapp-b');
    assert.equal(credential.access_token, recordB.payload.accessToken);
  } finally { release(); await f.close(); }
});

test('sign-out stops new calls before revocation and revokes the replacement from an in-flight refresh', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ onRefresh: async ({ token }) => { enteredResolve(); await gate; return { token }; } });
  try {
    await f.ctx.credentials.modifyRecord(chatGptSessionKey(f.registration), current => ({ ...current, payload: { ...current.payload, savedAt: '2000-01-01T00:00:00Z' } }));
    const spec = f.mounts.at(-1);
    const pending = assert.rejects(spec.getAuthorizedCredential(credentialRequest(spec)), cause => cause.code === 'AUTHORIZATION_CHANGED');
    await entered;
    const signOut = f.host.signOut();
    await tick();
    await assert.rejects(spec.getAuthorizedCredential(credentialRequest(spec)), cause => cause.code === 'AUTHORIZATION_CHANGED');
    release();
    await Promise.all([pending, signOut]);
    const revoke = f.remote.requests.find(item => item.path === '/revoke');
    assert.notEqual(revoke.form.get('token'), f.record.payload.refreshToken);
    assert.equal((await f.host.snapshot()).lifecycle.revocation.status, 'confirmed');
  } finally { release(); await f.close(); }
});

test('state-write failure after OAuth cannot roll credentials back; restart recovers the saved registration', async () => {
  const f = await fixture();
  let recovering;
  try {
    await f.host.dispose();
    const original = structuredClone(f.state);
    let fail = false;
    const candidate = new ChatGptHost(f.ctx, f.state, async () => { if (fail) throw new Error('controlled state write failure'); }, f.hostOptions);
    await candidate.initialize();
    const attempt = await candidate.startAuthorization({ newAccount: true });
    fail = true;
    await f.remote.authorize(attempt.authorizationURL, { client: 'oaiapp-b', subject: 'subject-b' });
    assert.equal((await waitAuthorization(candidate)).authorization.status, 'failed');
    const registration = f.state.chatGpt.registrations.find(item => item.accountId !== f.registration.accountId);
    assert.equal((await f.ctx.credentials.readRecord(chatGptSessionKey(registration))).payload.issuedClientId, 'oaiapp-b');
    await candidate.dispose();
    recovering = new ChatGptHost(f.ctx, original, async () => {}, f.hostOptions);
    await recovering.initialize();
    assert.equal((await recovering.snapshot()).registrations.length, 2);
    assert.equal((await recovering.snapshot()).account.accountId, f.registration.accountId);
  } finally { await recovering?.dispose(); await f.close(); }
});

test('OAuth already committing behind the credential lock cannot reactivate a signed-out account', async () => {
  const f = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let queuedResolve;
  const queued = new Promise(resolve => { queuedResolve = resolve; });
  const modify = f.ctx.credentials.modifyRecord.bind(f.ctx.credentials);
  try {
    const attempt = await f.host.startAuthorization();
    const held = modify(chatGptSessionKey(f.registration), async () => { await gate; return undefined; });
    f.ctx.credentials.modifyRecord = (key, mutate) => { queuedResolve(); return modify(key, mutate); };
    await f.remote.authorize(attempt.authorizationURL);
    await queued;
    const signingOut = f.host.signOut();
    await tick();
    assert.equal(f.state.chatGpt.connection, null);
    release();
    await Promise.all([held, signingOut]);
    await waitAuthorization(f.host);
    const snapshot = await f.host.snapshot();
    assert.equal(snapshot.account.configured, false);
    assert.equal(snapshot.connection, null);
    await f.host.dispose(); // A cancelled public authorization can finish cleanup after begin() settles.
    const revoked = f.remote.requests.filter(item => item.path === '/revoke');
    assert.ok(revoked.some(item => item.form.get('token') !== f.record.payload.refreshToken));
    assert.ok(revoked.some(item => item.form.get('token') === f.record.payload.refreshToken));
    assert.equal((await f.host.snapshot()).lifecycle.revocation.status, 'confirmed');
  } finally { release(); f.ctx.credentials.modifyRecord = modify; await f.close(); }
});

test('adding an already registered account retains the new committed slot without copying or retaining its old tokens', async () => {
  const f = await fixture();
  try {
    const attempt = await f.host.startAuthorization({ newAccount: true });
    await f.remote.authorize(attempt.authorizationURL);
    const snapshot = await waitAuthorization(f.host);
    assert.equal(snapshot.authorization.status, 'authorized');
    assert.equal(snapshot.registrations.length, 1);
    const selected = f.state.chatGpt.registrations[0];
    assert.notEqual(selected.credentialId, 'legacy');
    assert.equal((await f.ctx.credentials.readRecord(chatGptSessionKey(f.registration))).payload.accessToken, undefined);
    assert.notEqual((await f.ctx.credentials.readRecord(chatGptSessionKey(selected))).payload.refreshToken, f.record.payload.refreshToken);
    await f.host.signOut();
    assert.equal((await f.host.snapshot()).account.configured, false);
  } finally { await f.close(); }
});

for (const cleanupStatus of [200, 503]) {
  test(`duplicate account OAuth queued at sign-out revokes its rejected new token and reports cleanup HTTP ${cleanupStatus}`, async () => {
    const f = await fixture({ onRevoke: entry => ({ status: entry.form.get('token') === 'refresh-fixture-1' ? 200 : cleanupStatus }) });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let queuedResolve;
    const queued = new Promise(resolve => { queuedResolve = resolve; });
    const modify = f.ctx.credentials.modifyRecord.bind(f.ctx.credentials);
    try {
      const attempt = await f.host.startAuthorization({ newAccount: true });
      const held = modify(chatGptSessionKey(f.registration), async () => { await gate; return undefined; });
      f.ctx.credentials.modifyRecord = (key, mutate) => { queuedResolve(); return modify(key, mutate); };
      await f.remote.authorize(attempt.authorizationURL);
      await queued;
      const signingOut = f.host.signOut();
      await tick();
      assert.equal(f.state.chatGpt.connection, null);
      release();
      await Promise.all([held, signingOut]);
      await waitAuthorization(f.host);
      await f.host.dispose();
      const snapshot = await f.host.snapshot();
      assert.equal(snapshot.account.configured, false);
      assert.equal(snapshot.connection, null);
      assert.equal(snapshot.lifecycle.revocation.status, cleanupStatus === 200 ? 'confirmed' : 'unconfirmed');
      if (cleanupStatus === 503) assert.equal(snapshot.lifecycle.revocation.failureCode, 'CHATGPT_REVOCATION_HTTP_503');
      const revokes = f.remote.requests.filter(item => item.path === '/revoke');
      assert.equal(revokes.length, 2);
      assert.ok(revokes.some(item => item.form.get('token') !== f.record.payload.refreshToken));
      for (const { key } of await f.ctx.credentials.listRecords()) {
        const record = await f.ctx.credentials.readRecord(key);
        assert.equal(record?.payload?.accessToken, undefined);
        assert.equal(record?.payload?.refreshToken, undefined);
      }
      assert.equal(f.remote.failures.length, 0);
    } finally { release(); f.ctx.credentials.modifyRecord = modify; await f.close(); }
  });
}

test('a second Host signing out during OAuth token exchange prevents the first Host from restoring the account', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ onAuthorization: async () => { enteredResolve(); await gate; } });
  let otherCtx;
  let otherHost;
  try {
    const staleSpec = f.mounts.at(-1);
    const attempt = await f.host.startAuthorization();
    otherCtx = await credentialsContext(f.home);
    otherHost = new ChatGptHost(otherCtx, structuredClone(f.state), async () => {}, f.hostOptions);
    await otherHost.initialize();
    await f.remote.authorize(attempt.authorizationURL);
    await entered;
    await otherHost.signOut();
    const pending = await otherHost.snapshot();
    assert.equal(pending.account.configured, false);
    assert.equal(pending.lifecycle.revocation.status, 'unconfirmed');
    assert.equal(pending.lifecycle.revocation.failureCode, 'AUTHORIZATION_CLEANUP_PENDING');
    release();
    assert.equal((await waitAuthorization(f.host)).authorization.status, 'cancelled');
    await f.host.dispose();
    await assert.rejects(staleSpec.getAuthorizedCredential(credentialRequest(staleSpec)));
    await otherCtx.credentials.modifyRecord(chatGptSessionKey(f.registration), () => undefined);
    const final = await otherHost.snapshot();
    assert.equal(final.account.configured, false);
    assert.equal(final.connection, null);
    assert.equal(final.lifecycle.revocation.status, 'confirmed');
    assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 2);
    assert.equal(f.remote.failures.length, 0);
  } finally { release(); await otherHost?.dispose(); await otherCtx?.fiber.dispose(); await f.close(); }
});

for (const cleanupStatus of [200, 503]) {
  test(`cancellation during ID validation cleans an exchanged grant and exposes cleanup HTTP ${cleanupStatus}`, async () => {
    let enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let discovery = 0;
    const f = await fixture({ discoveryUnavailable: async () => { if (++discovery === 1) { enteredResolve(); await gate; } return false; },
      onRevoke: entry => ({ status: entry.form.get('token') === 'refresh-fixture-1' ? 200 : cleanupStatus }),
    });
    try {
      const attempt = await f.host.startAuthorization({ newAccount: true });
      await f.remote.authorize(attempt.authorizationURL, { client: 'oaiapp-b', subject: 'subject-b' });
      await entered;
      await f.host.signOut();
      release();
      await f.host.dispose();
      const snapshot = await f.host.snapshot();
      assert.equal(snapshot.account.configured, false);
      assert.equal(snapshot.registrations.length, 1);
      assert.equal(snapshot.lifecycle.revocation.status, cleanupStatus === 200 ? 'confirmed' : 'unconfirmed');
      assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 2);
      assert.equal(f.remote.failures.length, 0);
    } finally { release(); await f.close(); }
  });
}

for (const expiredOwner of [false, true]) {
  test(`${expiredOwner ? 'expired' : 'live'} sign-out owner is coordinated across Hosts without erasing a later grant`, async () => {
    const f = await fixture();
    let enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const modify = f.ctx.credentials.modifyRecord.bind(f.ctx.credentials);
    let otherCtx;
    let otherHost;
    try {
      f.ctx.credentials.modifyRecord = async (key, mutate) => {
        if (key === chatGptSessionKey(f.registration)) { enteredResolve(); await gate; }
        return modify(key, mutate);
      };
      const signingOut = f.host.signOut();
      await entered;
      otherCtx = await credentialsContext(f.home);
      if (expiredOwner) {
        const key = (await otherCtx.credentials.listRecords()).find(item => item.key.includes('/chatgpt-control-')).key;
        await otherCtx.credentials.modifyRecord(key, current => ({ ...current, payload: { ...current.payload, signingOut: { ...current.payload.signingOut, owner: { ...current.payload.signingOut.owner, deadline: 0 } } } }));
      }
      otherHost = new ChatGptHost(otherCtx, structuredClone(f.state), async () => {}, f.hostOptions);
      await otherHost.initialize();
      if (expiredOwner) {
        assert.equal((await otherHost.snapshot()).account.configured, false);
        const attempt = await otherHost.startAuthorization();
        await f.remote.authorize(attempt.authorizationURL);
        assert.equal((await waitAuthorization(otherHost)).authorization.status, 'authorized');
      } else {
        assert.equal(Boolean((await otherHost.snapshot()).connection?.available), false);
        await assert.rejects(otherHost.startAuthorization(), cause => cause.code === 'AUTHORIZATION_IN_PROGRESS');
      }
      release();
      await signingOut;
      await otherCtx.credentials.modifyRecord(chatGptSessionKey(f.registration), () => undefined);
      const snapshot = await otherHost.snapshot();
      assert.equal(snapshot.account.configured, expiredOwner);
      if (expiredOwner) {
        assert.equal(snapshot.connection.available, true);
        const selected = f.mounts.at(-1);
        assert.equal((await selected.getAuthorizedCredential(credentialRequest(selected))).client_id, 'oaiapp-a');
        assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 0);
      } else assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 1);
    } finally { release(); f.ctx.credentials.modifyRecord = modify; await otherHost?.dispose(); await otherCtx?.fiber.dispose(); await f.close(); }
  });
}

test('first sign-in cancelled before commit still exposes global revocation failure with no selected account', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let discovery = 0;
  const f = await fixture({ discoveryUnavailable: async () => { if (++discovery === 1) { enteredResolve(); await gate; } return false; }, onRevoke: () => ({ status: 503 }) });
  let host;
  try {
    await f.host.dispose();
    await f.ctx.credentials.deleteRecord(chatGptSessionKey(f.registration));
    const state = {};
    host = new ChatGptHost(f.ctx, state, async () => {}, f.hostOptions);
    await host.initialize();
    const attempt = await host.startAuthorization();
    await f.remote.authorize(attempt.authorizationURL);
    await entered;
    await host.cancelAuthorization();
    release();
    await host.dispose();
    const snapshot = await host.snapshot();
    assert.equal(snapshot.account, null);
    assert.equal(snapshot.registrations.length, 0);
    assert.equal(snapshot.lifecycle.revocation.status, 'unconfirmed');
    assert.equal(snapshot.lifecycle.revocation.failureCode, 'CHATGPT_REVOCATION_HTTP_503');
  } finally { release(); await host?.dispose(); await f.close(); }
});
