import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { AuthorizationError } from '@deepseek-ai/dsh-authorization';
import {
  CHATGPT_CREDENTIAL_KEY, CHATGPT_DIRECT_SCOPE, CHATGPT_RESOURCE,
  chatGptAccountId, chatGptGrantFromRecord, chatGptJsonRequest,
  fetchChatGptCatalog, normalizeChatGptEndpoints, validateChatGptIdToken,
} from './chatgpt-oauth.mjs';

const TERMINAL_REFRESH_ERRORS = new Set([
  'INVALID_GRANT', 'INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_INVALIDATED', 'REFRESH_TOKEN_REUSED',
]);
const error = code => new AuthorizationError('ChatGPT session is unavailable', code);
const terminalIdentityError = code => code === 'OAUTH_ACCOUNT_MISMATCH' || code?.startsWith('ID_TOKEN_');
export const chatGptSessionKey = registration => registration.credentialId === 'legacy'
  ? CHATGPT_CREDENTIAL_KEY : credentialKey('irishwei-dsh-router', `chatgpt-oauth-${registration.credentialId}`);

function checkIdentity(grant, registration, hostId) {
  if (grant.hostId !== hostId || grant.issuedClientId !== registration.issuedClientId
    || chatGptAccountId(grant.issuedClientId, grant.subject) !== registration.accountId) throw error('AUTHORIZATION_CHANGED');
}

function clearedRecord(registration, hostId, status, details = {}) {
  return { kind: 'grant', payload: {
    schemaVersion: 2, accountId: registration.accountId, issuedClientId: registration.issuedClientId,
    hostId, status, ...details,
  } };
}

