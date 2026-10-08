import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import {
  CHATGPT_CREDENTIAL_KEY,
  CHATGPT_DIRECT_SCOPE,
  createChatGptAuthorizationFlow,
  describeChatGptGrant,
} from '../src/chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';

const base64url = value => Buffer.from(value).toString('base64url');

function idToken(privateKey, kid, claims, header = { alg: 'RS256', typ: 'JWT' }) {
  const encodedHeader = base64url(JSON.stringify({ ...header, kid }));
  const encodedClaims = base64url(JSON.stringify(claims));
  const input = `${encodedHeader}.${encodedClaims}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function harness({ mutateClaims, tokenScopes, callback = {} } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${randomUUID()}`;
  const jwk = publicKey.export({ format: 'jwk' });
  const seen = [];
  let auth;
  const endpoint = await listen(async (request, response) => {
    const url = new URL(request.url, endpoint.origin);
    const body = [];
    for await (const chunk of request) body.push(chunk);
    seen.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization, body: Buffer.concat(body).toString('utf8') });
    if (url.pathname === '/.well-known/openid-configuration') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ issuer: endpoint.origin, jwks_uri: `${endpoint.origin}/jwks` }));
      return;
    }
    if (url.pathname === '/jwks') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }));
      return;
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(Buffer.concat(body).toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      const claims = mutateClaims?.({ iss: endpoint.origin, aud: 'oaiapp-controlled', exp: now + 300, iat: now, nonce: auth.searchParams.get('nonce'), sub: 'subject-sensitive', email: 'private@example.test' })
        ?? { iss: endpoint.origin, aud: 'oaiapp-controlled', exp: now + 300, iat: now, nonce: auth.searchParams.get('nonce'), sub: 'subject-sensitive', email: 'private@example.test' };
      assert.equal(form.get('client_id'), 'oaiapp-controlled');
      assert.equal(form.get('redirect_uri'), auth.searchParams.get('redirect_uri'));
      assert.equal(form.get('resource'), 'https://api.openai.com/v1');
      assert.ok(form.get('code_verifier'));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        access_token: 'access-sensitive', refresh_token: 'refresh-sensitive', id_token: idToken(privateKey, kid, claims),
        token_type: 'Bearer', expires_in: 3600,
        scope: tokenScopes ?? `openid profile email offline_access resource.invoke ${CHATGPT_DIRECT_SCOPE}`,
      }));
      return;
    }
    if (url.pathname === '/models') {
      assert.equal(request.headers.authorization, 'Bearer access-sensitive');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ models: [
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
        { slug: 'gpt-controlled', display_name: 'GPT Controlled', visibility: 'list' },
      ] }));
      return;
    }
    response.writeHead(404).end();
  });

  const home = await mkdtemp(join(tmpdir(), 'router-t09-oauth-'));
  const ctx = new Context();
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
  await ctx.plugin(AuthorizationService);
  const transport = createSourceNetworkTransport({ lookup, directOnly: true });
  const committed = [];
  const flow = createChatGptAuthorizationFlow({
    hostId: `urn:uuid:${randomUUID()}`,
    credentialKey: CHATGPT_CREDENTIAL_KEY,
    transport,
    timeoutMs: 2_000,
    endpoints: {
      kind: 'controlled-test',
      authorizationURL: `${endpoint.origin}/authorize`,
      tokenURL: `${endpoint.origin}/token`,
      discoveryURL: `${endpoint.origin}/.well-known/openid-configuration`,
      modelsURL: `${endpoint.origin}/models`,
    },
    getExistingGrant: () => ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY),
    afterCommit: value => { committed.push(value); },
  });
  const dispose = ctx.authorization.registerFlow(flow);
  const interaction = {
    notify(notice) {
      auth = new URL(notice.url);
      const callbackURL = new URL(auth.searchParams.get('redirect_uri'));
      callbackURL.searchParams.set('code', callback.code ?? 'authorization-sensitive');
      callbackURL.searchParams.set('state', callback.state ?? auth.searchParams.get('state'));
      if (callback.error) { callbackURL.searchParams.delete('code'); callbackURL.searchParams.set('error', callback.error); }
      callbackURL.searchParams.set('client_id', callback.clientId ?? 'oaiapp-controlled');
      void fetch(callbackURL);
    },
    async prompt() { throw new Error('OAuth flow must not prompt for a pasted secret'); },
  };
  return {
    ctx, endpoint, home, seen, committed,
    begin: signal => ctx.authorization.begin({ key: CHATGPT_CREDENTIAL_KEY, method: 'oauth', interaction, signal }),
    async close() { dispose(); await ctx.fiber.dispose(); await endpoint.close(); await rm(home, { recursive: true, force: true }); },
    get authorizationURL() { return auth; },
  };
}

