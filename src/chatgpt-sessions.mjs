import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { randomUUID } from 'node:crypto';
import { AuthorizationError } from '@deepseek-ai/dsh-authorization';
import {
  CHATGPT_CREDENTIAL_KEY, CHATGPT_DIRECT_SCOPE, CHATGPT_RESOURCE,
  chatGptAccountId, chatGptGrantFromRecord, chatGptJsonRequest, describeChatGptGrant,
  fetchChatGptCatalog, normalizeChatGptEndpoints, validateChatGptIdToken,
} from './chatgpt-oauth.mjs';

const TERMINAL_REFRESH_ERRORS = new Set([
  'INVALID_GRANT', 'INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_INVALIDATED', 'REFRESH_TOKEN_REUSED',
]);
const error = code => new AuthorizationError('ChatGPT session is unavailable', code);
const PROCESS_INSTANCE = randomUUID();
function ownerAlive(owner, now) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || !Number.isFinite(owner.deadline)
    || owner.deadline <= now || (owner.pid === process.pid && owner.instance !== PROCESS_INSTANCE)) return false;
  try { process.kill(owner.pid, 0); return true; } catch (cause) { return cause.code !== 'ESRCH'; }
}
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
  #volatileCleanupAlert = null;
  constructor({ credentials, transport, endpoints, hostId, now = Date.now, timeoutMs = 25_000 }) {
    this.#credentials = credentials;
    this.#transport = transport;
    this.#endpoints = normalizeChatGptEndpoints(endpoints);
    this.#hostId = hostId;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
  }
  read(registration) { return this.#credentials.readRecord(chatGptSessionKey(registration)); }
  #controlKey() { return credentialKey('irishwei-dsh-router', `chatgpt-control-${this.#hostId.slice(9)}`); }
  #control(record) {
    if (!record) return { schemaVersion: 1, hostId: this.#hostId, epoch: randomUUID(), attempts: {}, revocations: {} };
    if (record.kind !== 'grant' || record.payload?.schemaVersion !== 1 || record.payload.hostId !== this.#hostId
      || typeof record.payload.epoch !== 'string' || !record.payload.attempts || !record.payload.revocations) throw error('OAUTH_CONTROL_INVALID');
    return structuredClone(record.payload);
  }
  async beginAuthorization(registration) {
    await this.recoverSignOut();
    let epoch;
    await this.#credentials.modifyRecord(this.#controlKey(), current => {
      const control = this.#control(current);
      if (control.signingOut) throw error('AUTHORIZATION_IN_PROGRESS');
      epoch = control.epoch = randomUUID();
      control.attempts[epoch] = { accountId: registration?.accountId ?? null, revocationFor: [],
        owner: { pid: process.pid, instance: PROCESS_INSTANCE, deadline: this.#now() + 10 * 60_000 + this.#timeoutMs } };
      return { kind: 'grant', payload: control };
    });
    return epoch;
  }
  async cancelAuthorization() {
    await this.#credentials.modifyRecord(this.#controlKey(), current => ({ kind: 'grant', payload: { ...this.#control(current), epoch: randomUUID() } }));
  }
  async authorizationIsCurrent(epoch) {
    let valid = false;
    await this.#credentials.modifyRecord(this.#controlKey(), current => {
      const control = this.#control(current);
      valid = control.epoch === epoch && Boolean(control.attempts[epoch]) && !control.signingOut;
      return undefined;
    });
    return valid;
  }
  async finishAuthorization(epoch, cleanupFailure) {
    if (cleanupFailure) this.#volatileCleanupAlert = { status: 'unconfirmed', failureCode: cleanupFailure.code,
      ...(cleanupFailure.localCleared === false ? { localCleared: false, remoteStatus: cleanupFailure.remoteStatus } : {}) };
    await this.#credentials.modifyRecord(this.#controlKey(), current => {
      const control = this.#control(current);
      const attempt = control.attempts[epoch];
      if (cleanupFailure) {
        for (const accountId of new Set([cleanupFailure.accountId, ...(attempt?.revocationFor ?? [])].filter(Boolean))) {
          control.revocations[accountId] = this.#volatileCleanupAlert;
        }
        control.cleanupAlert = this.#volatileCleanupAlert;
      }
      delete control.attempts[epoch];
      return { kind: 'grant', payload: control };
    });
  }
  async commitAuthorization(registration, record, epoch, signal) {
    await this.#credentials.modifyRecord(chatGptSessionKey(registration), async () => {
        // LocalCredentialProvider reconciles the entire document under its
        // cross-process lock before entering this callback. Reads do not nest locks.
        const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
        if (signal.aborted || control.epoch !== epoch || !control.attempts[epoch] || control.signingOut) {
          throw error('OAUTH_CANCELLED');
        }
        return { kind: 'grant', payload: { ...record.payload, authorizationId: epoch } };
    });
  }
  async cleanupReceived(registration, exchanged, epoch, { skipIfCleared = false } = {}) {
    let cleanupFailure;
    let attempted = false;
    let revocation;
    const revoke = async target => {
      attempted = true;
      revocation = { status: 'confirmed' };
      try { await this.#revoke(target); }
      catch (cause) {
        revocation = { status: 'unconfirmed', failureCode: cause.code ?? 'CHATGPT_REVOCATION_FAILED' };
        cleanupFailure = { accountId: exchanged.accountId ?? registration.accountId, code: revocation.failureCode };
      }
    };
    try {
      await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
        const grant = chatGptGrantFromRecord(current);
        if (skipIfCleared && !grant && current?.payload?.revocation) return undefined;
        const ownsCommitted = grant?.authorizationId === epoch;
        await revoke(ownsCommitted ? grant : exchanged);
        return ownsCommitted ? clearedRecord({ ...registration, accountId: chatGptAccountId(grant.issuedClientId, grant.subject), issuedClientId: grant.issuedClientId }, this.#hostId, 'signed-out', { revocation }) : undefined;
      });
    } catch {
      // A failed credential store cannot prevent cleanup of the grant already
      // received in memory. Never repeat an HTTP revocation that was attempted.
      if (!attempted) await revoke(exchanged);
      cleanupFailure = { accountId: exchanged.accountId ?? registration.accountId,
        code: cleanupFailure?.code ?? 'OAUTH_LOCAL_CLEANUP_UNCONFIRMED', localCleared: false, remoteStatus: revocation.status };
    }
    if (cleanupFailure) await this.finishAuthorization(epoch, cleanupFailure);
  }
  async discardAuthorization(registration, epoch, fallbackGrant) {
    return this.cleanupReceived(registration, { ...fallbackGrant, accountId: registration.accountId }, epoch, { skipIfCleared: true });
  }
  async signOutRegistration(registration) {
    await this.recoverSignOut();
    const slots = new Map([[chatGptSessionKey(registration), registration]]);
    const operationId = randomUUID();
    await this.#credentials.modifyRecord(this.#controlKey(), async current => {
      const control = this.#control(current);
      if (control.signingOut) throw error('AUTHORIZATION_IN_PROGRESS');
      control.epoch = randomUUID();
      for (const attempt of Object.values(control.attempts)) {
        if (!attempt.accountId || attempt.accountId === registration.accountId) attempt.revocationFor.push(registration.accountId);
      }
      for (const { key } of await this.#credentials.listRecords()) {
        const match = /^irishwei-dsh-router\/chatgpt-oauth(?:-([0-9a-f-]{36}))?$/u.exec(key);
        if (!match) continue;
        const stored = await this.#credentials.readRecord(key);
        if (stored?.payload?.hostId !== this.#hostId) continue;
        const description = describeChatGptGrant(stored);
        if (description.accountId === registration.accountId) slots.set(key, { ...registration, credentialId: match[1] ?? 'legacy' });
      }
      control.signingOut = { operationId, accountId: registration.accountId, slots: [...slots.values()],
        owner: { pid: process.pid, instance: PROCESS_INSTANCE, deadline: this.#now() + this.#timeoutMs * (slots.size + 1) } };
      return { kind: 'grant', payload: control };
    });
    let outcome = { status: 'confirmed' };
    try {
      for (const slot of slots.values()) {
        const result = await this.signOut(slot, { operationId });
        if (result.status !== 'confirmed') outcome = result;
      }
    } catch (cause) {
      outcome = { status: 'unconfirmed', failureCode: cause.code ?? 'CHATGPT_REVOCATION_FAILED' };
      throw cause;
    } finally {
      await this.#credentials.modifyRecord(this.#controlKey(), current => {
        const control = this.#control(current);
        if (control.signingOut?.operationId !== operationId) return undefined;
        delete control.signingOut;
        if (control.revocations[registration.accountId]?.status !== 'unconfirmed') control.revocations[registration.accountId] = outcome;
        return { kind: 'grant', payload: control };
      });
    }
  }
  async revocation(registration, fallback) {
    if (this.#volatileCleanupAlert) return structuredClone(this.#volatileCleanupAlert);
    const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
    let outcome = (registration ? control.revocations[registration.accountId] : null) ?? fallback;
    if (registration && Object.values(control.attempts).some(attempt => attempt.revocationFor.includes(registration.accountId))) outcome = { status: 'unconfirmed', failureCode: 'AUTHORIZATION_CLEANUP_PENDING' };
    if (control.cleanupAlert) outcome = control.cleanupAlert;
    return outcome;
  }
  async recoverSignOut() {
    let pending;
    const recoveryId = randomUUID();
    await this.#credentials.modifyRecord(this.#controlKey(), current => {
      const control = this.#control(current);
      let changed = false;
      for (const [epoch, attempt] of Object.entries(control.attempts)) {
        if (ownerAlive(attempt.owner, this.#now())) continue;
        control.cleanupAlert = { status: 'unconfirmed', failureCode: 'OAUTH_ATTEMPT_INTERRUPTED' };
        for (const accountId of new Set([attempt.accountId, ...attempt.revocationFor].filter(Boolean))) control.revocations[accountId] = { status: 'unconfirmed', failureCode: 'OAUTH_ATTEMPT_INTERRUPTED' };
        delete control.attempts[epoch];
        changed = true;
      }
      if (control.signingOut && !ownerAlive(control.signingOut.owner, this.#now())) {
        pending = { ...control.signingOut, operationId: recoveryId,
          owner: { pid: process.pid, instance: PROCESS_INSTANCE, deadline: this.#now() + this.#timeoutMs } };
        control.signingOut = pending;
        changed = true;
      }
      return changed ? { kind: 'grant', payload: control } : undefined;
    });
    if (!pending) return;
    const revocation = { status: 'unconfirmed', failureCode: 'CHATGPT_SIGN_OUT_INTERRUPTED' };
    for (const registration of pending.slots) {
      await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
        const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
        if (control.signingOut?.operationId !== recoveryId) return undefined;
        if (current?.payload?.hostId !== this.#hostId) return undefined;
        const description = describeChatGptGrant(current);
        if (description.accountId !== pending.accountId) return undefined;
        return clearedRecord(registration, this.#hostId, 'signed-out', { revocation });
      });
    }
    await this.#credentials.modifyRecord(this.#controlKey(), current => {
      const control = this.#control(current);
      if (control.signingOut?.operationId !== pending.operationId) return undefined;
      delete control.signingOut;
      control.revocations[pending.accountId] = revocation;
      return { kind: 'grant', payload: control };
    });
  }
  async #assertAllowed(registration) {
    const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
    if (control.signingOut?.accountId === registration.accountId) throw error('CHATGPT_SIGN_OUT_PENDING');
  }
  async isSigningOut(registration) {
    const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
    return control.signingOut?.accountId === registration.accountId;
  }
  async ensure(registration, { refreshCatalog = false, signal } = {}) {
    signal?.throwIfAborted();
    let failure;
    const quarantine = (cause, grant) => {
      failure = cause;
      if (terminalIdentityError(cause.code)) return clearedRecord(registration, this.#hostId, 'reauthorization-required', { failureCode: cause.code });
      return { kind: 'grant', payload: { ...grant, catalog: { status: 'error', models: [], failureCode: cause.code ?? 'OIDC_DISCOVERY_FAILED' } } };
    };
    await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      await this.#assertAllowed(registration);
      let grant = chatGptGrantFromRecord(current);
      if (!grant) { failure = error(current?.payload?.failureCode ?? 'CHATGPT_SIGNED_OUT'); return undefined; }
      checkIdentity(grant, registration, this.#hostId);
      const pendingValidation = grant.validation?.status === 'pending';
      // An unvalidated replacement is already durable. Validate it before using
      // even its refresh token; a later response omitting id_token cannot clear isolation.
      if (pendingValidation) {
        try { grant = await this.#validate(grant, this.#now() + this.#timeoutMs); }
        catch (cause) { return quarantine(cause, grant); }
      }
      const expired = Date.parse(grant.savedAt) + grant.expiresIn * 1000 <= this.#now();
      if (!expired) return pendingValidation ? { kind: 'grant', payload: { ...grant, catalog: { status: 'pending', models: [] } } } : undefined;
      const deadline = this.#now() + this.#timeoutMs;
      // Rotation belongs to the session, not to one waiting Task's cancellation.
      // Persist a received replacement before any identity/catalog network work.
      try {
        const replacement = await this.#refresh(grant, deadline);
        return { kind: 'grant', payload: { ...replacement, catalog: { status: 'pending', models: [] } } };
      } catch (cause) {
        if (!TERMINAL_REFRESH_ERRORS.has(cause.code) && cause.code !== 'CHATGPT_REFRESH_RESPONSE_INVALID') throw cause;
        failure = cause;
        return clearedRecord(registration, this.#hostId, 'reauthorization-required', { failureCode: cause.code });
      }
    });
    signal?.throwIfAborted();
    if (failure) throw failure;
    // Re-read under a new lock. Another process may have validated the replacement
    // or signed out between phases; never write back the first phase's snapshot.
    const record = await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      await this.#assertAllowed(registration);
      let grant = chatGptGrantFromRecord(current);
      if (!grant) { failure = error(current?.payload?.failureCode ?? 'CHATGPT_SIGNED_OUT'); return undefined; }
      checkIdentity(grant, registration, this.#hostId);
      if (Date.parse(grant.savedAt) + grant.expiresIn * 1000 <= this.#now()) throw error('TOKEN_EXPIRED');
      const pendingValidation = grant.validation?.status === 'pending';
      if (!pendingValidation && !refreshCatalog && grant.catalog?.status !== 'pending') return undefined;
      const deadline = this.#now() + this.#timeoutMs;
      if (grant.validation?.status === 'pending') {
        try { grant = await this.#validate(grant, deadline); }
        catch (cause) { return quarantine(cause, grant); }
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
  async #validate(grant, deadline) {
    const identity = await validateChatGptIdToken({ token: grant.idToken, issuedClientId: grant.issuedClientId,
      transport: this.#transport, endpoints: this.#endpoints, deadline, now: this.#now });
    if (identity.issuer !== grant.issuer || identity.subject !== grant.subject) throw error('OAUTH_ACCOUNT_MISMATCH');
    const { validation: _validation, ...validated } = grant;
    return validated;
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
      ...(token.id_token === undefined && previous.validation?.status !== 'pending' ? {} : { validation: { status: 'pending' } }),
      ...(token.earliest_refresh_at === undefined ? {} : { earliestRefreshAt: token.earliest_refresh_at }),
    };
  }
  async signOut(registration, { operationId } = {}) {
    let outcome;
    await this.#credentials.modifyRecord(chatGptSessionKey(registration), async current => {
      if (operationId) {
        const control = this.#control(await this.#credentials.readRecord(this.#controlKey()));
        if (control.signingOut?.operationId !== operationId) { outcome = { status: 'unconfirmed', failureCode: 'CHATGPT_SIGN_OUT_INTERRUPTED' }; return undefined; }
      }
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
