import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ChatGptSessions, chatGptSessionKey } from '../src/chatgpt-sessions.mjs';
import { chatGptGrantFromRecord, describeChatGptGrant } from '../src/chatgpt-oauth.mjs';
import { lifecycleServer, registrationFor, credentialsContext } from './t10-harness.mjs';

async function fixture(options) {
  const home = await mkdtemp(join(tmpdir(), 'router-t10-sessions-'));
  const remote = await lifecycleServer(options);
  const ctx = await credentialsContext(home);
  const hostId = `urn:uuid:${randomUUID()}`;
  const record = remote.grant({ hostId, expired: true });
  const registration = registrationFor(record);
  await ctx.credentials.modifyRecord(chatGptSessionKey(registration), () => record);
  const sessions = new ChatGptSessions({ credentials: ctx.credentials, ...remote, hostId });
  return { home, remote, ctx, record, registration, sessions,
    async close() { await ctx.fiber.dispose(); await remote.close(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); },
  };
}

test('concurrent Tasks rotate once, atomically keep replacement, and omit refresh scope', async () => {
  const f = await fixture({ onRefresh: async ({ token }) => { await delay(40); return { token }; } });
  try {
    const grants = await Promise.all(Array.from({ length: 6 }, () => f.sessions.ensure(f.registration)));
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    const request = f.remote.requests.find(item => item.path === '/token');
    assert.equal(request.form.get('client_id'), f.record.payload.issuedClientId);
    assert.equal(request.form.get('refresh_token'), f.record.payload.refreshToken);
    assert.equal(request.form.get('resource'), 'https://api.openai.com/v1');
    assert.equal(request.form.has('scope'), false);
    assert.equal(new Set(grants.map(item => item.refreshToken)).size, 1);
    assert.notEqual(grants[0].refreshToken, f.record.payload.refreshToken);
    assert.equal((await f.sessions.read(f.registration)).payload.refreshToken, grants[0].refreshToken);
    assert.equal(f.remote.failures.length, 0);
  } finally { await f.close(); }
});

test('two real processes share the credential file lock and cannot rotate the same token twice', async () => {
  const f = await fixture({ onRefresh: async ({ token }) => { await delay(100); return { token }; } });
  const children = [];
  try {
    const jobs = Array.from({ length: 2 }, () => {
      const child = fork(new URL('./t10-refresh-child.mjs', import.meta.url), [f.home, f.remote.origin, f.record.payload.hostId], { silent: true });
      children.push(child);
      let readyResolve;
      const ready = new Promise(resolve => { readyResolve = resolve; });
      const result = new Promise((resolve, reject) => {
        child.on('message', message => { if (message.type === 'ready') readyResolve(); else if (message.type === 'result') message.ok ? resolve(message) : reject(new Error(message.code)); });
        child.on('error', reject);
        child.on('exit', code => { if (code) reject(new Error(`refresh child exited ${code}`)); });
      });
      return { ready, result, child };
    });
    await Promise.all(jobs.map(job => job.ready));
    for (const job of jobs) job.child.send('refresh');
    await Promise.all(jobs.map(job => job.result));
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    const restored = await f.sessions.ensure(f.registration);
    assert.notEqual(restored.refreshToken, f.record.payload.refreshToken);
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(child => child.exitCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
    await f.close();
  }
});

test('restart after a process dies waiting for OIDC keeps the durable replacement and never refreshes the consumed token', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let holdDiscovery = true;
  const f = await fixture({ discoveryUnavailable: async () => {
    if (holdDiscovery) { enteredResolve(); await gate; }
    return false;
  } });
  const child = fork(new URL('./t10-refresh-child.mjs', import.meta.url), [f.home, f.remote.origin, f.record.payload.hostId], { silent: true });
  let recoveredContext;
  try {
    await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    child.send('refresh');
    await entered;
    const beforeCrash = await readFile(join(f.home, '.credentials.yaml'), 'utf8');
    assert.equal(beforeCrash.includes(f.record.payload.refreshToken), false);
    assert.match(beforeCrash, /status: pending/u);
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    holdDiscovery = false;
    release();
    recoveredContext = await credentialsContext(f.home);
    const sessions = new ChatGptSessions({ credentials: recoveredContext.credentials, ...f.remote, hostId: f.record.payload.hostId });
    const recovered = await sessions.ensure(f.registration);
    assert.notEqual(recovered.refreshToken, f.record.payload.refreshToken);
    assert.equal(recovered.validation, undefined);
    assert.equal(recovered.catalog.status, 'listed');
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    assert.equal(f.remote.failures.length, 0);
  } finally {
    release();
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    await recoveredContext?.fiber.dispose();
    await f.close();
  }
});

for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) {
  test(`terminal refresh ${code} clears only unusable tokens and retains registration`, async () => {
    const f = await fixture({ onRefresh: () => ({ status: 400, payload: { error: code } }) });
    try {
      await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === code.toUpperCase());
      const record = await f.sessions.read(f.registration);
      assert.equal(chatGptGrantFromRecord(record), null);
      assert.equal(record.payload.accountId, f.registration.accountId);
      assert.equal(record.payload.issuedClientId, f.registration.issuedClientId);
      for (const token of [f.record.payload.accessToken, f.record.payload.refreshToken, f.record.payload.idToken]) assert.equal(JSON.stringify(record).includes(token), false);
      await assert.rejects(f.sessions.ensure(f.registration));
      assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    } finally { await f.close(); }
  });
}