test('dynamic registration validates the callback and ID token before committing one Host grant', async () => {
  const fixture = await harness();
  try {
    assert.deepEqual(await fixture.begin(), { status: 'authorized' });
    const record = await fixture.ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY);
    const description = describeChatGptGrant(record);
    assert.equal(description.directUseEnabled, true);
    assert.equal(description.issuedClientId, 'oaiapp-controlled');
    assert.match(description.accountId, /^account-[a-f0-9]{24}$/u);
    assert.deepEqual(description.models, [{ slug: 'gpt-controlled', displayName: 'GPT Controlled' }]);
    assert.equal(fixture.authorizationURL.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(fixture.authorizationURL.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'), true);
    assert.equal(fixture.authorizationURL.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(fixture.authorizationURL.searchParams.get('scope').includes(CHATGPT_DIRECT_SCOPE), true);
    const verifier = new URLSearchParams(fixture.seen.find(item => item.path === '/token').body).get('code_verifier');
    assert.equal(fixture.authorizationURL.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
    assert.equal(fixture.seen.filter(item => item.path === '/token').length, 1);
    assert.equal(JSON.stringify({ description, committed: fixture.committed }).includes('access-sensitive'), false);
    assert.equal(JSON.stringify({ description, committed: fixture.committed }).includes('subject-sensitive'), false);
    assert.equal(JSON.stringify({ description, committed: fixture.committed }).includes('private@example.test'), false);
  } finally {
    await fixture.close();
  }
});

test('returning sign-in reuses only the issued client id and puts no credential or account hint in the URL', async () => {
  const fixture = await harness();
  try {
    await fixture.begin();
    await fixture.begin();
    assert.equal(fixture.authorizationURL.searchParams.get('client_id'), 'oaiapp-controlled');
    assert.equal(fixture.authorizationURL.searchParams.has('id_token_hint'), false);
    assert.equal(fixture.authorizationURL.searchParams.has('login_hint'), false);
    assert.equal(fixture.authorizationURL.href.includes('access-sensitive'), false);
    assert.equal(fixture.authorizationURL.href.includes('private@example.test'), false);
  } finally {
    await fixture.close();
  }
});

for (const scenario of [
  ['wrong-state', { callback: { state: 'wrong-state' } }, 'OAUTH_STATE_INVALID'],
  ['wrong-audience', { mutateClaims: claims => ({ ...claims, aud: 'another-client' }) }, 'ID_TOKEN_AUDIENCE_INVALID'],
  ['wrong-nonce', { mutateClaims: claims => ({ ...claims, nonce: 'wrong-nonce' }) }, 'ID_TOKEN_NONCE_INVALID'],
  ['expired', { mutateClaims: claims => ({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }) }, 'ID_TOKEN_EXPIRED'],
]) test(`${scenario[0]} cannot commit an OAuth credential`, async () => {
  const fixture = await harness(scenario[1]);
  try {
    await assert.rejects(fixture.begin(), error => error.code === scenario[2]);
    assert.equal(await fixture.ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY), undefined);
    if (scenario[0] === 'wrong-state') assert.equal(fixture.seen.some(item => item.path === '/token'), false);
  } finally {
    await fixture.close();
  }
});

test('a denied direct-use scope remains signed in but cannot authorize inference', async () => {
  const fixture = await harness({ tokenScopes: 'openid profile email offline_access resource.invoke' });
  try {
    assert.deepEqual(await fixture.begin(), { status: 'authorized' });
    const description = describeChatGptGrant(await fixture.ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY));
    assert.equal(description.directUseEnabled, false);
    assert.deepEqual(description.models, [{ slug: 'gpt-controlled', displayName: 'GPT Controlled' }]);
  } finally {
    await fixture.close();
  }
});

test('cancellation closes the loopback attempt and never commits a credential', async () => {
  const fixture = await harness({ callback: { error: 'access_denied' } });
  try {
    await assert.rejects(fixture.begin(), error => error.code === 'OAUTH_ACCESS_DENIED');
    assert.equal(await fixture.ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY), undefined);
    assert.equal(fixture.seen.some(item => item.path === '/token'), false);
  } finally {
    await fixture.close();
  }
});
