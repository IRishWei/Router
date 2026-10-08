import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  createChatGptAuthorizationFlow,
  describeChatGptGrant,
} from './chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from './source-network.mjs';
import { ChatGptSessions, chatGptSessionKey } from './chatgpt-sessions.mjs';

const providerFor = accountId => `router-chatgpt-${accountId}`;
const safeFailureCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/u.test(error.code) ? error.code : 'CHATGPT_AUTHORIZATION_FAILED';
const inferenceKey = identity => createHash('sha256').update(JSON.stringify(identity)).digest('hex');

function inferenceIdentity(account, connection, model) {
  return {
    connectionId: connection.connectionId,
    accountId: account.accountId,
    billingPath: 'chatgpt-subscription',
    provider: providerFor(account.accountId),
    model,
    issuedClientId: account.issuedClientId,
    accountConfigRevision: account.configRevision,
    connectionConfigRevision: connection.configRevision,
  };
}

function normalizeState(value) {
  if (value === undefined) return {
    hostId: `urn:uuid:${randomUUID()}`,
    account: null,
    connection: null,
    lastDetectionTaskId: null,
    inference: {},
    registrations: [],
    failures: {},
  };
  if (!value || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.hostId)) throw new Error('Unsupported ChatGPT Router state');
  const account = value.account;
  if (account !== null && (typeof account?.accountId !== 'string' || !account.accountId.startsWith('account-') || typeof account.issuedClientId !== 'string' || !account.issuedClientId || !Number.isSafeInteger(account.configRevision) || account.configRevision < 1)) throw new Error('Unsupported ChatGPT account state');
  const connection = value.connection;
  if (connection !== null && (!account || typeof connection?.connectionId !== 'string' || !connection.connectionId.startsWith('connection-') || connection.accountId !== account.accountId || !Number.isSafeInteger(connection.configRevision) || connection.configRevision < 1)) throw new Error('Unsupported ChatGPT connection state');
  if (value.lastDetectionTaskId !== null && typeof value.lastDetectionTaskId !== 'string') throw new Error('Unsupported ChatGPT detection state');
  const rawInference = value.inference ?? {};
  if (!rawInference || Array.isArray(rawInference)) throw new Error('Unsupported ChatGPT inference state');
  const inference = {};
  for (const [key, record] of Object.entries(rawInference)) {
    // 0.10.0 keyed these observations only by model slug. Discard them because
    // they cannot prove which account and connection produced the completion.
    if (record?.status === 'verified' && typeof record.verifiedAt === 'string' && record.identity === undefined) continue;
    const identity = record?.identity;
    const valid = record?.status === 'verified' && typeof record.verifiedAt === 'string'
      && identity && ['connectionId', 'accountId', 'billingPath', 'provider', 'model', 'issuedClientId'].every(name => typeof identity[name] === 'string' && identity[name])
      && Number.isSafeInteger(identity.accountConfigRevision) && identity.accountConfigRevision > 0
      && Number.isSafeInteger(identity.connectionConfigRevision) && identity.connectionConfigRevision > 0
      && key === inferenceKey(identity);
    if (!valid) throw new Error('Unsupported ChatGPT inference state');
    inference[key] = structuredClone(record);
  }
  const registrations = value.registrations ?? (account ? [{ ...account, credentialId: 'legacy', label: 'ChatGPT 1' }] : []);
  if (!Array.isArray(registrations) || registrations.some(item => typeof item?.accountId !== 'string' || !item.accountId.startsWith('account-')
    || typeof item.issuedClientId !== 'string' || !item.issuedClientId || !Number.isSafeInteger(item.configRevision) || item.configRevision < 1
    || (item.credentialId !== 'legacy' && !/^[0-9a-f-]{36}$/iu.test(item.credentialId ?? '')) || typeof item.label !== 'string' || !item.label)
    || new Set(registrations.map(item => item.accountId)).size !== registrations.length
    || new Set(registrations.map(item => item.credentialId)).size !== registrations.length) throw new Error('Unsupported ChatGPT registrations');
  const failures = Object.fromEntries(Object.entries(value.failures ?? {}).filter(([, code]) => typeof code === 'string' && /^[A-Z0-9_]{1,100}$/u.test(code)));
  return structuredClone({ hostId: value.hostId, account, connection, lastDetectionTaskId: value.lastDetectionTaskId ?? null, inference, registrations, failures });
}

