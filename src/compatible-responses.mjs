import { LlmAdapter, LlmError, assertUsableApiKey, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { createRequire } from 'node:module';
import { inputItems, responseTools, sseEvents, translateEvents, headerValue } from './chatgpt-responses.mjs';

const { version } = createRequire(import.meta.url)('../package.json');
const noRetry = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'Compatible Responses');
export const COMPATIBLE_OUTPUT_LIMIT = 1024;
const safeCodes = new Set(['ABORTED', 'AUTH', 'AUTHORIZATION_CHANGED', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'NO_ADAPTER', 'RATE_LIMIT', 'TIMEOUT', 'STREAM_CLOSED', 'MALFORMED_RESPONSE', 'INVALID_RESPONSE', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_REQUEST', 'REQUEST_TOO_LARGE', 'SESSION_REQUIRED', 'OUTPUT_LIMIT_REQUIRED', 'SOURCE_TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_PROXY_UNAVAILABLE', 'TOOLS_NOT_DECLARED']);

// Store the API base, never a credential-bearing URL or an OAuth destination.
export function compatibleEndpoint(value) {
  if (typeof value !== 'string') throw new TypeError('A compatible API base URL is required');
  let url; try { url = new URL(value); } catch { throw new TypeError('A compatible API base URL is required'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (value.length > 2000 || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || ['api.openai.com', 'chatgpt.com', 'auth.openai.com'].includes(url.hostname) || /\/(?:responses|chat\/completions|models)\/?$/u.test(url.pathname)) throw new TypeError('Use an API base URL; official API and OAuth connections have separate entries');
  return url.href.replace(/\/+$/u, '');
}
export function compatibleModel(value) {
  if (typeof value !== 'string' || !/^[^\s\x00-\x1f\x7f]{1,200}$/u.test(value)) throw new TypeError('A valid model ID is required');
  return value;
}
export const compatibleFailure = (error, signal) => new LlmError('Compatible Responses request did not complete; no retry or fallback was attempted', signal?.aborted ? 'ABORTED' : safeCodes.has(error?.code) || /^HTTP_[1-5][0-9]{2}$/u.test(error?.code ?? '') ? error.code : 'COMPATIBLE_REQUEST_FAILED');
export function compatibleBody(options, supportsTools) {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(options.sessionId ?? '')) throw new LlmError('A stable conversation ID is required', 'SESSION_REQUIRED');
  const output = options.maxTokens ?? COMPATIBLE_OUTPUT_LIMIT;
  if (!Number.isSafeInteger(output) || output < 1 || output > COMPATIBLE_OUTPUT_LIMIT) throw new LlmError('Compatible output must be between 1 and 1024 tokens', 'OUTPUT_LIMIT_REQUIRED');
  if (options.temperature !== undefined || options.stop !== undefined || options.reasoningEffort !== undefined) throw new LlmError('Sampling overrides are not supported by this route', 'UNSUPPORTED_REQUEST');
  if (options.tools?.length && !supportsTools) throw new LlmError('Tool support has not been declared for this connection', 'TOOLS_NOT_DECLARED');
  const tools = responseTools(options.tools)?.[0].tools;
  const input = inputItems(options);
  for (const item of input) if (item.type === 'function_call') delete item.namespace;
  // Plain text and function history are portable; provider-private reasoning
  // state is excluded from this configurable route.
  return { model: options.model, input: input.filter(item => item.type !== 'reasoning'), store: false, stream: true, max_output_tokens: output, ...(tools ? { tools } : {}) };
}
function checkStatus(response) {
  const status = response?.statusCode;
  if (!Number.isInteger(status)) throw new LlmError('No HTTP status', 'INVALID_RESPONSE');
  if (status < 200 || status >= 300) throw new LlmError('Compatible endpoint rejected the request', status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : `HTTP_${status}`);
}
export class CompatibleResponsesAdapter extends LlmAdapter {
  #spec;
  constructor(spec) { super(); this.#spec = { ...spec, endpoint: compatibleEndpoint(spec.endpoint), model: compatibleModel(spec.model) }; }
  #route(provider, model = this.#spec.model) { if (provider !== this.#spec.provider) throw new LlmError('This adapter does not own the route', 'NO_ADAPTER'); if (model !== this.#spec.model) throw new LlmError('Model is not selected for this connection', 'MODEL_NOT_FOUND'); }
  async #credential(signal) {
    signal?.throwIfAborted(); const value = await this.#spec.getCredential();
    if (!value?.generation) throw new LlmError('Credential is unavailable', 'MISSING_CREDENTIAL');
    const key = assertUsableApiKey(value.key, 'dsh-router-compatible', 'owned-credential'); signal?.throwIfAborted(); return { key, generation: value.generation };
  }
  providerInfo(provider) { this.#route(provider); return { id: provider, name: 'Router · Compatible Responses' }; }
  providerRetryPolicy(provider) { this.#route(provider); return noRetry; }
  async listModels(provider) { return [await this.resolveModel(provider, this.#spec.model)]; }
  async resolveModel(provider, model, signal) { this.#route(provider, model); await this.#credential(signal); return { provider, id: model, name: model, inputModalities: ['text'] }; }
  async prepareCall(provider, model, signal) { const info = await this.resolveModel(provider, model, signal); const { generation } = await this.#credential(signal); return { model: Object.freeze(info), stream: options => this.#stream(options, generation) }; }
  stream(options) { return this.#stream(options); }
  async *#stream(options, generation) {
    let response;
    try {
      this.#route(options.provider, options.model);
      const body = JSON.stringify(compatibleBody(options, this.#spec.tools));
      if (Buffer.byteLength(body) > 256 * 1024) throw new LlmError('Compatible request is too large', 'REQUEST_TOO_LARGE');
      const credential = await this.#credential(options.signal);
      if (generation !== undefined && credential.generation !== generation) throw new LlmError('Credential changed after preparation', 'AUTHORIZATION_CHANGED');
      response = await this.#spec.transport.request(this.#spec.endpoint + '/responses', { method: 'POST', headers: { ...attributionHeaders({ product: 'irishwei-dsh-router', version, url: 'https://github.com/IRishWei/Router' }), 'x-opencode-session': options.sessionId, authorization: `Bearer ${credential.key}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body, signal: options.signal, deadline: Date.now() + 60000, maxUploadBytes: 256 * 1024, maxResponseBytes: 4 * 1024 * 1024 });
      checkStatus(response);
      if (headerValue(response.headers, 'content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'text/event-stream') throw new LlmError('This route requires streaming Responses SSE; Chat Completions is not supported', 'INVALID_RESPONSE');
      yield* translateEvents(sseEvents(response.body, options.signal), { model: this.#spec.model, onCompleted: async () => {} });
    } catch (error) { throw compatibleFailure(error, options.signal); } finally { await response?.close?.(); }
  }
}
export async function discoverCompatibleModels({ endpoint, key, transport, signal }) {
  let response;
  try {
    response = await transport.request(compatibleEndpoint(endpoint) + '/models', { method: 'GET', headers: { authorization: `Bearer ${assertUsableApiKey(key, 'dsh-router-compatible', 'owned-credential')}`, accept: 'application/json', ...attributionHeaders({ product: 'irishwei-dsh-router', version, url: 'https://github.com/IRishWei/Router' }) }, signal, deadline: Date.now() + 10000, maxResponseBytes: 256 * 1024 });
    checkStatus(response); const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += Buffer.byteLength(chunk); if (size > 256 * 1024) throw new LlmError('Catalog is too large', 'INVALID_RESPONSE'); chunks.push(Buffer.from(chunk)); }
    const data = JSON.parse(Buffer.concat(chunks)); if (!Array.isArray(data.data) || data.data.length > 1000) throw new LlmError('Catalog is incompatible', 'INVALID_RESPONSE');
    return [...new Set(data.data.map(item => { const model = compatibleModel(item?.id); if (model.includes(key)) throw new LlmError('Catalog contains credential material', 'INVALID_RESPONSE'); return model; }))];
  } catch (error) { throw compatibleFailure(error, signal); } finally { await response?.close?.(); }
}
