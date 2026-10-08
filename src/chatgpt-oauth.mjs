import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { AuthorizationError } from '@deepseek-ai/dsh-authorization';

export const CHATGPT_CREDENTIAL_KEY = credentialKey('irishwei-dsh-router', 'chatgpt-oauth');
export const CHATGPT_DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const REQUESTED_SCOPES = `openid profile email offline_access resource.invoke ${CHATGPT_DIRECT_SCOPE}`;
const PRODUCTION_ENDPOINTS = Object.freeze({
  kind: 'official',
  authorizationURL: 'https://auth.openai.com/api/accounts/authorize',
  tokenURL: 'https://auth.openai.com/api/accounts/oauth/token',
  discoveryURL: 'https://auth.openai.com/.well-known/openid-configuration',
  modelsURL: 'https://api.openai.com/v1/models',
});

const oauthError = (code, message = 'ChatGPT authorization failed') => new AuthorizationError(message, code);
const requiredString = (value, code) => {
  if (typeof value !== 'string' || value.length === 0) throw oauthError(code);
  return value;
};
const safeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const loopbackURL = value => {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('controlled ChatGPT endpoint is invalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.hash) throw new TypeError('controlled ChatGPT endpoints must use 127.0.0.1 HTTP');
  return url.href;
};

export function normalizeChatGptEndpoints(value) {
  if (value === undefined || value?.kind === 'official') return PRODUCTION_ENDPOINTS;
  if (value?.kind !== 'controlled-test') throw new TypeError('ChatGPT endpoints must be official or controlled-test');
  return Object.freeze({
    kind: 'controlled-test',
    authorizationURL: loopbackURL(value.authorizationURL),
    tokenURL: loopbackURL(value.tokenURL),
    discoveryURL: loopbackURL(value.discoveryURL),
    modelsURL: loopbackURL(value.modelsURL),
  });
}

const transportOptions = (endpoints, options) => endpoints.kind === 'controlled-test'
  ? { ...options, authorizeAddress: ({ address }) => address === '127.0.0.1' && isIP(address) === 4 }
  : options;

async function readBody(response) {
  const chunks = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function chatGptJsonRequest(transport, endpoints, url, options, failureCode) {
  let response;
  try {
    response = await transport.request(new URL(url), transportOptions(endpoints, options));
    const text = await readBody(response);
    let payload;
    try { payload = JSON.parse(text); } catch { throw oauthError(`${failureCode}_INVALID_JSON`); }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const returned = typeof payload?.error === 'string' && /^[a-z0-9_.-]{1,100}$/u.test(payload.error) ? payload.error : null;
      throw oauthError(returned ? returned.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, '_') : `${failureCode}_HTTP_${response.statusCode}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw oauthError(error?.code === 'CANCELED' ? 'OAUTH_CANCELLED' : error?.code === 'SOURCE_TIMEOUT' ? 'OAUTH_TIMEOUT' : failureCode);
  } finally {
    response?.close?.();
  }
}
const jsonRequest = chatGptJsonRequest;

function parseJwt(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts.some(part => !part)) throw oauthError('ID_TOKEN_MALFORMED');
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      input: Buffer.from(`${parts[0]}.${parts[1]}`),
      signature: Buffer.from(parts[2], 'base64url'),
    };
  } catch { throw oauthError('ID_TOKEN_MALFORMED'); }
}

export async function validateChatGptIdToken({ token, issuedClientId, nonce, transport, endpoints, deadline, signal, now }) {
  const parsed = parseJwt(token);
  if (parsed.header?.alg !== 'RS256' || typeof parsed.header?.kid !== 'string' || !parsed.header.kid) throw oauthError('ID_TOKEN_ALGORITHM_INVALID');
  const common = { method: 'GET', headers: { accept: 'application/json' }, body: Buffer.alloc(0), deadline, signal, maxUploadBytes: 0, maxResponseBytes: 256 * 1024 };
  const discovery = await jsonRequest(transport, endpoints, endpoints.discoveryURL, common, 'OIDC_DISCOVERY_FAILED');
  const expectedIssuer = endpoints.kind === 'official' ? 'https://auth.openai.com' : new URL(endpoints.discoveryURL).origin;
  if (discovery?.issuer !== expectedIssuer) throw oauthError('OIDC_ISSUER_INVALID');
  let jwksURL;
  try { jwksURL = new URL(discovery.jwks_uri); } catch { throw oauthError('OIDC_JWKS_URI_INVALID'); }
  if (endpoints.kind === 'official') {
    if (jwksURL.protocol !== 'https:' || jwksURL.origin !== 'https://auth.openai.com' || jwksURL.username || jwksURL.password || jwksURL.hash) throw oauthError('OIDC_JWKS_URI_INVALID');
  } else if (jwksURL.origin !== new URL(endpoints.discoveryURL).origin || jwksURL.protocol !== 'http:') throw oauthError('OIDC_JWKS_URI_INVALID');
  const jwks = await jsonRequest(transport, endpoints, jwksURL, common, 'OIDC_JWKS_FAILED');
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find(key => key?.kid === parsed.header.kid && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig')) : undefined;
  if (!jwk) throw oauthError('ID_TOKEN_KEY_UNKNOWN');
  let verified = false;
  try { verified = verify('RSA-SHA256', parsed.input, createPublicKey({ key: jwk, format: 'jwk' }), parsed.signature); } catch { /* invalid public key */ }
  if (!verified) throw oauthError('ID_TOKEN_SIGNATURE_INVALID');
  const claims = parsed.claims;
  if (claims?.iss !== discovery.issuer) throw oauthError('ID_TOKEN_ISSUER_INVALID');
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (!audience.includes(issuedClientId)) throw oauthError('ID_TOKEN_AUDIENCE_INVALID');
  const nowSeconds = Math.floor(now() / 1000);
  if (!Number.isSafeInteger(claims?.exp) || claims.exp <= nowSeconds) throw oauthError('ID_TOKEN_EXPIRED');
  if (nonce !== undefined && !safeEqual(claims?.nonce, nonce)) throw oauthError('ID_TOKEN_NONCE_INVALID');
  const subject = requiredString(claims?.sub, 'ID_TOKEN_SUBJECT_INVALID');
  const email = typeof claims?.email === 'string' && claims.email ? claims.email : undefined;
  return { issuer: claims.iss, subject, ...(email ? { email } : {}) };
}

function validateCatalog(payload) {
  if (!Array.isArray(payload?.models)) throw oauthError('MODEL_CATALOG_INVALID');
  const seen = new Set();
  const models = [];
  for (const item of payload.models) {
    if (item?.visibility !== 'list') continue;
    if (typeof item.slug !== 'string' || !item.slug || item.slug.length > 200 || typeof item.display_name !== 'string' || !item.display_name || item.display_name.length > 300 || seen.has(item.slug)) throw oauthError('MODEL_CATALOG_INVALID');
    seen.add(item.slug);
    models.push({ slug: item.slug, displayName: item.display_name });
  }
  return models;
}

export async function fetchChatGptCatalog({ accessToken, transport, endpoints, deadline, signal }) {
  try {
    const payload = await jsonRequest(transport, endpoints, endpoints.modelsURL, {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` }, body: Buffer.alloc(0), deadline, signal,
      maxUploadBytes: 0, maxResponseBytes: 2 * 1024 * 1024,
    }, 'MODEL_CATALOG_FAILED');
    return { status: 'listed', models: validateCatalog(payload) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'error', models: [], failureCode: error.code ?? 'MODEL_CATALOG_FAILED' };
  }
}