/** Own token rotation under the public CredentialProvider cross-process lock. */
export class ChatGptSessions {
  #credentials;
  #transport;
  #endpoints;
  #hostId;
  #now;
  #timeoutMs;
  constructor({ credentials, transport, endpoints, hostId, now = Date.now, timeoutMs = 25_000 }) {
    this.#credentials = credentials;
    this.#transport = transport;
    this.#endpoints = normalizeChatGptEndpoints(endpoints);
    this.#hostId = hostId;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
  }
  read(registration) { return this.#credentials.readRecord(chatGptSessionKey(registration)); }
  async ensure(registration, { refreshCatalog = false, signal } = {}) {
    signal?.throwIfAborted();
    let failure;
    const record = await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      let grant = chatGptGrantFromRecord(current);
      if (!grant) { failure = error(current?.payload?.failureCode ?? 'CHATGPT_SIGNED_OUT'); return undefined; }
      checkIdentity(grant, registration, this.#hostId);
      const expired = Date.parse(grant.savedAt) + grant.expiresIn * 1000 <= this.#now();
      if (!expired && !refreshCatalog && grant.validation?.status !== 'pending') return undefined;
      const deadline = this.#now() + this.#timeoutMs;
      // Rotation belongs to the session, not to one waiting Task's cancellation.
      // Always finish storing a received replacement before checking that Task again.
      if (expired) {
        try { grant = await this.#refresh(grant, deadline); }
        catch (cause) {
          if (!TERMINAL_REFRESH_ERRORS.has(cause.code) && cause.code !== 'CHATGPT_REFRESH_RESPONSE_INVALID') throw cause;
          failure = cause;
          return clearedRecord(registration, this.#hostId, 'reauthorization-required', { failureCode: cause.code });
        }
      }
      if (grant.validation?.status === 'pending') {
        try {
          const identity = await validateChatGptIdToken({ token: grant.idToken, issuedClientId: grant.issuedClientId,
            transport: this.#transport, endpoints: this.#endpoints, deadline, now: this.#now });
          if (identity.issuer !== grant.issuer || identity.subject !== grant.subject) throw error('OAUTH_ACCOUNT_MISMATCH');
          const { validation: _validation, ...validated } = grant;
          grant = validated;
        } catch (cause) {
          failure = cause;
          if (terminalIdentityError(cause.code)) return clearedRecord(registration, this.#hostId, 'reauthorization-required', { failureCode: cause.code });
          // Discovery/JWKS can fail after the server has already rotated. Keep
          // that replacement quarantined and retry identity validation only.
          return { kind: 'grant', payload: { ...grant, catalog: { status: 'error', models: [], failureCode: cause.code ?? 'OIDC_DISCOVERY_FAILED' } } };
        }
      }
      if (grant.scopes.includes(CHATGPT_DIRECT_SCOPE)) {
        const catalog = await fetchChatGptCatalog({ accessToken: grant.accessToken, transport: this.#transport, endpoints: this.#endpoints, deadline });
        grant = { ...grant, catalog };
      } else grant = { ...grant, catalog: { status: 'not-authorized', models: [] } };
      return { kind: 'grant', payload: grant };
    });
    signal?.throwIfAborted();
    if (failure) throw failure;
    const grant = chatGptGrantFromRecord(record);
    if (!grant) throw error('CHATGPT_SIGNED_OUT');
    checkIdentity(grant, registration, this.#hostId);
    if (!grant.scopes.includes(CHATGPT_DIRECT_SCOPE)) throw error('CHATGPT_SCOPE_REQUIRED');
    if (grant.catalog?.status !== 'listed' || !grant.catalog.models?.length) throw error(grant.catalog?.failureCode ?? 'MODEL_CATALOG_UNAVAILABLE');
    return grant;
  }
  async #refresh(previous, deadline) {
    const form = new URLSearchParams({
      grant_type: 'refresh_token', client_id: previous.issuedClientId,
      refresh_token: previous.refreshToken, resource: CHATGPT_RESOURCE,
    });
    const token = await chatGptJsonRequest(this.#transport, this.#endpoints, this.#endpoints.tokenURL, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: Buffer.from(form.toString()), deadline, maxUploadBytes: 16 * 1024, maxResponseBytes: 1024 * 1024,
    }, 'CHATGPT_REFRESH_FAILED');
    if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token
      || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(token.expires_in) || token.expires_in < 1
      || (token.scope !== undefined && (typeof token.scope !== 'string' || !token.scope))) throw error('CHATGPT_REFRESH_RESPONSE_INVALID');
    const { validation: _validation, ...previousFields } = previous;
    return {
      ...previousFields, accessToken: token.access_token, refreshToken: token.refresh_token,
      idToken: token.id_token ?? previous.idToken, tokenType: token.token_type, expiresIn: token.expires_in,
      scopes: token.scope === undefined ? previous.scopes : [...new Set(token.scope.split(/\s+/u).filter(Boolean))],
      savedAt: new Date(this.#now()).toISOString(),
      authorizedAt: previous.authorizedAt ?? previous.savedAt,
      ...(token.id_token === undefined ? {} : { validation: { status: 'pending' } }),
      ...(token.earliest_refresh_at === undefined ? {} : { earliestRefreshAt: token.earliest_refresh_at }),
    };
  }
  async signOut(registration) {
    let outcome;
    await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      const grant = chatGptGrantFromRecord(current);
      if (!grant) {
        outcome = current?.payload?.revocation ?? { status: 'unconfirmed', failureCode: 'NO_LOCAL_REFRESH_TOKEN' };
      } else {
        checkIdentity(grant, registration, this.#hostId);
        try { await this.#revoke(grant); outcome = { status: 'confirmed' }; }
        catch (cause) { outcome = { status: 'unconfirmed', failureCode: /^[A-Z0-9_]{1,100}$/u.test(cause.code ?? '') ? cause.code : 'CHATGPT_REVOCATION_FAILED' }; }
      }
      return clearedRecord(registration, this.#hostId, 'signed-out', { revocation: outcome });
    });
    return outcome;
  }
  async #revoke(grant) {
    const deadline = this.#now() + this.#timeoutMs;
    const discovery = await chatGptJsonRequest(this.#transport, this.#endpoints, this.#endpoints.discoveryURL, {
      method: 'GET', headers: { accept: 'application/json' }, body: Buffer.alloc(0), deadline,
      maxUploadBytes: 0, maxResponseBytes: 256 * 1024,
    }, 'OIDC_DISCOVERY_FAILED');
    const expectedOrigin = this.#endpoints.kind === 'official' ? 'https://auth.openai.com' : new URL(this.#endpoints.discoveryURL).origin;
    let url;
    try { url = new URL(discovery.revocation_endpoint); } catch { throw error('OIDC_REVOCATION_URI_INVALID'); }
    if (discovery.issuer !== expectedOrigin || url.origin !== expectedOrigin || url.username || url.password || url.hash || url.search) throw error('OIDC_REVOCATION_URI_INVALID');
    const form = new URLSearchParams({ token: grant.refreshToken, token_type_hint: 'refresh_token', client_id: grant.issuedClientId });
    let response;
    try {
      response = await this.#transport.request(url, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: Buffer.from(form.toString()),
        deadline, maxUploadBytes: 16 * 1024, maxResponseBytes: 64 * 1024,
        ...(this.#endpoints.kind === 'controlled-test' ? { authorizeAddress: ({ address }) => address === '127.0.0.1' } : {}),
      });
      for await (const _chunk of response.body) { /* Consume bounded body; revocation success is empty HTTP 200. */ }
      if (response.statusCode !== 200) throw error(`CHATGPT_REVOCATION_HTTP_${response.statusCode}`);
    } finally { response?.close?.(); }
  }
  async invalidate(registration, accessToken, failureCode) {
    let invalidated = false;
    await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      const grant = chatGptGrantFromRecord(current);
      if (!grant || grant.accessToken !== accessToken) return undefined;
      checkIdentity(grant, registration, this.#hostId);
      invalidated = true;
      return clearedRecord(registration, this.#hostId, 'reauthorization-required', { failureCode });
    });
    return invalidated;
  }
}
