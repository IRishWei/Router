import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  CHATGPT_CREDENTIAL_KEY,
  CHATGPT_DIRECT_SCOPE,
  chatGptGrantFromRecord,
  createChatGptAuthorizationFlow,
  describeChatGptGrant,
} from './chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from './source-network.mjs';

const providerFor = accountId => `router-chatgpt-${accountId}`;
const safeFailureCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/u.test(error.code) ? error.code : 'CHATGPT_AUTHORIZATION_FAILED';

function normalizeState(value) {
  if (value === undefined) return {
    hostId: `urn:uuid:${randomUUID()}`,
    account: null,
    connection: null,
    lastDetectionTaskId: null,
    inference: {},
  };
  if (!value || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.hostId)) throw new Error('Unsupported ChatGPT Router state');
  const account = value.account;
  if (account !== null && (typeof account?.accountId !== 'string' || !account.accountId.startsWith('account-') || typeof account.issuedClientId !== 'string' || !account.issuedClientId || !Number.isSafeInteger(account.configRevision) || account.configRevision < 1)) throw new Error('Unsupported ChatGPT account state');
  const connection = value.connection;
  if (connection !== null && (!account || typeof connection?.connectionId !== 'string' || !connection.connectionId.startsWith('connection-') || connection.accountId !== account.accountId || !Number.isSafeInteger(connection.configRevision) || connection.configRevision < 1)) throw new Error('Unsupported ChatGPT connection state');
  if (value.lastDetectionTaskId !== null && typeof value.lastDetectionTaskId !== 'string') throw new Error('Unsupported ChatGPT detection state');
  const inference = value.inference ?? {};
  if (!inference || Array.isArray(inference) || Object.entries(inference).some(([model, record]) => !model || record?.status !== 'verified' || typeof record.verifiedAt !== 'string')) throw new Error('Unsupported ChatGPT inference state');
  return structuredClone({ hostId: value.hostId, account, connection, lastDetectionTaskId: value.lastDetectionTaskId ?? null, inference });
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
    const flow = createChatGptAuthorizationFlow({
      hostId: this.#state.chatGpt.hostId,
      credentialKey: CHATGPT_CREDENTIAL_KEY,
      transport: this.#transport,
      ...(this.#endpoints ? { endpoints: this.#endpoints } : {}),
      ...(this.#timeoutMs ? { timeoutMs: this.#timeoutMs } : {}),
      getExistingGrant: () => credentials.readRecord(CHATGPT_CREDENTIAL_KEY),
      afterCommit: result => this.#afterCommit(result),
    });
    this.#disposeFlow = authorization.registerFlow(flow);
    await this.restore();
  }
  async #afterCommit(result) {
    const previousState = structuredClone(this.#state.chatGpt);
    const existing = this.#state.chatGpt.account;
    const account = { accountId: result.accountId, issuedClientId: result.issuedClientId, configRevision: (existing?.configRevision ?? 0) + 1 };
    const connection = {
      connectionId: existing?.accountId === result.accountId && this.#state.chatGpt.connection?.accountId === result.accountId
        ? this.#state.chatGpt.connection.connectionId
        : `connection-${randomUUID()}`,
      accountId: result.accountId,
      configRevision: (this.#state.chatGpt.connection?.configRevision ?? 0) + 1,
    };
    this.#state.chatGpt.account = account;
    this.#state.chatGpt.connection = result.directUseEnabled && result.catalogStatus === 'listed' && result.models.length ? connection : null;
    try {
      await this.#changed();
      await this.#unmount();
      if (this.#state.chatGpt.connection) {
        await this.#mount(this.#state.chatGpt.connection);
        await this.#changed();
      }
    } catch (error) {
      await this.#unmount().catch(() => {});
      this.#state.chatGpt = previousState;
      await this.#credentials().modifyRecord(CHATGPT_CREDENTIAL_KEY, () => result.previousRecord).catch(() => {});
      throw error;
    }
  }
  async restore() {
    await this.#unmount();
    const { account, connection } = this.#state.chatGpt;
    if (!account || !connection || !this.#ctx.get('credentials')) return;
    try {
      const description = describeChatGptGrant(await this.#credentials().readRecord(CHATGPT_CREDENTIAL_KEY));
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
      credentialKey: CHATGPT_CREDENTIAL_KEY,
      transport,
      ...(this.#endpoints?.responsesURL ? { responsesURL: this.#endpoints.responsesURL } : {}),
      getAuthorizedCredential,
      getCatalog,
      onInferenceCompleted: result => this.#markInferenceCompleted(result),
    });
  }
  async #unmount() {
    const mounted = this.#mounted;
    this.#mounted = null;
    await mounted?.disconnect({ deleteCredential: false });
  }
  async #currentGrant(account, connection) {
    if (this.#state.chatGpt.account?.accountId !== account.accountId || this.#state.chatGpt.connection?.connectionId !== connection.connectionId) throw Object.assign(new Error('ChatGPT connection changed'), { code: 'AUTHORIZATION_CHANGED' });
    const grant = chatGptGrantFromRecord(await this.#credentials().readRecord(CHATGPT_CREDENTIAL_KEY));
    if (!grant) throw Object.assign(new Error('ChatGPT authorization changed'), { code: 'AUTHORIZATION_CHANGED' });
    const description = describeChatGptGrant({ kind: 'grant', payload: grant });
    if (!description.directUseEnabled || description.accountId !== account.accountId || grant.issuedClientId !== account.issuedClientId) throw Object.assign(new Error('ChatGPT authorization changed'), { code: 'AUTHORIZATION_CHANGED' });
    const expiresAt = Date.parse(grant.savedAt) + grant.expiresIn * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw Object.assign(new Error('ChatGPT access token expired; sign in again'), { code: 'TOKEN_EXPIRED' });
    return grant;
  }
  async #authorizedCredential({ provider, accountId, signal, account, connection }) {
    signal?.throwIfAborted();
    if (provider !== providerFor(account.accountId) || accountId !== account.accountId) throw Object.assign(new Error('ChatGPT connection identity mismatch'), { code: 'AUTHORIZATION_CHANGED' });
    const grant = await this.#currentGrant(account, connection);
    signal?.throwIfAborted();
    return { access_token: grant.accessToken, client_id: grant.issuedClientId, subject: grant.subject, scopes: [...grant.scopes] };
  }
  async #catalog({ provider, accountId, signal, account, connection }) {
    const grant = await this.#currentGrant(account, connection);
    signal?.throwIfAborted();
    if (provider !== providerFor(account.accountId) || accountId !== account.accountId || grant.catalog?.status !== 'listed') throw Object.assign(new Error('ChatGPT model catalog unavailable'), { code: 'MODEL_NOT_FOUND' });
    return {
      identity: { client_id: grant.issuedClientId, subject: grant.subject },
      models: grant.catalog.models.map(model => ({ slug: model.slug, display_name: model.displayName })),
    };
  }
  async #markInferenceCompleted({ provider, accountId, model }) {
    const account = this.#state.chatGpt.account;
    if (!account || provider !== providerFor(account.accountId) || accountId !== account.accountId || typeof model !== 'string' || !model) return;
    this.#state.chatGpt.inference[model] = { status: 'verified', verifiedAt: new Date().toISOString() };
    await this.#changed().catch(() => {});
  }
  async startAuthorization() {
    const authorization = this.#authorization();
    this.#credentials();
    if (this.#attempt.status === 'waiting') throw Object.assign(new Error('ChatGPT authorization is already in progress'), { code: 'AUTHORIZATION_IN_PROGRESS' });
    const attemptId = randomUUID();
    let noticeResolve;
    let noticeReject;
    const notice = new Promise((resolve, reject) => { noticeResolve = resolve; noticeReject = reject; });
    this.#attempt = { status: 'waiting', attemptId, startedAt: new Date().toISOString() };
    const completion = authorization.begin({
      key: CHATGPT_CREDENTIAL_KEY,
      method: 'oauth',
      interaction: {
        notify(value) {
          if (typeof value?.url === 'string') noticeResolve(value.url);
        },
        async prompt() { throw Object.assign(new Error('ChatGPT OAuth does not accept pasted credentials'), { code: 'AUTHORIZATION_PROMPT_UNSUPPORTED' }); },
      },
    });
    completion.then(
      outcome => { this.#attempt = { status: outcome.status, attemptId, endedAt: new Date().toISOString() }; },
      error => { this.#attempt = { status: error?.code === 'OAUTH_CANCELLED' ? 'cancelled' : 'failed', attemptId, failureCode: safeFailureCode(error), endedAt: new Date().toISOString() }; noticeReject(error); },
    );
    const authorizationURL = await notice;
    return { attemptId, authorizationURL };
  }
  cancelAuthorization() {
    this.#authorization().cancel(CHATGPT_CREDENTIAL_KEY);
  }
  async connect() {
    if (this.#state.chatGpt.connection) throw new TypeError('ChatGPT account is already connected');
    const account = this.#state.chatGpt.account;
    if (!account) throw new TypeError('No saved ChatGPT account');
    const description = describeChatGptGrant(await this.#credentials().readRecord(CHATGPT_CREDENTIAL_KEY));
    if (!description.directUseEnabled || description.accountId !== account.accountId || !description.models.length) throw new TypeError('ChatGPT plan use or model catalog is unavailable');
    const connection = { connectionId: `connection-${randomUUID()}`, accountId: account.accountId, configRevision: account.configRevision + 1 };
    this.#state.chatGpt.connection = connection;
    try { await this.#changed(); await this.#mount(connection); await this.#changed(); }
    catch (error) { this.#state.chatGpt.connection = null; await this.#changed().catch(() => {}); throw error; }
  }
  async disconnect({ deleteCredential = false } = {}) {
    this.cancelAuthorization();
    const previous = structuredClone(this.#state.chatGpt);
    this.#state.chatGpt.connection = null;
    if (deleteCredential) this.#state.chatGpt.account = null;
    try { await this.#changed(); }
    catch (error) { this.#state.chatGpt = previous; throw error; }
    await this.#unmount();
    await this.#changed();
    if (deleteCredential) await this.#credentials().deleteRecord(CHATGPT_CREDENTIAL_KEY);
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
    const { account, connection, hostId, lastDetectionTaskId, inference } = this.#state.chatGpt;
    let credential = { configured: false, directUseEnabled: false, catalogStatus: 'not-requested', models: [] };
    if (this.#ctx.get('credentials')) {
      try { credential = describeChatGptGrant(await this.#credentials().readRecord(CHATGPT_CREDENTIAL_KEY)); } catch { /* redacted unavailable state */ }
    }
    return structuredClone({
      hostId,
      servicesAvailable: Boolean(this.#ctx.get('credentials') && this.#ctx.get('authorization')),
      account: account ? { accountId: account.accountId, issuedClientId: account.issuedClientId, configured: credential.configured, directUseEnabled: credential.directUseEnabled } : null,
      connection: connection ? { connectionId: connection.connectionId, accountId: connection.accountId, provider: providerFor(connection.accountId), available: Boolean(this.#mounted) } : null,
      catalog: { status: credential.catalogStatus, models: credential.models },
      authorization: structuredClone(this.#attempt),
      inference: structuredClone(inference),
      lastDetectionTaskId,
    });
  }
  async dispose() {
    this.#ctx.get('authorization')?.cancel(CHATGPT_CREDENTIAL_KEY);
    this.#disposeFlow?.();
    this.#disposeFlow = null;
    await this.#unmount();
  }
}
