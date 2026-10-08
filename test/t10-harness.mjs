import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import { Context } from '@deepseek-ai/cordis';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import { join } from 'node:path';
import { CHATGPT_DIRECT_SCOPE, chatGptAccountId } from '../src/chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';

export async function lifecycleServer(options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'lifecycle', alg: 'RS256', use: 'sig' };
  const tokens = new Map();
  const authorizations = new Map();
  const requests = [];
  const failures = [];
  let serial = 0;
  const jwt = claims => {
    const input = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const makeToken = (client, subject, models, nonce) => {
    const number = ++serial;
    const access_token = `access-fixture-${number}`;
    const refresh_token = `refresh-fixture-${number}`;
    const identity = { client, subject, models };
    tokens.set(access_token, identity);
    tokens.set(refresh_token, identity);
    return { access_token, refresh_token, token_type: 'Bearer', expires_in: 3600,
      scope: `openid offline_access resource.invoke ${CHATGPT_DIRECT_SCOPE}`,
      id_token: jwt({ iss: remote.origin, aud: client, sub: subject, exp: Math.floor(Date.now() / 1000) + 3600, ...(nonce ? { nonce } : {}) }),
    };
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const entry = { path: request.url, headers: request.headers, body, form: new URLSearchParams(body) };
      requests.push(entry);
      response.setHeader('content-type', 'application/json');
      if (request.url === '/discovery') {
        if (await options.discoveryUnavailable?.()) { response.writeHead(503).end('{}'); return; }
        response.end(JSON.stringify({ issuer: remote.origin, jwks_uri: `${remote.origin}/jwks`, revocation_endpoint: options.revocationURL ?? `${remote.origin}/revoke` })); return;
      }
      if (request.url === '/jwks') { response.end(JSON.stringify({ keys: [jwk] })); return; }
      if (request.url === '/token') {
        const form = entry.form;
        if (form.get('grant_type') === 'authorization_code') {
          const auth = authorizations.get(form.get('code'));
          if (!auth || form.get('client_id') !== auth.client) throw new Error('controlled authorization identity mismatch');
          const token = makeToken(auth.client, auth.subject, auth.models, auth.url.searchParams.get('nonce'));
          await options.onAuthorization?.({ ...entry, token });
          response.end(JSON.stringify(token)); return;
        }
        const identity = tokens.get(form.get('refresh_token'));
        if (!identity || identity.client !== form.get('client_id')) throw new Error('controlled refresh identity mismatch');
        const token = makeToken(identity.client, identity.subject, identity.models);
        const result = await options.onRefresh?.({ ...entry, token, identity }) ?? { token };
        response.statusCode = result.status ?? 200;
        response.end(JSON.stringify(result.token ?? result.payload)); return;
      }
      if (request.url === '/models') {
        const identity = tokens.get(request.headers.authorization?.replace(/^Bearer /u, ''));
        if (!identity) throw new Error('controlled model identity mismatch');
        const result = await options.onModels?.({ ...entry, identity }) ?? { models: identity.models };
        response.statusCode = result.status ?? 200;
        response.end(JSON.stringify(result.payload ?? { models: result.models.map(item => ({ slug: item.slug, display_name: item.displayName, visibility: 'list' })) })); return;
      }
      if (request.url === '/revoke') {
        const result = await options.onRevoke?.(entry) ?? { status: 200 };
        response.statusCode = result.status ?? 200; response.end(result.body ?? ''); return;
      }
      if (request.url === '/responses') {
        const result = await options.onResponse?.({ ...entry, input: JSON.parse(body), identity: tokens.get(request.headers.authorization?.replace(/^Bearer /u, '')) });
        response.statusCode = result?.status ?? 200;
        response.setHeader('content-type', result?.status ? 'application/json' : 'text/event-stream');
        response.end(result?.status ? JSON.stringify(result.payload) : result?.events ? result.events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') : textEvents(result?.text ?? 'LIFECYCLE_OK')); return;
      }
      response.writeHead(404).end();
    } catch (cause) { failures.push(cause); response.writeHead(500).end('{}'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const remote = {
    origin: `http://127.0.0.1:${server.address().port}`, requests, failures,
    transport: createSourceNetworkTransport({ lookup, directOnly: true }),
    grant({ hostId, client = 'oaiapp-a', subject = 'subject-a', models = [{ slug: 'gpt-lifecycle', displayName: 'GPT Lifecycle' }], expired = false } = {}) {
      const token = makeToken(client, subject, models);
      return { kind: 'grant', payload: { schemaVersion: 1, issuedClientId: client, subject, hostId, issuer: remote.origin,
        idToken: token.id_token, accessToken: token.access_token, refreshToken: token.refresh_token, tokenType: token.token_type,
        scopes: token.scope.split(' '), expiresIn: token.expires_in, savedAt: new Date(Date.now() - (expired ? 3_700_000 : 0)).toISOString(),
        catalog: { status: 'listed', models },
      } };
    },
    async authorize(authorizationURL, { client = 'oaiapp-a', subject = 'subject-a', models = [{ slug: 'gpt-lifecycle', displayName: 'GPT Lifecycle' }] } = {}) {
      const url = new URL(authorizationURL);
      const code = randomUUID();
      authorizations.set(code, { url, client, subject, models });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', code); callback.searchParams.set('client_id', client);
      await fetch(callback);
    },
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
  remote.endpoints = { kind: 'controlled-test', authorizationURL: `${remote.origin}/authorize`, tokenURL: `${remote.origin}/token`,
    discoveryURL: `${remote.origin}/discovery`, modelsURL: `${remote.origin}/models`, responsesURL: `${remote.origin}/responses` };
  return remote;
}

export const registrationFor = (record, credentialId = 'legacy', label = 'ChatGPT 1') => ({
  accountId: chatGptAccountId(record.payload.issuedClientId, record.payload.subject), issuedClientId: record.payload.issuedClientId,
  configRevision: 1, credentialId, label,
});
export function stateFor(record, registrations = [registrationFor(record)]) {
  const registration = registrations.find(item => item.accountId === chatGptAccountId(record.payload.issuedClientId, record.payload.subject));
  return { hostId: record.payload.hostId, account: { accountId: registration.accountId, issuedClientId: registration.issuedClientId, configRevision: 1 },
    connection: { connectionId: `connection-${randomUUID()}`, accountId: registration.accountId, configRevision: 1 }, registrations,
    inference: {}, lastDetectionTaskId: 'historical-detection-must-remain',
  };
}
export async function credentialsContext(home) {
  const ctx = new Context();
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
  await ctx.plugin(AuthorizationService);
  return ctx;
}
export function textEvents(text) {
  const item = { id: 'msg-lifecycle', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] };
  const events = [
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp-lifecycle', status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