test('temporary refresh failure preserves the grant and does not initiate browser login or retry', async () => {
  const f = await fixture({ onRefresh: () => ({ status: 503, payload: { error: 'temporarily_unavailable' } }) });
  try {
    await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === 'TEMPORARILY_UNAVAILABLE');
    assert.deepEqual(await f.sessions.read(f.registration), f.record);
    assert.deepEqual(f.remote.requests.map(item => item.path), ['/token']);
  } finally { await f.close(); }
});

test('catalog failure after rotation keeps the replacement even when no model can be dispatched', async () => {
  const f = await fixture({ onModels: () => ({ status: 503, payload: { error: 'temporarily_unavailable' } }) });
  try {
    await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === 'TEMPORARILY_UNAVAILABLE');
    const record = await f.sessions.read(f.registration);
    assert.notEqual(record.payload.refreshToken, f.record.payload.refreshToken);
    assert.equal(record.payload.catalog.status, 'error');
    await assert.rejects(f.sessions.ensure(f.registration));
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
  } finally { await f.close(); }
});

test('scope loss is saved with rotated tokens and prevents catalog and inference access', async () => {
  const f = await fixture({ onRefresh: ({ token }) => ({ token: { ...token, scope: 'openid offline_access' } }) });
  try {
    await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === 'CHATGPT_SCOPE_REQUIRED');
    const description = describeChatGptGrant(await f.sessions.read(f.registration));
    assert.equal(description.configured, true);
    assert.equal(description.directUseEnabled, false);
    assert.equal(description.models.length, 0);
    assert.equal(f.remote.requests.some(item => item.path === '/models'), false);
  } finally { await f.close(); }
});

test('OIDC outage after rotation quarantines the replacement and recovery validates it without another refresh', async () => {
  let unavailable = true;
  const f = await fixture({ discoveryUnavailable: () => unavailable });
  try {
    await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === 'OIDC_DISCOVERY_FAILED_INVALID_JSON' || cause.code === 'OIDC_DISCOVERY_FAILED_HTTP_503');
    const pending = await f.sessions.read(f.registration);
    assert.notEqual(pending.payload.refreshToken, f.record.payload.refreshToken);
    assert.equal(pending.payload.validation.status, 'pending');
    assert.equal(pending.payload.catalog.status, 'error');
    unavailable = false;
    const recovered = await f.sessions.ensure(f.registration);
    assert.equal(recovered.refreshToken, pending.payload.refreshToken);
    assert.equal(recovered.validation, undefined);
    assert.equal(recovered.catalog.status, 'listed');
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
  } finally { await f.close(); }
});

test('an expired quarantined identity cannot be cleared by a later refresh omitting id_token', async () => {
  let unavailable = true;
  let refreshes = 0;
  const f = await fixture({ discoveryUnavailable: () => unavailable, onRefresh: ({ token }) => {
    if (++refreshes > 1) { const { id_token: _idToken, ...replacement } = token; return { token: replacement }; }
    const wrongIdentity = f.remote.grant({ hostId: f.record.payload.hostId, subject: 'different-subject-b' });
    return { token: { ...token, id_token: wrongIdentity.payload.idToken } };
  } });
  try {
    await assert.rejects(f.sessions.ensure(f.registration));
    const quarantined = await f.sessions.read(f.registration);
    assert.equal(quarantined.payload.validation.status, 'pending');
    unavailable = false;
    const advanced = new ChatGptSessions({ credentials: f.ctx.credentials, ...f.remote, hostId: f.record.payload.hostId, now: () => Date.now() + 3_700_000 });
    await assert.rejects(advanced.ensure(f.registration), cause => cause.code === 'ID_TOKEN_EXPIRED' || cause.code === 'OAUTH_ACCOUNT_MISMATCH');
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    assert.equal(f.remote.requests.filter(item => item.path === '/discovery').length, 2);
    assert.equal(chatGptGrantFromRecord(await f.sessions.read(f.registration)), null);
  } finally { await f.close(); }
});

test('restart after sign-out dies in revocation clears locally, reports unconfirmed, and releases the authorization gate without retry', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ onRevoke: async () => { enteredResolve(); await gate; return { status: 200 }; } });
  const child = fork(new URL('./t10-signout-child.mjs', import.meta.url), [f.home, f.remote.origin], { silent: true });
  let restored;
  try {
    await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    child.send('sign-out');
    await entered;
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
    release();
    restored = await credentialsContext(f.home);
    const sessions = new ChatGptSessions({ credentials: restored.credentials, ...f.remote, hostId: f.record.payload.hostId });
    await sessions.recoverSignOut();
    await assert.rejects(sessions.ensure(f.registration));
    const record = await sessions.read(f.registration);
    assert.equal(record.payload.accessToken, undefined);
    assert.equal(record.payload.refreshToken, undefined);
    assert.equal(record.payload.revocationAuthorizationId, undefined);
    assert.equal((await sessions.revocation(f.registration, record.payload.revocation)).status, 'unconfirmed');
    const epoch = await sessions.beginAuthorization(f.registration);
    await sessions.finishAuthorization(epoch);
    await sessions.signOutRegistration(f.registration);
    assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 1);
    assert.equal(f.remote.failures.length, 0);
  } finally {
    release();
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    await restored?.fiber.dispose(); await f.close();
  }
});

