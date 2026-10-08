import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import { CHATGPT_CREDENTIAL_KEY, CHATGPT_DIRECT_SCOPE, describeChatGptGrant } from '../src/chatgpt-oauth.mjs';
import { ChatGptHost } from '../src/chatgpt-host.mjs';

const grantRecord = ({ direct = true } = {}) => ({ kind: 'grant', payload: {
  schemaVersion: 1,
  issuedClientId: 'oaiapp-host-controlled',
  hostId: `urn:uuid:${randomUUID()}`,
  issuer: 'https://auth.openai.com',
  subject: 'host-subject-sensitive',
  email: 'host-private@example.test',
  idToken: 'id-sensitive',
  accessToken: 'access-sensitive',
  refreshToken: 'refresh-sensitive',
  tokenType: 'Bearer',
  expiresIn: 3600,
  scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', ...(direct ? [CHATGPT_DIRECT_SCOPE] : [])],
  savedAt: new Date().toISOString(),
  catalog: { status: 'listed', models: [{ slug: 'gpt-host', displayName: 'GPT Host' }] },
} });

async function context() {
  const home = await mkdtemp(join(tmpdir(), 'router-t09-host-'));
  const ctx = new Context();
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
  await ctx.plugin(AuthorizationService);
  return { ctx, home, close: async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); } };
}

test('restart mounts only the matching direct-use grant and keeps every secret out of the public snapshot', async () => {
  const fixture = await context();
  const record = grantRecord();
  const description = describeChatGptGrant(record);
  await fixture.ctx.credentials.modifyRecord(CHATGPT_CREDENTIAL_KEY, () => record);
  const state = { chatGpt: {
    hostId: record.payload.hostId,
    account: { accountId: description.accountId, issuedClientId: description.issuedClientId, configRevision: 1 },
    connection: { connectionId: `connection-${randomUUID()}`, accountId: description.accountId, configRevision: 1 },
    lastDetectionTaskId: null,
    inference: {},
  } };
  const mounted = [];
  const host = new ChatGptHost(fixture.ctx, state, async () => {}, {
    mountConnection: async (_ctx, spec) => {
      mounted.push(spec);
      return { async disconnect() {} };
    },
  });
  try {
    await host.initialize();
    assert.equal(mounted.length, 1);
    assert.deepEqual(await mounted[0].getAuthorizedCredential({ provider: mounted[0].provider, accountId: mounted[0].accountId }), {
      access_token: 'access-sensitive', client_id: 'oaiapp-host-controlled', subject: 'host-subject-sensitive', scopes: record.payload.scopes,
    });
    assert.deepEqual(await mounted[0].getCatalog({ provider: mounted[0].provider, accountId: mounted[0].accountId }), {
      identity: { client_id: 'oaiapp-host-controlled', subject: 'host-subject-sensitive' },
      models: [{ slug: 'gpt-host', display_name: 'GPT Host' }],
    });
    const snapshot = await host.snapshot();
    assert.equal(snapshot.connection.available, true);
    assert.equal(snapshot.catalog.status, 'listed');
    const serialized = JSON.stringify(snapshot);
    for (const secret of ['access-sensitive', 'refresh-sensitive', 'id-sensitive', 'host-subject-sensitive', 'host-private@example.test']) assert.equal(serialized.includes(secret), false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test('disconnect withdraws the provider before a stale prepared generation can read a token', async () => {
  const fixture = await context();
  const record = grantRecord();
  const description = describeChatGptGrant(record);
  await fixture.ctx.credentials.modifyRecord(CHATGPT_CREDENTIAL_KEY, () => record);
  const state = { chatGpt: {
    hostId: record.payload.hostId,
    account: { accountId: description.accountId, issuedClientId: description.issuedClientId, configRevision: 1 },
    connection: { connectionId: `connection-${randomUUID()}`, accountId: description.accountId, configRevision: 1 },
    lastDetectionTaskId: null,
    inference: {},
  } };
  let spec;
  let disconnected = false;
  const host = new ChatGptHost(fixture.ctx, state, async () => {}, {
    mountConnection: async (_ctx, value) => { spec = value; return { async disconnect() { disconnected = true; } }; },
  });
  try {
    await host.initialize();
    await host.disconnect({ deleteCredential: false });
    assert.equal(disconnected, true);
    await assert.rejects(spec.getAuthorizedCredential({ provider: spec.provider, accountId: spec.accountId }), error => error.code === 'AUTHORIZATION_CHANGED');
    assert.equal((await fixture.ctx.credentials.describeRecord(CHATGPT_CREDENTIAL_KEY)).configured, true);
    assert.equal((await host.snapshot()).connection, null);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test('Host state must persist before the authorization flow becomes available', async () => {
  const fixture = await context();
  const state = {};
  const host = new ChatGptHost(fixture.ctx, state, async () => { throw new Error('controlled state failure'); });
  try {
    await assert.rejects(host.initialize(), /controlled state failure/u);
    assert.equal(fixture.ctx.authorization.describe(CHATGPT_CREDENTIAL_KEY), undefined);
    assert.equal((await fixture.ctx.credentials.describeRecord(CHATGPT_CREDENTIAL_KEY)).configured, false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test('a valid identity without the direct-use scope remains disconnected after restart', async () => {
  const fixture = await context();
  const record = grantRecord({ direct: false });
  const description = describeChatGptGrant(record);
  await fixture.ctx.credentials.modifyRecord(CHATGPT_CREDENTIAL_KEY, () => record);
  const state = { chatGpt: {
    hostId: record.payload.hostId,
    account: { accountId: description.accountId, issuedClientId: description.issuedClientId, configRevision: 1 },
    connection: { connectionId: `connection-${randomUUID()}`, accountId: description.accountId, configRevision: 1 },
    lastDetectionTaskId: null,
    inference: {},
  } };
  let mounts = 0;
  const host = new ChatGptHost(fixture.ctx, state, async () => {}, { mountConnection: async () => { mounts += 1; return { async disconnect() {} }; } });
  try {
    await host.initialize();
    assert.equal(mounts, 0);
    const snapshot = await host.snapshot();
    assert.equal(snapshot.account.directUseEnabled, false);
    assert.equal(snapshot.connection.available, false);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
