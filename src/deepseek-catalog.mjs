import { LlmError } from '@deepseek-ai/dsh-llm';

export const DEEPSEEK_OFFICIAL_CATALOG_URL = 'https://api.deepseek.com/models';
export const DEEPSEEK_FORMAL_MODEL_IDS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);

const RESPONSE_LIMIT = 1_048_576;
const FORMAL_IDS = new Set(DEEPSEEK_FORMAL_MODEL_IDS);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function catalogEndpoint(value) {
  const parsed = new URL(value);
  const official = parsed.protocol === 'https:' && parsed.hostname === 'api.deepseek.com';
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol);
  if ((!official && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('DeepSeek catalog URL must be the official HTTPS origin or an explicit loopback endpoint without credentials, query, or fragment');
  }
  return parsed.href;
}

function optionalPositiveInteger(value, field, id) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new LlmError(`DeepSeek catalog model "${id}" has invalid ${field}`, 'INVALID_CATALOG');
  return value;
}

function optionalStrings(value, field, id) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry.length === 0)) {
    throw new LlmError(`DeepSeek catalog model "${id}" has invalid ${field}`, 'INVALID_CATALOG');
  }
  return [...value];
}

function safeModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string' || value.id.length === 0) {
    throw new LlmError('DeepSeek catalog contains an invalid model entry', 'INVALID_CATALOG');
  }
  const contextWindow = optionalPositiveInteger(value.context_window, 'context_window', value.id);
  const maxOutputTokens = optionalPositiveInteger(value.max_output_tokens, 'max_output_tokens', value.id);
  const inputModalities = optionalStrings(value.input_modalities, 'input_modalities', value.id);
  const outputModalities = optionalStrings(value.output_modalities, 'output_modalities', value.id);
  const effort = optionalStrings(value.effort, 'effort', value.id);
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length === 0)) {
    throw new LlmError(`DeepSeek catalog model "${value.id}" has invalid name`, 'INVALID_CATALOG');
  }
  return {
    id: value.id,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(inputModalities === undefined ? {} : { inputModalities }),
    ...(outputModalities === undefined ? {} : { outputModalities }),
    ...(effort === undefined ? {} : { effort }),
    ...(value.api_capabilities === undefined ? {} : { apiCapabilities: structuredClone(value.api_capabilities) }),
  };
}

export async function fetchDeepSeekModelCatalog({ catalogURL = DEEPSEEK_OFFICIAL_CATALOG_URL, signal, fetchImpl = fetch } = {}) {
  const url = catalogEndpoint(catalogURL);
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new LlmError(`DeepSeek catalog request failed with HTTP ${response.status}`, 'CATALOG_UNAVAILABLE', { status: response.status });
  const text = await response.text();
  if (Buffer.byteLength(text) > RESPONSE_LIMIT) throw new LlmError('DeepSeek catalog response exceeds 1 MiB', 'INVALID_CATALOG');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new LlmError('DeepSeek catalog response is not valid JSON', 'INVALID_CATALOG', { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.data)) {
    throw new LlmError('DeepSeek catalog response has no data array', 'INVALID_CATALOG');
  }
  const seen = new Set();
  const models = [];
  const unrecognizedModelIds = [];
  for (const entry of raw.data) {
    const model = safeModel(entry);
    if (seen.has(model.id)) throw new LlmError(`DeepSeek catalog repeats model "${model.id}"`, 'INVALID_CATALOG');
    seen.add(model.id);
    if (FORMAL_IDS.has(model.id)) models.push(model);
    else unrecognizedModelIds.push(model.id);
  }
  return deepFreeze({
    status: 'listed',
    source: url,
    models,
    unrecognizedModelIds,
  });
}