test('omitted scope/id token retains prior identity and Task cancellation cannot discard a received rotation', async () => {
  const controller = new AbortController();
  const f = await fixture({ onRefresh: ({ token }) => {
    controller.abort();
    const { scope: _scope, id_token: _idToken, ...replacement } = token;
    return { token: replacement };
  } });
  try {
    await assert.rejects(f.sessions.ensure(f.registration, { signal: controller.signal }));
    const record = await f.sessions.read(f.registration);
    assert.notEqual(record.payload.refreshToken, f.record.payload.refreshToken);
    assert.equal(record.payload.idToken, f.record.payload.idToken);
    assert.deepEqual(record.payload.scopes, f.record.payload.scopes);
    await f.sessions.ensure(f.registration);
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
  } finally { await f.close(); }
});

for (const [name, options, status] of [
  ['empty HTTP 200', {}, 'confirmed'],
  ['server failure', { onRevoke: () => ({ status: 503 }) }, 'unconfirmed'],
  ['cross-origin endpoint', { revocationURL: 'https://example.test/steal' }, 'unconfirmed'],
]) {
  test(`sign-out with ${name} clears only this account and reports remote confirmation accurately`, async () => {
    const f = await fixture(options);
    try {
      const other = f.remote.grant({ hostId: f.record.payload.hostId, client: 'oaiapp-b', subject: 'subject-b' });
      const otherRegistration = registrationFor(other, randomUUID(), 'ChatGPT 2');
      await f.ctx.credentials.modifyRecord(chatGptSessionKey(otherRegistration), () => other);
      const outcome = await f.sessions.signOut(f.registration);
      assert.equal(outcome.status, status);
      const cleared = await f.sessions.read(f.registration);
      assert.equal(chatGptGrantFromRecord(cleared), null);
      assert.equal(cleared.payload.revocation.status, status);
      assert.deepEqual(await f.sessions.read(otherRegistration), other);
      const revoke = f.remote.requests.find(item => item.path === '/revoke');
      if (name !== 'cross-origin endpoint') {
        assert.equal(revoke.form.get('token'), f.record.payload.refreshToken);
        assert.equal(revoke.form.get('client_id'), f.registration.issuedClientId);
        assert.equal(revoke.form.get('token_type_hint'), 'refresh_token');
      } else assert.equal(revoke, undefined);
    } finally { await f.close(); }
  });
}

test('a stale upstream revocation cannot clear a later successful rotation', async () => {
  const f = await fixture();
  try {
    await f.sessions.ensure(f.registration);
    assert.equal(await f.sessions.invalidate(f.registration, f.record.payload.accessToken, 'TOKEN_REVOKED'), false);
    const current = await f.sessions.ensure(f.registration);
    assert.equal(await f.sessions.invalidate(f.registration, current.accessToken, 'TOKEN_REVOKED'), true);
    await assert.rejects(f.sessions.ensure(f.registration), cause => cause.code === 'TOKEN_REVOKED');
  } finally { await f.close(); }
});

for (const status of [200, 503]) {
  test(`interrupted exit recovery retains the already attempted generation (HTTP ${status})`, async () => {
    const f = await fixture({ onRevoke: () => ({ status }) });
    try {
      const epoch = await f.sessions.beginAuthorization(f.registration);
      await f.sessions.commitAuthorization(f.registration, f.record, epoch, new AbortController().signal);
      await f.sessions.signOut(f.registration);
      assert.equal((await f.sessions.read(f.registration)).payload.revocationAuthorizationId, epoch);
      const controlKey = `irishwei-dsh-router/chatgpt-control-${f.record.payload.hostId.slice(9)}`;
      await f.ctx.credentials.modifyRecord(controlKey, current => ({ kind: 'grant', payload: { ...current.payload,
        epoch: randomUUID(), signingOut: { operationId: randomUUID(), accountId: f.registration.accountId, slots: [f.registration],
          owner: { pid: process.pid, instance: 'controlled-expired-owner', deadline: Date.now() - 1 } } } }));
      await f.sessions.recoverSignOut();
      const recovered = await f.sessions.read(f.registration);
      assert.equal(recovered.payload.revocationAuthorizationId, epoch);
      assert.equal(recovered.payload.revocation.status, 'unconfirmed');
      await f.sessions.discardAuthorization(f.registration, epoch, {
        issuedClientId: f.record.payload.issuedClientId, refreshToken: f.record.payload.refreshToken,
      });
      assert.equal(f.remote.requests.filter(item => item.path === '/revoke').length, 1);
      assert.equal(f.remote.failures.length, 0);
    } finally { await f.close(); }
  });
}
