import { LlmAdapter, LlmError, assertUsableApiKey, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { createRequire } from 'node:module';
import { inputItems, responseTools, sseEvents, translateEvents, headerValue } from './chatgpt-responses.mjs';

export const GO_RESPONSES_URL = 'https://opencode.ai/zen/go/v1/responses';
export const GO_MODEL = 'gpt-6-luna';
export const GO_MAX_OUTPUT_TOKENS = 1024;
const noRetry = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'OpenCode Go');
const { version } = createRequire(import.meta.url)('../package.json');
const safeCodes = new Set(['ABORTED', 'AUTH', 'AUTHORIZATION_CHANGED', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'NO_ADAPTER', 'RATE_LIMIT', 'TIMEOUT', 'STREAM_CLOSED', 'MALFORMED_RESPONSE', 'INVALID_RESPONSE', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_REQUEST', 'REQUEST_TOO_LARGE', 'SESSION_REQUIRED', 'OUTPUT_LIMIT_REQUIRED', 'CONTEXT_WINDOW_EXCEEDED', 'SOURCE_TIMEOUT', 'SOURCE_PROXY_UNAVAILABLE', 'SOURCE_UNAVAILABLE']);

export function goEndpoint(endpoint) {
  if (endpoint === undefined) return GO_RESPONSES_URL;
  const url = new URL(endpoint?.url);
  if (endpoint?.kind !== 'controlled-test' || !['http:', 'https:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Go permits only its fixed endpoint or an explicit loopback fixture');
  }
  return url.href;
}

function goRequest(options) {
  if (typeof options.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(options.sessionId)) throw new LlmError('Go requires a stable conversation ID', 'SESSION_REQUIRED');
  const maxTokens = options.maxTokens ?? GO_MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > GO_MAX_OUTPUT_TOKENS) throw new LlmError('Go output limit must be between 1 and 1024 tokens', 'OUTPUT_LIMIT_REQUIRED');
  if (options.temperature !== undefined || options.stop !== undefined || options.reasoningEffort !== undefined) throw new LlmError('This Go route does not accept sampling overrides', 'UNSUPPORTED_REQUEST');
  const tools = responseTools(options.tools)?.[0].tools;
  const input = inputItems(options);
  for (const item of input) if (item.type === 'function_call') delete item.namespace;
  return { model: GO_MODEL, input, store: false, stream: true, include: ['reasoning.encrypted_content'], max_output_tokens: maxTokens, ...(tools ? { tools } : {}) };
}

/** Independent Go API-key identity and fixed destination; never a ChatGPT grant. */
export class OpenCodeGoAdapter extends LlmAdapter {
  #spec;
  constructor(spec) {
    super();
    if (typeof spec?.provider !== 'string' || !spec.provider || typeof spec.getCredential !== 'function' || typeof spec.transport?.request !== 'function') throw new TypeError('Go provider, credential resolver and transport are required');
    this.#spec = Object.freeze({ ...spec, url: goEndpoint(spec.endpoint) });
  }
  #route(provider, model = GO_MODEL) {
    if (provider !== this.#spec.provider) throw new LlmError('Go adapter does not own this route', 'NO_ADAPTER');
    if (model !== GO_MODEL) throw new LlmError('This Go connection supports only gpt-6-luna', 'MODEL_NOT_FOUND');
  }
  async #credential(signal) {
    signal?.throwIfAborted();
    const value = await this.#spec.getCredential();
    if (typeof value?.generation !== 'string' || !value.generation) throw new LlmError('Go authorization is unavailable', 'MISSING_CREDENTIAL');
    const key = assertUsableApiKey(value.key, 'dsh-router-go', 'owned-credential');
    signal?.throwIfAborted();
    return { key, generation: value.generation };
  }
  providerInfo(provider) { this.#route(provider); return { id: provider, name: 'OpenCode Go' }; }
  providerRetryPolicy(provider) { this.#route(provider); return noRetry; }
  async listModels(provider) { return [await this.resolveModel(provider, GO_MODEL)]; }
  async resolveModel(provider, model, signal) {
    this.#route(provider, model); await this.#credential(signal);
    return { provider, id: GO_MODEL, name: 'GPT 6 Luna (OpenCode Go)', inputModalities: ['text'] };
  }
  async prepareCall(provider, model, signal) {
    const info = await this.resolveModel(provider, model, signal);
    const { generation } = await this.#credential(signal);
    return Object.freeze({ model: Object.freeze(info), stream: options => this.#stream(options, generation) });
  }
  stream(options) { return this.#stream(options); }
  async *#stream(options, generation) {
    let response;
    try {
      this.#route(options.provider, options.model);
      const body = JSON.stringify(goRequest(options));
      if (Buffer.byteLength(body) > 256 * 1024) throw new LlmError('Go request is too large', 'REQUEST_TOO_LARGE');
      const credential = await this.#credential(options.signal);
      if (generation !== undefined && generation !== credential.generation) throw new LlmError('Go credential changed after preparation', 'AUTHORIZATION_CHANGED');
      response = await this.#spec.transport.request(this.#spec.url, {
        method: 'POST', headers: {
          ...attributionHeaders({ product: 'irishwei-dsh-router', version, url: 'https://github.com/IRishWei/Router' }),
          'x-opencode-session': options.sessionId, authorization: `Bearer ${credential.key}`,
          'content-type': 'application/json', accept: 'text/event-stream',
        }, body, signal: options.signal, deadline: Date.now() + 60_000,
        maxUploadBytes: 256 * 1024, maxResponseBytes: 4 * 1024 * 1024,
      });
      if (!Number.isInteger(response?.statusCode)) throw new LlmError('Go returned no HTTP status', 'INVALID_RESPONSE');
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const status = response.statusCode;
        throw new LlmError('Go request was rejected; no fallback was attempted', status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : `HTTP_${status}`, { status });
      }
      const mediaType = headerValue(response.headers, 'content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType && mediaType !== 'text/event-stream') throw new LlmError('Go returned an incompatible response format', 'INVALID_RESPONSE');
      yield* translateEvents(sseEvents(response.body, options.signal), { model: GO_MODEL, onCompleted: async () => {} });
    } catch (error) {
      const code = options.signal?.aborted ? 'ABORTED' : safeCodes.has(error?.code) || /^HTTP_[1-5][0-9]{2}$/u.test(error?.code ?? '') ? error.code : 'GO_REQUEST_FAILED';
      throw new LlmError('OpenCode Go request could not complete; no retry or billing fallback was attempted', code);
    } finally { await response?.close?.(); }
  }
}