export class ChatGptHost {
  #ctx;
  #state;
  #changed;
  #transport;
  #endpoints;
  #timeoutMs;
  #mountConnection;
  #mounted = null;
  #disposeFlow = null;
  #attempt = { status: 'idle' };
  #createdState = false;
  #sessions;
  #flowKey = null;
  #operations = Promise.resolve();
  #disposed = false;
  #authorizationEpoch = 0;
  #flowCompletions = new Set();
  constructor(ctx, state, changed, {
    transport = createSourceNetworkTransport({ lookup }),
    endpoints,
    timeoutMs,
    mountConnection,
  } = {}) {
    this.#ctx = ctx;
    this.#state = state;
    this.#changed = changed;
    this.#transport = transport;
    this.#endpoints = endpoints;
    this.#timeoutMs = timeoutMs;
    this.#mountConnection = mountConnection;
    this.#createdState = state.chatGpt === undefined;
    state.chatGpt = normalizeState(state.chatGpt);
  }
  #credentials() {
    const credentials = this.#ctx.get('credentials');
    if (!credentials) throw new TypeError('ChatGPT credentials are unavailable');
    return credentials;
  }
  #authorization() {
    const authorization = this.#ctx.get('authorization');
    if (!authorization) throw new TypeError('ChatGPT authorization service is unavailable');
    return authorization;
  }
  async initialize() {
    const credentials = this.#ctx.get('credentials');
    const authorization = this.#ctx.get('authorization');
    if (!credentials || !authorization) return;
    if (this.#createdState) {
      await this.#changed();
      this.#createdState = false;
    }
    this.#sessions = new ChatGptSessions({ credentials, transport: this.#transport, endpoints: this.#endpoints, hostId: this.#state.chatGpt.hostId });
    await this.#recoverRegistrations();
    await this.restore();
  }
  async #recoverRegistrations() {
    let changed = false;
    for (const { key } of await this.#credentials().listRecords()) {
      const match = /^irishwei-dsh-router\/chatgpt-oauth(?:-([0-9a-f-]{36}))?$/u.exec(key);
      if (!match) continue;
      const record = await this.#credentials().readRecord(key);
      if (record?.payload?.hostId !== this.#state.chatGpt.hostId) continue;
      let description;
      try { description = describeChatGptGrant(record); } catch { continue; }
      if (!description.accountId) continue;
      const known = this.#state.chatGpt.registrations.find(item => item.accountId === description.accountId);
      if (known) {
        if (known.credentialId === (match[1] ?? 'legacy') || !description.configured) continue;
        const prior = await this.#sessions.read(known);
        const priorDescription = describeChatGptGrant(prior);
        const authorizedAt = Date.parse(record.payload.authorizedAt ?? record.payload.savedAt);
        const priorAuthorizedAt = Date.parse(prior?.payload?.authorizedAt ?? prior?.payload?.savedAt);
        if (priorDescription.configured && !(authorizedAt > priorAuthorizedAt)) continue;
        known.credentialId = match[1] ?? 'legacy';
        known.configRevision += 1;
        if (this.#state.chatGpt.account?.accountId === known.accountId) {
          this.#state.chatGpt.account = { accountId: known.accountId, issuedClientId: known.issuedClientId, configRevision: known.configRevision };
          this.#state.chatGpt.connection = null;
          this.#state.chatGpt.inference = {};
        }
        changed = true;
        continue;
      }
      if (this.#state.chatGpt.registrations.some(item => item.credentialId === (match[1] ?? 'legacy'))) continue;
      this.#state.chatGpt.registrations.push({ accountId: description.accountId, issuedClientId: description.issuedClientId,
        configRevision: 1, credentialId: match[1] ?? 'legacy', label: `ChatGPT ${this.#state.chatGpt.registrations.length + 1}` });
      changed = true;
    }
    if (changed) await this.#changed();
  }
  #operation(run) {
    const operation = this.#operations.then(() => {
      if (this.#disposed) throw new TypeError('ChatGPT host is disposed');
      return run();
    });
    this.#operations = operation.catch(() => {});
    return operation;
  }
  #registration(account = this.#state.chatGpt.account) {
    if (!account) return null;
    return this.#state.chatGpt.registrations.find(item => item.accountId === account.accountId)
      ?? { ...account, credentialId: 'legacy', label: 'ChatGPT 1' };
  }
  #assertCurrent(account, connection) {
    const current = this.#state.chatGpt;
    if (this.#disposed || current.account?.accountId !== account.accountId || current.account?.configRevision !== account.configRevision
      || current.account?.issuedClientId !== account.issuedClientId || current.connection?.connectionId !== connection.connectionId
      || current.connection?.configRevision !== connection.configRevision) throw Object.assign(new Error('ChatGPT authorization changed'), { code: 'AUTHORIZATION_CHANGED' });
  }
  async #registerFlow(registration) {
    this.#disposeFlow?.();
    const credentialId = registration?.credentialId ?? (this.#state.chatGpt.registrations.length ? randomUUID() : 'legacy');
    const key = chatGptSessionKey({ credentialId });
    const epoch = ++this.#authorizationEpoch;
    const durableEpoch = await this.#sessions.beginAuthorization(registration);
    if (epoch !== this.#authorizationEpoch || this.#disposed) {
      await this.#sessions.finishAuthorization(durableEpoch);
      throw Object.assign(new Error('ChatGPT authorization cancelled'), { code: 'OAUTH_CANCELLED' });
    }
    const flow = createChatGptAuthorizationFlow({
      hostId: this.#state.chatGpt.hostId,
      credentialKey: key,
      transport: this.#transport,
      ...(this.#endpoints ? { endpoints: this.#endpoints } : {}),
      ...(this.#timeoutMs ? { timeoutMs: this.#timeoutMs } : {}),
      getExistingGrant: () => this.#credentials().readRecord(key),
      getRegistration: () => registration,
      commitGrant: (record, session) => this.#sessions.commitAuthorization({
        accountId: describeChatGptGrant(record).accountId, issuedClientId: record.payload.issuedClientId, credentialId,
      }, record, durableEpoch, session.signal),
      afterCommit: result => this.#disposed
        ? this.#sessions.discardAuthorization({ accountId: result.accountId, issuedClientId: result.issuedClientId, credentialId }, durableEpoch)
        : this.#operation(() => this.#afterCommit(result, credentialId, epoch, durableEpoch)),
    });
    this.#disposeFlow = this.#authorization().registerFlow({ ...flow, run: session => {
      const completion = flow.run(session).finally(() => this.#sessions.finishAuthorization(durableEpoch));
      this.#flowCompletions.add(completion);
      completion.then(() => this.#flowCompletions.delete(completion), () => this.#flowCompletions.delete(completion));
      return completion;
    } });
    this.#flowKey = key;
    return key;
  }
  async #afterCommit(result, credentialId, epoch, durableEpoch) {
    const existing = this.#state.chatGpt.account;
    const priorRegistration = this.#state.chatGpt.registrations.find(item => item.accountId === result.accountId);
    if (epoch !== this.#authorizationEpoch || !(await this.#sessions.authorizationIsCurrent(durableEpoch))) {
      await this.#sessions.discardAuthorization({ accountId: result.accountId, issuedClientId: result.issuedClientId, credentialId }, durableEpoch);
      return;
    }
    const account = { accountId: result.accountId, issuedClientId: result.issuedClientId, configRevision: Math.max(existing?.configRevision ?? 0, priorRegistration?.configRevision ?? 0) + 1 };
    const connection = {
      connectionId: existing?.accountId === result.accountId && this.#state.chatGpt.connection?.accountId === result.accountId
        ? this.#state.chatGpt.connection.connectionId
        : `connection-${randomUUID()}`,
      accountId: result.accountId,
      configRevision: (this.#state.chatGpt.connection?.configRevision ?? 0) + 1,
    };
    if (priorRegistration && priorRegistration.credentialId !== credentialId) {
      // Keep the newly committed slot in place. Copying a read token to another
      // slot could overwrite a replacement rotated by a concurrent process.
      await this.#sessions.signOut(priorRegistration);
    }
    if (epoch !== this.#authorizationEpoch || !(await this.#sessions.authorizationIsCurrent(durableEpoch))) {
      await this.#sessions.discardAuthorization({ ...account, credentialId }, durableEpoch);
      return;
    }
    this.#state.chatGpt.registrations = this.#state.chatGpt.registrations.filter(item => item.accountId !== account.accountId);
    this.#state.chatGpt.registrations.push({ ...account, credentialId, label: priorRegistration?.label ?? `ChatGPT ${this.#state.chatGpt.registrations.length + 1}` });
    if (epoch !== this.#authorizationEpoch) { await this.#changed(); return; }
    this.#state.chatGpt.account = account;
    delete this.#state.chatGpt.failures[account.accountId];
    this.#state.chatGpt.connection = result.directUseEnabled && result.catalogStatus === 'listed' && result.models.length ? connection : null;
    this.#state.chatGpt.inference = {};
    try {
      await this.#changed();
      await this.#unmount();
      if (this.#state.chatGpt.connection) {
        await this.#mount(this.#state.chatGpt.connection);
        await this.#changed();
      }
    } catch (error) {
      this.#state.chatGpt.connection = null;
      await this.#unmount().catch(() => {});
      this.#state.chatGpt.failures[account.accountId] = safeFailureCode(error);
      await this.#changed().catch(() => {});
      throw error;
    }
  }
  async restore() {
    await this.#unmount();
    const { account, connection } = this.#state.chatGpt;
    if (!account || !connection || !this.#ctx.get('credentials')) return;
    try {
      const description = describeChatGptGrant(await this.#sessions.read(this.#registration(account)));
      if (!description.configured || !description.directUseEnabled || description.accountId !== account.accountId || description.issuedClientId !== account.issuedClientId || !description.models.length) return;
      await this.#mount(connection);
      await this.#changed();
    } catch { /* Keep redacted state for recovery; no route is mounted. */ }
  }
  async #mount(connection) {
    if (typeof this.#mountConnection !== 'function') return;
    const account = this.#state.chatGpt.account;
    const provider = providerFor(account.accountId);
    const getAuthorizedCredential = request => this.#authorizedCredential({ ...request, account, connection });
    const getCatalog = request => this.#catalog({ ...request, account, connection });
    const transport = this.#endpoints?.kind === 'controlled-test'
      ? { request: (url, options) => this.#transport.request(url, { ...options, authorizeAddress: ({ address }) => address === '127.0.0.1' && isIP(address) === 4 }) }
      : this.#transport;
    this.#mounted = await this.#mountConnection(this.#ctx, {
      provider,
      connectionId: connection.connectionId,
      accountId: account.accountId,
      configRevision: connection.configRevision,
      credentialKey: chatGptSessionKey(this.#registration(account)),
      transport,
      ...(this.#endpoints?.responsesURL ? { responsesURL: this.#endpoints.responsesURL } : {}),
      getAuthorizedCredential,
      getCatalog,
      onInferenceCompleted: result => this.#markInferenceCompleted(result, { account: structuredClone(account), connection: structuredClone(connection) }),
      onInferenceFailure: result => this.#inferenceFailure(result, { account, connection, registration: this.#registration(account) }),
    });
    try { this.#assertCurrent(account, connection); }
    catch (error) { await this.#unmount(); throw error; }
  }
  async #unmount() {
    const mounted = this.#mounted;
    this.#mounted = null;
    await mounted?.disconnect({ deleteCredential: false });
  }
  async #currentGrant(account, connection, signal) {
    this.#assertCurrent(account, connection);
    let grant;
    try { grant = await this.#sessions.ensure(this.#registration(account), { signal }); }
    catch (error) {
      this.#assertCurrent(account, connection);
      this.#state.chatGpt.failures[account.accountId] = safeFailureCode(error);
      const description = describeChatGptGrant(await this.#sessions.read(this.#registration(account)));
      if (!description.configured || !description.directUseEnabled || description.catalogStatus !== 'listed') {
        this.#state.chatGpt.connection = null;
        await this.#unmount();
      }
      await this.#changed().catch(() => {});
      throw error;
    }
    this.#assertCurrent(account, connection);
    delete this.#state.chatGpt.failures[account.accountId];
    const mountedModels = this.#mounted?.source?.models?.map(item => item.model).sort();
    if (mountedModels && JSON.stringify(mountedModels) !== JSON.stringify(grant.catalog.models.map(item => item.slug).sort())) {
      this.#state.chatGpt.connection = null;
      this.#state.chatGpt.failures[account.accountId] = 'MODEL_CATALOG_CHANGED';
      await this.#unmount();
      await this.#changed();
      throw Object.assign(new Error('ChatGPT model catalog changed; reconnect to select a current model'), { code: 'MODEL_CATALOG_CHANGED' });
    }
    return grant;
  }
  async #authorizedCredential({ provider, accountId, signal, account, connection }) {
    signal?.throwIfAborted();
    if (provider !== providerFor(account.accountId) || accountId !== account.accountId) throw Object.assign(new Error('ChatGPT connection identity mismatch'), { code: 'AUTHORIZATION_CHANGED' });
    const grant = await this.#currentGrant(account, connection, signal);
    signal?.throwIfAborted();
    return { access_token: grant.accessToken, client_id: grant.issuedClientId, subject: grant.subject, scopes: [...grant.scopes] };
  }
  async #catalog({ provider, accountId, signal, account, connection }) {
    const grant = await this.#currentGrant(account, connection, signal);
    signal?.throwIfAborted();
    if (provider !== providerFor(account.accountId) || accountId !== account.accountId || grant.catalog?.status !== 'listed') throw Object.assign(new Error('ChatGPT model catalog unavailable'), { code: 'MODEL_NOT_FOUND' });
    return {
      identity: { client_id: grant.issuedClientId, subject: grant.subject },
      models: grant.catalog.models.map(model => ({ slug: model.slug, display_name: model.displayName })),
    };
  }
  async #markInferenceCompleted({ provider, accountId, model }, expected) {
    const account = this.#state.chatGpt.account;
    const connection = this.#state.chatGpt.connection;
    if (!account || !connection || !expected
      || account.accountId !== expected.account.accountId || account.issuedClientId !== expected.account.issuedClientId || account.configRevision !== expected.account.configRevision
      || connection.connectionId !== expected.connection.connectionId || connection.accountId !== expected.connection.accountId || connection.configRevision !== expected.connection.configRevision
      || provider !== providerFor(account.accountId) || accountId !== account.accountId || typeof model !== 'string' || !model) return;
    const identity = inferenceIdentity(account, connection, model);
    this.#state.chatGpt.inference[inferenceKey(identity)] = { status: 'verified', verifiedAt: new Date().toISOString(), identity };
    await this.#changed().catch(() => {});
  }
  async #inferenceFailure({ code, accessToken }, { account, connection, registration }) {
    try { this.#assertCurrent(account, connection); } catch { return; }
    code = typeof code === 'string' && /^[A-Za-z0-9_]{1,100}$/u.test(code) ? code.toLowerCase() : 'chatgpt_request_failed';
    const terminal = ['invalid_token', 'token_expired', 'token_revoked', 'invalid_grant', 'insufficient_scope', 'subscription_sharing_missing_scope', 'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'].includes(code);
    const failureCode = /^[a-z0-9_]{1,100}$/u.test(code ?? '') ? code.toUpperCase() : 'CHATGPT_REQUEST_FAILED';
    if (terminal && !(await this.#sessions.invalidate(registration, accessToken, failureCode))) return;
    try { this.#assertCurrent(account, connection); } catch { return; }
    this.#state.chatGpt.failures[account.accountId] = failureCode;
    if (terminal || ['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_user_not_eligible'].includes(code)) {
      this.#state.chatGpt.connection = null;
      await this.#unmount();
    }
    await this.#changed().catch(() => {});
  }
  async startAuthorization({ newAccount = false } = {}) {
    const authorization = this.#authorization();
    this.#credentials();
    if (this.#attempt.status === 'waiting') throw Object.assign(new Error('ChatGPT authorization is already in progress'), { code: 'AUTHORIZATION_IN_PROGRESS' });
    const attemptId = randomUUID();
    this.#attempt = { status: 'waiting', attemptId, startedAt: new Date().toISOString() };
    let key;
    try { key = await this.#registerFlow(newAccount ? null : this.#registration()); }
    catch (cause) {
      this.#attempt = { status: cause.code === 'OAUTH_CANCELLED' ? 'cancelled' : 'failed', attemptId, failureCode: safeFailureCode(cause), endedAt: new Date().toISOString() };
      throw cause;
    }
    let noticeResolve;
    let noticeReject;
    const notice = new Promise((resolve, reject) => { noticeResolve = resolve; noticeReject = reject; });
    const completion = authorization.begin({
      key,
      method: 'oauth',
      interaction: {
        notify(value) {
          if (typeof value?.url === 'string') noticeResolve(value.url);
        },
        async prompt() { throw Object.assign(new Error('ChatGPT OAuth does not accept pasted credentials'), { code: 'AUTHORIZATION_PROMPT_UNSUPPORTED' }); },
      },
    });
    completion.then(
      outcome => {
        if (this.#attempt.attemptId === attemptId) this.#attempt = { status: outcome.status, attemptId, endedAt: new Date().toISOString() };
        if (outcome.status === 'cancelled') noticeReject(Object.assign(new Error('ChatGPT authorization cancelled'), { code: 'OAUTH_CANCELLED' }));
      },
      error => { if (this.#attempt.attemptId === attemptId) this.#attempt = { status: error?.code === 'OAUTH_CANCELLED' ? 'cancelled' : 'failed', attemptId, failureCode: safeFailureCode(error), endedAt: new Date().toISOString() }; noticeReject(error); },
    );
    const authorizationURL = await notice;
    return { attemptId, authorizationURL };
  }
  async cancelAuthorization() {
    this.#authorizationEpoch += 1;
    if (this.#flowKey) this.#authorization().cancel(this.#flowKey);
    await this.#sessions?.cancelAuthorization();
  }
  async connect() { return this.#operation(() => this.#connect()); }
  async #connect() {
    if (this.#state.chatGpt.connection && this.#mounted) throw new TypeError('ChatGPT account is already connected');
    this.#state.chatGpt.connection = null;
    const account = this.#state.chatGpt.account;
    if (!account) throw new TypeError('No saved ChatGPT account');
    try { await this.#sessions.ensure(this.#registration(account), { refreshCatalog: true }); }
    catch (error) {
      this.#state.chatGpt.failures[account.accountId] = safeFailureCode(error);
      await this.#changed().catch(() => {});
      throw error;
    }
    const description = describeChatGptGrant(await this.#sessions.read(this.#registration(account)));
    if (!description.directUseEnabled || description.accountId !== account.accountId || !description.models.length) throw new TypeError('ChatGPT plan use or model catalog is unavailable');
    const connection = { connectionId: `connection-${randomUUID()}`, accountId: account.accountId, configRevision: account.configRevision + 1 };
    this.#state.chatGpt.connection = connection;
    this.#state.chatGpt.inference = {};
    try { await this.#changed(); await this.#mount(connection); await this.#changed(); }
    catch (error) { this.#state.chatGpt.connection = null; await this.#changed().catch(() => {}); throw error; }
  }
  async disconnect({ deleteCredential = false } = {}) {
    if (deleteCredential) return this.signOut();
    return this.#operation(() => this.#disconnect());
  }
  async #disconnect() {
    const cancellation = this.cancelAuthorization();
    const previous = structuredClone(this.#state.chatGpt);
    this.#state.chatGpt.connection = null;
    try { await this.#changed(); }
    catch (error) { this.#state.chatGpt = previous; throw error; }
    await this.#unmount();
    await cancellation;
    await this.#changed();
  }
  async selectAccount({ accountId }) {
    return this.#operation(async () => {
      const registration = this.#state.chatGpt.registrations.find(item => item.accountId === accountId);
      if (!registration) throw new TypeError('Unknown ChatGPT registration');
      const cancellation = this.cancelAuthorization();
      this.#state.chatGpt.connection = null;
      this.#state.chatGpt.account = { accountId, issuedClientId: registration.issuedClientId, configRevision: registration.configRevision + 1 };
      registration.configRevision += 1;
      this.#state.chatGpt.inference = {};
      await this.#unmount();
      await cancellation;
      await this.#changed();
      const description = describeChatGptGrant(await this.#sessions.read(registration));
      if (description.configured && description.directUseEnabled) await this.#connect();
    });
  }
  async signOut() {
    return this.#operation(async () => {
      const cancellation = this.cancelAuthorization();
      const registration = this.#registration();
      if (!registration) { await cancellation; return; }
      this.#state.chatGpt.connection = null;
      this.#state.chatGpt.inference = {};
      let persistenceError;
      await this.#unmount().catch(error => { persistenceError = error; });
      await this.#changed().catch(error => { persistenceError = error; });
      await cancellation;
      await this.#sessions.signOutRegistration(registration);
      delete this.#state.chatGpt.failures[registration.accountId];
      await this.#changed().catch(error => { persistenceError = error; });
      if (persistenceError) throw persistenceError;
    });
  }
  async claimDetectionTask() {
    if (this.#state.chatGpt.lastDetectionTaskId) throw new TypeError('The authorized ChatGPT validation Task has already been used');
    const claimId = `claim-${randomUUID()}`;
    this.#state.chatGpt.lastDetectionTaskId = claimId;
    try { await this.#changed(); }
    catch (error) { this.#state.chatGpt.lastDetectionTaskId = null; throw error; }
    return claimId;
  }
  async finalizeDetectionTask(claimId, taskId) {
    if (this.#state.chatGpt.lastDetectionTaskId !== claimId || typeof taskId !== 'string' || !taskId) throw new TypeError('ChatGPT validation Task claim changed');
    this.#state.chatGpt.lastDetectionTaskId = taskId;
    try { await this.#changed(); }
    catch (error) { this.#state.chatGpt.lastDetectionTaskId = claimId; throw error; }
  }
  async snapshot() {
    const { account, connection, hostId, lastDetectionTaskId } = this.#state.chatGpt;
    let credential = { configured: false, directUseEnabled: false, catalogStatus: 'not-requested', models: [] };
    if (this.#ctx.get('credentials')) {
      try { if (account) credential = describeChatGptGrant(await this.#sessions.read(this.#registration(account))); } catch { /* redacted unavailable state */ }
    }
    if (account && this.#sessions) credential = { ...credential, revocation: await this.#sessions.revocation(this.#registration(account), credential.revocation ?? null) };
    const inferenceEntries = [];
    if (account && connection) for (const record of Object.values(this.#state.chatGpt.inference)) {
      const expected = inferenceIdentity(account, connection, record.identity.model);
      if (inferenceKey(expected) === inferenceKey(record.identity)) inferenceEntries.push([record.identity.model, { status: record.status, verifiedAt: record.verifiedAt }]);
    }
    const inference = Object.fromEntries(inferenceEntries);
    return structuredClone({
      hostId,
      servicesAvailable: Boolean(this.#ctx.get('credentials') && this.#ctx.get('authorization')),
      account: account ? { accountId: account.accountId, issuedClientId: account.issuedClientId, configured: credential.configured, directUseEnabled: credential.directUseEnabled } : null,
      registrations: await Promise.all(this.#state.chatGpt.registrations.map(async registration => {
        let description;
        try { description = describeChatGptGrant(await this.#sessions.read(registration)); } catch { description = { configured: false }; }
        return { accountId: registration.accountId, issuedClientId: registration.issuedClientId, label: registration.label, configured: description.configured, selected: account?.accountId === registration.accountId };
      })),
      lifecycle: { status: credential.status ?? (credential.configured ? 'authorized' : 'not-configured'), failureCode: account ? this.#state.chatGpt.failures[account.accountId] ?? credential.failureCode ?? null : null, revocation: credential.revocation ?? null },
      connection: connection ? { connectionId: connection.connectionId, accountId: connection.accountId, provider: providerFor(connection.accountId), available: Boolean(this.#mounted && credential.configured && credential.directUseEnabled && credential.catalogStatus === 'listed') } : null,
      catalog: { status: credential.catalogStatus, models: credential.models },
      authorization: structuredClone(this.#attempt),
      inference: structuredClone(inference),
      lastDetectionTaskId,
    });
  }
  async dispose() {
    this.#disposed = true;
    this.#authorizationEpoch += 1;
    if (this.#flowKey) this.#ctx.get('authorization')?.cancel(this.#flowKey);
    await this.#operations;
    await Promise.allSettled([...this.#flowCompletions]);
    this.#disposeFlow?.();
    this.#disposeFlow = null;
    await this.#unmount();
  }
}
