import { credentialKey, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm';
import {
  catalogModelInfo,
  registerDeepSeekProvider,
  resolveAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek';
export {
  DEEPSEEK_OFFICIAL_CATALOG_URL,
  fetchDeepSeekModelCatalog,
} from './deepseek-catalog.mjs';

export const DEEPSEEK_CREDENTIAL_OWNER = 'irishwei-dsh-router';
export const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com/anthropic';

export const DEEPSEEK_MODELS = deepFreeze([
  {
    id: 'deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_048_576,
    maxTokens: 393_216,
    inputModalities: ['text'],
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1_048_576,
    maxTokens: 393_216,
    inputModalities: ['text'],
  },
]);

const DEEPSEEK_MODEL_IDS = new Set(DEEPSEEK_MODELS.map(({ id }) => id));
const SAFE_PROVIDER_FAILURE_CODES = new Set([
  'ABORTED', 'AUTH', 'AUTHORIZATION_CHANGED', 'CONNECTION', 'CONTEXT_WINDOW_EXCEEDED',
  'EMPTY_RESPONSE', 'INVALID_CREDENTIAL', 'INVALID_MODEL_CONTEXT', 'INVALID_MODEL_INFO',
  'INVALID_MODEL_MAX_TOKENS', 'INVALID_MODEL_REASONING', 'INVALID_PREPARED_CALL',
  'INVALID_REQUEST', 'INVALID_RESPONSE', 'MALFORMED_RESPONSE', 'MISSING_CREDENTIAL',
  'NO_ADAPTER', 'QUOTA', 'RATE_LIMIT', 'REGISTRATION_DISPOSED', 'REQUEST_EXTENSION',
  'SERVER', 'STREAM_CLOSED', 'TIMEOUT', 'TRANSPORT', 'UNSUPPORTED_CONTENT',
  'UNSUPPORTED_REASONING_EFFORT',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function sanitizedProviderFailure(value) {
  const rawCode = typeof value?.code === 'string' ? value.code : undefined;
  const status = Number.isInteger(value?.status) && value.status >= 100 && value.status <= 599
    ? value.status
    : undefined;
  const httpCode = status !== undefined && rawCode === `HTTP_${status}`;
  const code = SAFE_PROVIDER_FAILURE_CODES.has(rawCode) || httpCode ? rawCode : 'DEEPSEEK_REQUEST_FAILED';
  return Object.freeze({
    message: 'DeepSeek provider request failed',
    code,
    ...(status === undefined ? {} : { status }),
  });
}

function sanitizeProviderChunk(chunk) {
  if (chunk?.type !== 'finish' || !['aborted', 'error'].includes(chunk.reason?.kind)) return chunk;
  return {
    ...chunk,
    reason: { ...chunk.reason, failure: sanitizedProviderFailure(chunk.reason.failure) },
  };
}

function sanitizeProviderError(error) {
  const failure = sanitizedProviderFailure(error?.failure ?? error);
  return new LlmError(failure.message, failure.code, failure.status === undefined ? undefined : { status: failure.status });
}

export function assertDeepSeekModelId(model) {
  if (!DEEPSEEK_MODEL_IDS.has(model)) throw new TypeError(`unsupported DeepSeek model id ${JSON.stringify(model)}`);
  return model;
}

export function deepSeekCredentialKey(accountId) {
  requiredString(accountId, 'accountId');
  if (!accountId.startsWith('account-') || !isCredentialKeySegment(accountId)) {
    throw new TypeError('accountId must be an opaque lowercase identifier beginning with "account-"');
  }
  return credentialKey(DEEPSEEK_CREDENTIAL_OWNER, accountId);
}

export async function storeDeepSeekApiKey(credentials, accountId, rawApiKey) {
  const key = deepSeekCredentialKey(accountId);
  const apiKey = assertUsableApiKey(rawApiKey, 'dsh-router', String(key));
  await credentials.modifyRecord(key, async current => {
    if (current !== undefined) {
      throw new TypeError('an existing DeepSeek credential cannot be replaced; create a new account binding');
    }
    return { kind: 'api-key', key: apiKey };
  });
}

export async function describeDeepSeekCredential(credentials, accountId) {
  const info = await credentials.describeRecord(deepSeekCredentialKey(accountId));
  return deepFreeze({
    configured: info.configured,
    ...(info.kind === undefined ? {} : { kind: info.kind }),
    writable: info.writable,
  });
}

export async function deleteDeepSeekCredential(credentials, accountId) {
  await credentials.deleteRecord(deepSeekCredentialKey(accountId));
}

export function deepSeekProviderRoute(accountId) {
  deepSeekCredentialKey(accountId);
  return `router-deepseek-${accountId}`;
}

export function createDeepSeekConnectionMetadata({ connectionId, accountId, configRevision, credentialGeneration, credential }) {
  const provider = deepSeekProviderRoute(accountId);
  requiredString(connectionId, 'connectionId');
  requiredString(credentialGeneration, 'credentialGeneration');
  positiveInteger(configRevision, 'configRevision');
  if (!credential || typeof credential.configured !== 'boolean' || typeof credential.writable !== 'boolean') {
    throw new TypeError('credential must be redacted credential metadata');
  }
  return deepFreeze({
    ownership: 'router-owned',
    source: 'deepseek-official-api',
    sourceKey: `deepseek-official-api:${accountId}`,
    supportScope: 'owned-provider-metadata',
    connectionId,
    accountId,
    billingPath: 'deepseek-api',
    provider,
    credentialKey: String(deepSeekCredentialKey(accountId)),
    configRevision,
    credentialGeneration,
    credential: {
      configured: credential.configured,
      ...(credential.kind === undefined ? {} : { kind: credential.kind }),
      writable: credential.writable,
    },
    providerAuthorization: { status: credential.configured ? 'configured' : 'unknown' },
    catalog: {
      status: 'declared',
      source: 'deepseek-public-documentation',
      models: DEEPSEEK_MODELS,
    },
    capabilities: {
      text: { status: 'declared' },
      tools: { status: 'declared' },
      image: { status: 'unsupported' },
    },
    inference: { status: 'unverified' },
  });
}

function resolveEndpoint(endpoint) {
  if (endpoint === undefined || endpoint?.kind === 'official') {
    return { kind: 'official', baseURL: DEEPSEEK_OFFICIAL_BASE_URL };
  }
  if (endpoint?.kind !== 'controlled-test') throw new TypeError('DeepSeek endpoint must be official or an explicit controlled-test endpoint');
  const parsed = new URL(requiredString(endpoint.baseURL, 'endpoint.baseURL'));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new TypeError('controlled-test DeepSeek endpoints must use loopback');
  }
  return { kind: 'controlled-test', baseURL: parsed.href.replace(/\/$/, '') };
}

function providerPlugin(spec, state) {
  const provider = deepSeekProviderRoute(spec.accountId);
  const key = deepSeekCredentialKey(spec.accountId);
  const endpoint = resolveEndpoint(spec.endpoint);
  const options = deepFreeze({
    ...resolveAdapterOptions({
      baseURL: endpoint.baseURL,
      models: DEEPSEEK_MODELS,
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    }),
    accountId: spec.accountId,
    credentialGeneration: spec.credentialGeneration,
    credentialKey: String(key),
  });

  return {
    inject: ['llm', 'credentials'],
    apply(ctx) {
      ctx.on('credentials/record-updated', updated => {
        if (String(updated) === String(key)) state.revoked = true;
      });
      ctx.on('llm/stream', async function* (request, next) {
        if (request.provider !== provider) {
          yield* next();
          return;
        }
        assertDeepSeekModelId(request.model);
        try {
          for await (const chunk of next()) yield sanitizeProviderChunk(chunk);
        } catch (error) {
          if (request.signal?.aborted) throw new LlmError('DeepSeek provider request was aborted', 'ABORTED');
          throw sanitizeProviderError(error);
        }
      });
      registerDeepSeekProvider(ctx, provider, {
        options: () => options,
        providerName: 'DeepSeek (Router)',
        discoverModels: route => Promise.resolve(DEEPSEEK_MODELS.map(model => catalogModelInfo(route, model))),
        resolveAuth: async connection => {
          if (!state.active || state.revoked || connection !== options) {
            throw new LlmError(`dsh-router: authorization changed for provider route "${provider}"`, 'AUTHORIZATION_CHANGED');
          }
          const record = await ctx.credentials.readRecord(key);
          if (!state.active || state.revoked) {
            throw new LlmError(`dsh-router: authorization changed for provider route "${provider}"`, 'AUTHORIZATION_CHANGED');
          }
          if (record?.kind !== 'api-key' || record.key === undefined) {
            throw new LlmError(`dsh-router: no owned API key for provider route "${provider}"`, 'MISSING_CREDENTIAL');
          }
          return { headers: { 'x-api-key': assertUsableApiKey(record.key, 'dsh-router', String(key)) } };
        },
      });
    },
  };
}

export async function mountDeepSeekOwnedProvider(ctx, spec) {
  const credentials = ctx.get('credentials');
  if (!credentials) throw new TypeError('DeepSeek credentials are unavailable');
  const credential = await describeDeepSeekCredential(credentials, spec.accountId);
  const metadata = createDeepSeekConnectionMetadata({ ...spec, credential });
  const state = { active: true, revoked: false };
  let fiber;
  try {
    fiber = await ctx.plugin(providerPlugin(spec, state));
  } catch (error) {
    state.active = false;
    throw error;
  }
  let disposal;
  let deletion;
  let credentialDeleted = false;
  return Object.freeze({
    metadata,
    async disconnect({ deleteCredential = true } = {}) {
      state.active = false;
      disposal ??= fiber.dispose();
      await disposal;
      if (!deleteCredential || credentialDeleted) return;
      deletion ??= deleteDeepSeekCredential(credentials, spec.accountId)
        .then(() => { credentialDeleted = true; })
        .finally(() => { deletion = undefined; });
      await deletion;
    },
  });
}