function callbackListener({ signal, timeoutMs }) {
  const server = createServer();
  let consumed = false;
  let settle;
  const callback = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const close = () => new Promise(resolve => server.close(() => resolve()));
  const safePage = '<!doctype html><meta charset="utf-8"><title>DSH Router</title><p>Authorization response received. You may return to DSH.</p>';
  server.on('request', (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/auth/callback' || request.method !== 'GET') { response.writeHead(404).end(); return; }
    if (consumed) { response.writeHead(410).end(); return; }
    consumed = true;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(safePage);
    settle.resolve(Object.fromEntries(url.searchParams));
    void close();
  });
  const aborted = () => {
    if (consumed) return;
    consumed = true;
    settle.reject(oauthError(signal.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_TIMEOUT'));
    void close();
  };
  signal.addEventListener('abort', aborted, { once: true });
  const timer = setTimeout(aborted, timeoutMs);
  timer.unref?.();
  return {
    callback,
    async start() {
      if (signal.aborted) throw oauthError('OAUTH_CANCELLED');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      return `http://127.0.0.1:${address.port}/auth/callback`;
    },
    async dispose() {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      if (!consumed) { consumed = true; settle.reject(oauthError('OAUTH_CANCELLED')); }
      await close();
    },
  };
}

export function chatGptGrantFromRecord(record) {
  if (record === undefined) return null;
  if (record?.kind === 'grant' && record.payload?.schemaVersion === 2
    && ['signed-out', 'reauthorization-required'].includes(record.payload.status)
    && typeof record.payload.accountId === 'string' && typeof record.payload.issuedClientId === 'string') return null;
  if (record?.kind !== 'grant' || record.payload?.schemaVersion !== 1) throw oauthError('OAUTH_CREDENTIAL_INVALID');
  const grant = record.payload;
  for (const key of ['issuedClientId', 'hostId', 'issuer', 'subject', 'idToken', 'accessToken', 'refreshToken', 'tokenType', 'savedAt']) requiredString(grant[key], 'OAUTH_CREDENTIAL_INVALID');
  if (!Number.isSafeInteger(grant.expiresIn) || grant.expiresIn < 1 || !Number.isFinite(Date.parse(grant.savedAt))) throw oauthError('OAUTH_CREDENTIAL_INVALID');
  if (!Array.isArray(grant.scopes) || grant.scopes.some(scope => typeof scope !== 'string' || !scope)) throw oauthError('OAUTH_CREDENTIAL_INVALID');
  return grant;
}

export const chatGptAccountId = (issuedClientId, subject) => `account-${createHash('sha256').update(`${issuedClientId}\0${subject}`).digest('hex').slice(0, 24)}`;

export function describeChatGptGrant(record) {
  const grant = chatGptGrantFromRecord(record);
  if (!grant) return { configured: false, directUseEnabled: false, issuedClientId: record?.payload?.issuedClientId ?? null, accountId: record?.payload?.accountId ?? null, catalogStatus: 'not-requested', models: [], status: record?.payload?.status ?? 'not-configured', failureCode: record?.payload?.failureCode ?? null, revocation: record?.payload?.revocation ?? null };
  return Object.freeze({
    configured: true,
    directUseEnabled: grant.scopes.includes(CHATGPT_DIRECT_SCOPE),
    issuedClientId: grant.issuedClientId,
    accountId: chatGptAccountId(grant.issuedClientId, grant.subject),
    catalogStatus: grant.catalog?.status ?? 'not-requested',
    models: structuredClone(grant.catalog?.models ?? []),
  });
}

export function createChatGptAuthorizationFlow({
  hostId, credentialKey: key = CHATGPT_CREDENTIAL_KEY, transport, endpoints: endpointInput,
  getExistingGrant = async () => undefined, getRegistration = () => null, afterCommit = async () => {},
  commitGrant = (record, session) => session.commit(record), cleanupGrant = async () => {}, timeoutMs = 5 * 60_000, now = Date.now,
}) {
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(hostId)) throw new TypeError('hostId must be a urn:uuid identifier');
  if (!transport?.request) throw new TypeError('transport.request is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) throw new TypeError('OAuth timeout is invalid');
  const endpoints = normalizeChatGptEndpoints(endpointInput);
  return Object.freeze({
    key,
    label: 'ChatGPT（DSH Router）',
    methods: [{ id: 'oauth', label: 'Continue with ChatGPT' }],
    async run(session) {
      const previousRecord = await getExistingGrant();
      const existing = chatGptGrantFromRecord(previousRecord);
      const registration = getRegistration();
      const returningClientId = existing?.issuedClientId ?? registration?.issuedClientId;
      if (existing && existing.hostId !== hostId) throw oauthError('OAUTH_HOST_ID_MISMATCH');
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const listener = callbackListener({ signal: session.signal, timeoutMs });
      const startedAt = now();
      let exchanged;
      let committed = false;
      try {
        const redirectURI = await listener.start();
        const authorizationURL = new URL(endpoints.authorizationURL);
        authorizationURL.searchParams.set('client_id', returningClientId ?? DYNAMIC_CLIENT_ID);
        if (!returningClientId) authorizationURL.searchParams.set('agent_name_hint', 'DSH Router');
        authorizationURL.searchParams.set('ext_agent_host_id', hostId);
        authorizationURL.searchParams.set('response_type', 'code');
        authorizationURL.searchParams.set('redirect_uri', redirectURI);
        authorizationURL.searchParams.set('scope', REQUESTED_SCOPES);
        authorizationURL.searchParams.set('resource', CHATGPT_RESOURCE);
        authorizationURL.searchParams.set('state', state);
        authorizationURL.searchParams.set('nonce', nonce);
        authorizationURL.searchParams.set('code_challenge_method', 'S256');
        authorizationURL.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
        session.notify({ message: 'Continue in your system browser to authorize ChatGPT.', url: authorizationURL.href });

        const callback = await listener.callback;
        if (!safeEqual(callback.state, state)) throw oauthError('OAUTH_STATE_INVALID');
        if (callback.error === 'access_denied') throw oauthError('OAUTH_ACCESS_DENIED', 'ChatGPT authorization was declined');
        if (callback.error) throw oauthError('OAUTH_PROVIDER_REJECTED');
        const code = requiredString(callback.code, 'OAUTH_CODE_MISSING');
        const issuedClientId = returningClientId ?? requiredString(callback.client_id, 'OAUTH_ISSUED_CLIENT_MISSING');
        if (issuedClientId === DYNAMIC_CLIENT_ID) throw oauthError('OAUTH_ISSUED_CLIENT_INVALID');
        if (returningClientId && callback.client_id && !safeEqual(callback.client_id, returningClientId)) throw oauthError('OAUTH_CLIENT_ID_MISMATCH');
        const deadline = startedAt + timeoutMs;
        const form = new URLSearchParams({
          grant_type: 'authorization_code', client_id: issuedClientId, code, code_verifier: verifier,
          redirect_uri: redirectURI, resource: CHATGPT_RESOURCE,
        }).toString();
        const token = await jsonRequest(transport, endpoints, endpoints.tokenURL, {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: Buffer.from(form), deadline, signal: session.signal,
          maxUploadBytes: 16 * 1024, maxResponseBytes: 1024 * 1024,
        }, 'OAUTH_TOKEN_EXCHANGE_FAILED');
        if (typeof token.refresh_token === 'string' && token.refresh_token) exchanged = { issuedClientId, refreshToken: token.refresh_token };
        const accessToken = requiredString(token.access_token, 'OAUTH_TOKEN_RESPONSE_INVALID');
        const refreshToken = requiredString(token.refresh_token, 'OAUTH_TOKEN_RESPONSE_INVALID');
        const idToken = requiredString(token.id_token, 'OAUTH_TOKEN_RESPONSE_INVALID');
        const tokenType = requiredString(token.token_type, 'OAUTH_TOKEN_RESPONSE_INVALID');
        if (tokenType.toLowerCase() !== 'bearer' || !Number.isSafeInteger(token.expires_in) || token.expires_in < 1) throw oauthError('OAUTH_TOKEN_RESPONSE_INVALID');
        const scopes = [...new Set(requiredString(token.scope, 'OAUTH_TOKEN_RESPONSE_INVALID').split(/\s+/u).filter(Boolean))];
        const identity = await validateChatGptIdToken({ token: idToken, issuedClientId, nonce, transport, endpoints, deadline, signal: session.signal, now });
        if (exchanged) exchanged.accountId = chatGptAccountId(issuedClientId, identity.subject);
        if (existing && !safeEqual(existing.subject, identity.subject)) throw oauthError('OAUTH_ACCOUNT_MISMATCH');
        if (registration && registration.accountId !== chatGptAccountId(issuedClientId, identity.subject)) throw oauthError('OAUTH_ACCOUNT_MISMATCH');
        const catalog = await fetchChatGptCatalog({ accessToken, transport, endpoints, deadline, signal: session.signal });
        const grant = {
          schemaVersion: 1, issuedClientId, hostId, issuer: identity.issuer, subject: identity.subject,
          ...(identity.email ? { email: identity.email } : {}),
          idToken, accessToken, refreshToken, tokenType, expiresIn: token.expires_in,
          ...(typeof token.earliest_refresh_at === 'string' || Number.isFinite(token.earliest_refresh_at) ? { earliestRefreshAt: token.earliest_refresh_at } : {}),
          scopes, savedAt: new Date(now()).toISOString(), authorizedAt: new Date(now()).toISOString(), catalog,
        };
        await commitGrant({ kind: 'grant', payload: grant }, session);
        committed = true;
        const description = describeChatGptGrant({ kind: 'grant', payload: grant });
        await afterCommit({ ...description, previousRecord });
      } catch (cause) {
        if (exchanged && !committed) await cleanupGrant(exchanged);
        throw cause;
      } finally {
        await listener.dispose();
      }
    },
  });
}
