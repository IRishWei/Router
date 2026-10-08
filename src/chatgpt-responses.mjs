import { attributionHeaders, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';

const DEFAULT_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DIAGNOSTIC_BYTES = 64 * 1024;
const NO_RETRY_POLICY = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'ChatGPT Responses retry policy');
const KNOWN_JSON_ERROR_CODES = new Set([
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'subscription_sharing_invalid_user',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
  'subscription_sharing_user_unavailable',
]);
const SUPPORTED_REQUEST_PARAMS = new Set(['model', 'input', 'store', 'stream', 'include', 'tools']);

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function checkAbort(signal) {
  if (signal?.aborted) throw new LlmError('ChatGPT Responses request was aborted', 'ABORTED', { cause: signal.reason });
}

function transportError(error, signal, requestId) {
  if (signal?.aborted) return new LlmError('ChatGPT Responses request was aborted', 'ABORTED', { cause: signal.reason ?? error });
  if (error instanceof LlmError) return error;
  return new LlmError('ChatGPT Responses transport failed', 'TRANSPORT', {
    cause: error,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

function credentialError(error) {
  if (error instanceof LlmError) return error;
  let code;
  try {
    const descriptor = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    code = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { /* Unknown callback failures remain unknown at the native boundary. */ }
  if (code === 'TOKEN_EXPIRED') return new LlmError('ChatGPT access token expired; sign in again', 'TOKEN_EXPIRED');
  return error;
}

function scopesOf(value) {
  if (Array.isArray(value)) return new Set(value.filter(scope => typeof scope === 'string'));
  if (typeof value === 'string') return new Set(value.split(/\s+/u).filter(Boolean));
  return new Set();
}

function credentialSnapshot(value) {
  if (!value || typeof value !== 'object') throw new LlmError('ChatGPT authorization is unavailable', 'MISSING_CREDENTIAL');
  const valid = field => typeof value[field] === 'string' && value[field].length > 0;
  if (!valid('access_token') || !/^[\x21-\x7e]+$/u.test(value.access_token)) {
    throw new LlmError('ChatGPT access credential is unavailable or invalid', 'MISSING_CREDENTIAL');
  }
  if (!valid('client_id') || !valid('subject')) throw new LlmError('ChatGPT authorization identity is invalid', 'MISSING_CREDENTIAL');
  const accessToken = value.access_token;
  const clientId = value.client_id;
  const subject = value.subject;
  if (!scopesOf(value.scopes).has(DIRECT_SCOPE)) {
    throw new LlmError('ChatGPT plan usage is not authorized for this account', 'CHATGPT_PLAN_SCOPE_MISSING');
  }
  return { accessToken, clientId, subject };
}

function catalogSnapshot(value, credential) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.models)) {
    throw new LlmError('ChatGPT account model catalog is unavailable', 'INVALID_CATALOG');
  }
  if (!value.identity || value.identity.client_id !== credential.clientId || value.identity.subject !== credential.subject) {
    throw new LlmError('ChatGPT account model catalog belongs to another authorization', 'AUTHORIZATION_CHANGED');
  }
  const seen = new Set();
  const models = value.models.map(raw => {
    const slug = raw?.slug;
    const displayName = raw?.display_name ?? raw?.displayName;
    if (typeof slug !== 'string' || slug.length === 0 || typeof displayName !== 'string' || displayName.length === 0) {
      throw new LlmError('ChatGPT account catalog contains invalid model metadata', 'INVALID_CATALOG');
    }
    if (seen.has(slug)) throw new LlmError(`ChatGPT catalog repeats model ${JSON.stringify(slug)}`, 'INVALID_CATALOG');
    seen.add(slug);
    return Object.freeze({ slug, displayName });
  });
  return Object.freeze({ identity: Object.freeze({ clientId: credential.clientId, subject: credential.subject }), models: Object.freeze(models) });
}

function exactModel(catalog, model) {
  const found = catalog.models.find(entry => entry.slug === model);
  if (!found) throw new LlmError(`ChatGPT account catalog does not list model ${JSON.stringify(model)}`, 'MODEL_NOT_FOUND');
  return found;
}

function sameIdentity(a, b) {
  return a.clientId === b.clientId && a.subject === b.subject;
}

function textContent(content, kind) {
  if (!Array.isArray(content)) throw new LlmError(`${kind} content is invalid`, 'UNSUPPORTED_CONTENT');
  const result = [];
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') {
      throw new LlmError(`${kind} contains content that cannot be sent through ChatGPT Responses`, 'UNSUPPORTED_CONTENT');
    }
    result.push({ type: 'input_text', text: block.text });
  }
  return result;
}

function replayItems(message, provider, model) {
  if (message.role !== 'assistant' || message.source?.provider !== provider || message.source?.model !== model) return undefined;
  const response = message.source?.replayState?.response;
  if (!response || response.version !== 1 || response.model !== model || !Array.isArray(response.items)) return undefined;
  const visible = [];
  for (const item of response.items) {
    if (item?.type === 'reasoning') continue;
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type !== 'output_text' || typeof part.text !== 'string') return undefined;
        visible.push({ type: 'text', text: part.text });
      }
      continue;
    }
    if (item?.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string' && typeof item.arguments === 'string') {
      visible.push({ type: 'tool-call', id: item.call_id, name: item.name, arguments: item.arguments });
      continue;
    }
    return undefined;
  }
  if (JSON.stringify(visible) !== JSON.stringify(message.content)) return undefined;
  return structuredClone(response.items);
}

function inputItems(options) {
  const result = [];
  if (options.system !== undefined) {
    if (typeof options.system !== 'string') throw new LlmError('Responses system instructions must be text', 'UNSUPPORTED_CONTENT');
    if (options.system.length > 0) result.push({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: options.system }] });
  }
  for (const message of options.messages) {
    if (message.role === 'assistant') {
      const replay = replayItems(message, options.provider, options.model);
      if (replay !== undefined) {
        result.push(...replay);
        continue;
      }
      for (const block of message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          result.push({ type: 'message', role: 'assistant', content: [{ type: 'input_text', text: block.text }] });
        } else if (block?.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string' && typeof block.arguments === 'string') {
          result.push({ type: 'function_call', call_id: block.id, name: block.name, namespace: 'functions', arguments: block.arguments });
        } else {
          throw new LlmError('Assistant history contains content that cannot be sent through ChatGPT Responses', 'UNSUPPORTED_CONTENT');
        }
      }
      continue;
    }
    if (message.role === 'tool') {
      const output = textContent(message.content, 'Tool result');
      if (message.isError) output.unshift({ type: 'input_text', text: '[Tool execution failed]' });
      result.push({
        type: 'function_call_output',
        call_id: requiredString(message.toolCallId, 'tool result call id'),
        output,
      });
      continue;
    }
    const role = message.role === 'system' ? 'developer' : message.role;
    if (role !== 'developer' && role !== 'user') throw new LlmError(`Unsupported message role ${JSON.stringify(message.role)}`, 'UNSUPPORTED_CONTENT');
    const content = textContent(message.content, `${message.role} message`);
    if (content.length > 0) result.push({ type: 'message', role, content });
  }
  return result;
}

function responseTools(tools) {
  if (tools === undefined || tools.length === 0) return undefined;
  return [{
    type: 'namespace',
    name: 'functions',
    description: 'Functions provided by the DeepSeek Harness for this task.',
    tools: tools.map(tool => {
      const name = requiredString(tool?.name, 'tool.name');
      if (!/^[A-Za-z0-9_-]+$/u.test(name) || !tool?.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) {
        throw new LlmError(`Tool ${JSON.stringify(name)} cannot be represented as a Responses function`, 'UNSUPPORTED_CONTENT');
      }
      return {
        type: 'function',
        name,
        description: requiredString(tool?.description, `tool ${name} description`),
        parameters: structuredClone(tool.parameters),
        strict: false,
      };
    }),
  }];
}

function requestBody(options) {
  if (options.temperature !== undefined || options.stop !== undefined || options.reasoningEffort !== undefined) {
    throw new LlmError('ChatGPT plan Responses does not support requested sampling controls', 'UNSUPPORTED_REQUEST');
  }
  const tools = responseTools(options.tools);
  return {
    model: options.model,
    input: inputItems(options),
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    ...(tools === undefined ? {} : { tools }),
  };
}

function headerValue(headers, name) {
  if (headers?.get) return headers.get(name) ?? undefined;
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] === undefined ? undefined : String(entry[1]);
}

function requestIdOf(headers) {
  const value = headerValue(headers, 'x-request-id');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function contentTypeClass(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'missing';
  const mediaType = mediaTypeOf(value);
  if (mediaType === 'application/json' || mediaType === 'text/html') return mediaType;
  return 'other';
}

function mediaTypeOf(value) {
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : undefined;
}

function timeoutError() {
  return new LlmError('ChatGPT Responses request timed out', 'TIMEOUT');
}

async function boundedNext(iterator, signal, deadline) {
  checkAbort(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError();
  let timer;
  let onAbort;
  try {
    const interrupted = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), remaining);
      if (signal) {
        onAbort = () => {
          try { checkAbort(signal); } catch (error) { reject(error); }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
    });
    return await Promise.race([iterator.next(), interrupted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function classifyJsonDiagnostic(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return 'body shape: invalid-json'; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'body shape: other';
  if (raw.error && typeof raw.error === 'object' && !Array.isArray(raw.error)) {
    const code = typeof raw.error.code === 'string'
      ? KNOWN_JSON_ERROR_CODES.has(raw.error.code) ? raw.error.code : 'unknown'
      : 'none';
    const param = typeof raw.error.param === 'string'
      ? SUPPORTED_REQUEST_PARAMS.has(raw.error.param) ? raw.error.param : 'unknown'
      : 'none';
    return `body shape: error-object; code: ${code}; param: ${param}`;
  }
  if (Object.hasOwn(raw, 'detail')) return 'body shape: detail-object';
  if (Object.hasOwn(raw, 'response')) return 'body shape: response-object';
  return 'body shape: other';
}

async function jsonDiagnostic(body, signal, deadline) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') return 'body shape: invalid-json';
  const iterator = body[Symbol.asyncIterator]();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value: chunk } = await boundedNext(iterator, signal, deadline);
    if (done) break;
    checkAbort(signal);
    if (!(chunk instanceof Uint8Array)) throw new LlmError('Responses transport returned a non-byte body', 'INVALID_RESPONSE');
    bytes += chunk.byteLength;
    if (bytes > MAX_JSON_DIAGNOSTIC_BYTES) return 'body shape: too-large';
    chunks.push(chunk);
  }
  checkAbort(signal);
  return classifyJsonDiagnostic(Buffer.concat(chunks).toString('utf8'));
}

async function readBody(body, signal) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of body) {
    checkAbort(signal);
    if (!(chunk instanceof Uint8Array)) throw new LlmError('Responses transport returned a non-byte body', 'INVALID_RESPONSE');
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new LlmError('Responses body exceeds the configured limit', 'INVALID_RESPONSE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function providerFailure(raw, status, requestId) {
  const error = raw?.error && typeof raw.error === 'object' ? raw.error : undefined;
  const detail = typeof raw?.detail === 'string' ? raw.detail : undefined;
  const code = typeof error?.code === 'string' && error.code.length > 0
    ? error.code
    : status === 429 ? 'RATE_LIMIT' : status === 401 ? 'AUTH' : status === 403 ? 'AUTHORIZATION_FAILED' : status >= 500 ? 'SERVER' : `HTTP_${status}`;
  const baseMessage = typeof error?.message === 'string' && error.message.length > 0
    ? error.message
    : detail ?? `ChatGPT Responses request failed with HTTP ${status}`;
  const message = typeof error?.param === 'string' && error.param.length > 0
    ? `${baseMessage} (parameter: ${error.param})`
    : baseMessage;
  return new LlmError(message, code, { status, ...(requestId === undefined ? {} : { requestId }) });
}

function eventFailure(event, requestId, fallbackCode) {
  const response = event?.response;
  const error = response?.error ?? event?.error ?? event;
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : fallbackCode;
  const baseMessage = typeof error?.message === 'string' && error.message.length > 0
    ? error.message
    : event?.response?.incomplete_details?.reason
      ? `ChatGPT Responses was incomplete: ${event.response.incomplete_details.reason}`
      : `ChatGPT Responses stream ended with ${event?.type ?? fallbackCode}`;
  const message = typeof error?.param === 'string' && error.param.length > 0
    ? `${baseMessage} (parameter: ${error.param})`
    : baseMessage;
  return new LlmError(message, code, requestId === undefined ? undefined : { requestId });
}

function usageOf(raw) {
  if (raw === undefined || raw === null) return undefined;
  const input = raw.input_tokens;
  const output = raw.output_tokens;
  const total = raw.total_tokens;
  const cached = raw.input_tokens_details?.cached_tokens;
  const written = raw.input_tokens_details?.cache_write_tokens;
  const reasoning = raw.output_tokens_details?.reasoning_tokens;
  for (const [name, value] of Object.entries({ input_tokens: input, output_tokens: output })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new LlmError(`Responses usage has invalid ${name}`, 'INVALID_RESPONSE');
  }
  for (const [name, value] of Object.entries({ total_tokens: total, cached_tokens: cached, cache_write_tokens: written, reasoning_tokens: reasoning })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new LlmError(`Responses usage has invalid ${name}`, 'INVALID_RESPONSE');
  }
  const cacheReadTokens = cached ?? 0;
  const cacheWriteTokens = written ?? 0;
  const uncached = input - cacheReadTokens - cacheWriteTokens;
  if (uncached < 0) throw new LlmError('Responses usage cache details exceed input tokens', 'INVALID_RESPONSE');
  return {
    inputTokens: uncached,
    outputTokens: output,
    ...(cached === undefined ? {} : { cacheReadTokens }),
    ...(written === undefined ? {} : { cacheWriteTokens }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
    ...(total === undefined ? {} : { totalTokens: total }),
  };
}

async function* sseEvents(body, signal) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffered = '';
  let data = [];
  let bytes = 0;
  const flushLine = line => {
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''));
  };
  for await (const chunk of body) {
    checkAbort(signal);
    if (!(chunk instanceof Uint8Array)) throw new LlmError('Responses transport returned a non-byte stream', 'INVALID_RESPONSE');
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new LlmError('Responses stream exceeds the configured limit', 'INVALID_RESPONSE');
    try { buffered += decoder.decode(chunk, { stream: true }); }
    catch (error) { throw new LlmError('Responses stream is not valid UTF-8', 'MALFORMED_RESPONSE', { cause: error }); }
    while (true) {
      const match = /\r?\n/u.exec(buffered);
      if (!match) break;
      const line = buffered.slice(0, match.index);
      buffered = buffered.slice(match.index + match[0].length);
      if (line === '') {
        if (data.length > 0) {
          const payload = data.join('\n');
          data = [];
          if (payload !== '[DONE]') {
            try { yield JSON.parse(payload); }
            catch (error) { throw new LlmError('Responses stream contains invalid JSON', 'MALFORMED_RESPONSE', { cause: error }); }
          }
        }
      } else flushLine(line);
    }
  }
  try { buffered += decoder.decode(); }
  catch (error) { throw new LlmError('Responses stream is not valid UTF-8', 'MALFORMED_RESPONSE', { cause: error }); }
  if (buffered.length > 0) flushLine(buffered.replace(/\r$/u, ''));
  if (data.length > 0) {
    const payload = data.join('\n');
    if (payload !== '[DONE]') {
      try { yield JSON.parse(payload); }
      catch (error) { throw new LlmError('Responses stream contains invalid JSON', 'MALFORMED_RESPONSE', { cause: error }); }
    }
  }
}

function safeReplayItems(output) {
  if (!Array.isArray(output)) throw new LlmError('Completed Responses output is missing', 'INVALID_RESPONSE');
  for (const item of output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content) || item.content.some(part => part?.type !== 'output_text' || typeof part.text !== 'string')) {
        throw new LlmError('Responses produced unsupported assistant content', 'UNSUPPORTED_CONTENT');
      }
      continue;
    }
    if (item?.type === 'function_call') {
      if (item.namespace !== undefined && item.namespace !== 'functions') throw new LlmError('Responses called an unknown tool namespace', 'UNSUPPORTED_CONTENT');
      if (typeof item.call_id === 'string' && item.call_id.length > 0 && typeof item.name === 'string' && item.name.length > 0 && typeof item.arguments === 'string') continue;
      throw new LlmError('Responses produced an invalid function call', 'INVALID_RESPONSE');
    }
    throw new LlmError(`Responses produced unsupported output item ${JSON.stringify(item?.type)}`, 'UNSUPPORTED_CONTENT');
  }
  return structuredClone(output);
}

function visibleBlocks(items) {
  const result = [];
  for (const item of items) {
    if (item.type === 'message') for (const part of item.content) result.push({ type: 'text', text: part.text });
    if (item.type === 'function_call') result.push({ type: 'tool-call', id: item.call_id, name: item.name, arguments: item.arguments });
  }
  return result;
}

async function* translateEvents(events, { model, requestId, onCompleted }) {
  const blocks = new Map();
  let nextIndex = 0;
  let completed;
  let toolCalls = false;
  const block = (key, type, details = {}) => {
    let current = blocks.get(key);
    if (current) return current;
    current = { index: nextIndex++, type, text: '', ...details, started: false, closed: false };
    blocks.set(key, current);
    return current;
  };
  for await (const event of events) {
    checkAbort(event?.signal);
    if (!event || typeof event.type !== 'string') throw new LlmError('Responses stream contains an invalid event', 'MALFORMED_RESPONSE');
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new LlmError('Responses text delta is invalid', 'MALFORMED_RESPONSE');
      const current = block(`text:${event.item_id}:${event.content_index ?? 0}`, 'text');
      if (current.closed) throw new LlmError('Responses text continued after completion', 'MALFORMED_RESPONSE');
      if (!current.started) {
        current.started = true;
        yield { type: 'block-start', index: current.index, blockType: 'text' };
      }
      current.text += event.delta;
      yield { type: 'text-delta', index: current.index, text: event.delta };
      continue;
    }
    if (event.type === 'response.output_text.done') {
      if (typeof event.text !== 'string') throw new LlmError('Responses final text is invalid', 'MALFORMED_RESPONSE');
      const current = block(`text:${event.item_id}:${event.content_index ?? 0}`, 'text');
      if (current.closed) throw new LlmError('Responses repeated final text', 'MALFORMED_RESPONSE');
      if (!current.started) {
        current.started = true;
        yield { type: 'block-start', index: current.index, blockType: 'text' };
      }
      if (!event.text.startsWith(current.text)) throw new LlmError('Responses final text disagrees with streamed text', 'MALFORMED_RESPONSE');
      const suffix = event.text.slice(current.text.length);
      if (suffix) yield { type: 'text-delta', index: current.index, text: suffix };
      current.text = event.text;
      current.closed = true;
      yield { type: 'block-end', index: current.index, block: { type: 'text', text: current.text } };
      continue;
    }
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      if (event.item.namespace !== undefined && event.item.namespace !== 'functions') throw new LlmError('Responses called an unknown tool namespace', 'UNSUPPORTED_CONTENT');
      const id = requiredString(event.item.call_id, 'Responses tool call id');
      const name = requiredString(event.item.name, 'Responses tool call name');
      const current = block(`tool:${event.item.id ?? id}`, 'tool-call', { id, name });
      if (current.started) throw new LlmError('Responses repeated a function call start', 'MALFORMED_RESPONSE');
      current.started = true;
      toolCalls = true;
      yield { type: 'block-start', index: current.index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: current.index, id, name, argumentsDelta: '' };
      continue;
    }
    if (event.type === 'response.function_call_arguments.delta') {
      if (typeof event.delta !== 'string') throw new LlmError('Responses tool arguments delta is invalid', 'MALFORMED_RESPONSE');
      const key = `tool:${event.item_id}`;
      const current = blocks.get(key);
      if (!current || current.type !== 'tool-call' || current.closed) throw new LlmError('Responses tool delta has no open function call', 'MALFORMED_RESPONSE');
      current.text += event.delta;
      yield { type: 'tool-call-delta', index: current.index, id: current.id, argumentsDelta: event.delta };
      continue;
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const key = `tool:${event.item.id ?? event.item.call_id}`;
      const current = blocks.get(key);
      if (!current || current.type !== 'tool-call' || current.closed) throw new LlmError('Responses completed an unknown function call', 'MALFORMED_RESPONSE');
      if (event.item.call_id !== current.id || event.item.name !== current.name || typeof event.item.arguments !== 'string' || !event.item.arguments.startsWith(current.text)) {
        throw new LlmError('Responses final function call disagrees with streamed call', 'MALFORMED_RESPONSE');
      }
      const suffix = event.item.arguments.slice(current.text.length);
      if (suffix) yield { type: 'tool-call-delta', index: current.index, id: current.id, argumentsDelta: suffix };
      current.text = event.item.arguments;
      current.closed = true;
      yield { type: 'block-end', index: current.index, block: { type: 'tool-call', id: current.id, name: current.name, arguments: current.text } };
      continue;
    }
    if (event.type === 'response.failed' || event.type === 'response.incomplete') {
      const usage = usageOf(event.response?.usage);
      if (usage) yield { type: 'usage', usage };
      throw eventFailure(event, requestId, event.type === 'response.incomplete' ? 'RESPONSE_INCOMPLETE' : 'RESPONSE_FAILED');
    }
    if (event.type === 'error') throw eventFailure(event, requestId, 'RESPONSES_ERROR');
    if (event.type === 'response.completed') {
      if (completed) throw new LlmError('Responses stream repeated response.completed', 'MALFORMED_RESPONSE');
      if (event.response?.status !== 'completed') throw new LlmError('response.completed carried a non-completed response', 'MALFORMED_RESPONSE');
      for (const current of blocks.values()) if (!current.closed) throw new LlmError('response.completed arrived with unfinished output blocks', 'MALFORMED_RESPONSE');
      completed = event.response;
      const replay = safeReplayItems(completed.output);
      const authoritative = visibleBlocks(replay);
      const streamed = [...blocks.values()].sort((a, b) => a.index - b.index).map(current => current.type === 'text'
        ? { type: 'text', text: current.text }
        : { type: 'tool-call', id: current.id, name: current.name, arguments: current.text });
      if (streamed.length === 0 && authoritative.length > 0) {
        for (const value of authoritative) {
          const current = block(`completed:${nextIndex}`, value.type, value.type === 'tool-call' ? { id: value.id, name: value.name } : {});
          current.text = value.type === 'text' ? value.text : value.arguments;
          current.started = true;
          current.closed = true;
          yield { type: 'block-start', index: current.index, blockType: value.type };
          if (value.type === 'text') yield { type: 'text-delta', index: current.index, text: value.text };
          else yield { type: 'tool-call-delta', index: current.index, id: value.id, name: value.name, argumentsDelta: value.arguments };
          yield { type: 'block-end', index: current.index, block: value };
        }
      } else if (JSON.stringify(streamed) !== JSON.stringify(authoritative)) {
        throw new LlmError('Completed Responses output disagrees with streamed output', 'MALFORMED_RESPONSE');
      }
      const usage = usageOf(completed.usage);
      await onCompleted(usage);
      if (usage) yield { type: 'usage', usage };
      yield {
        type: 'finish',
        reason: { kind: toolCalls || replay.some(item => item.type === 'function_call') ? 'tool-calls' : 'stop' },
        replayState: {
          response: { version: 1, model, items: replay },
          blocks: [...blocks.values()].sort((a, b) => a.index - b.index).map(() => null),
        },
      };
      continue;
    }
    if (event.type.includes('refusal')) throw new LlmError('Responses returned refusal content that cannot be represented safely', 'UNSUPPORTED_CONTENT');
  }
  if (!completed) throw new LlmError('Responses stream ended without response.completed', 'STREAM_CLOSED', requestId === undefined ? undefined : { requestId });
}

export class ChatGptResponsesAdapter extends LlmAdapter {
  #spec;

  constructor(spec) {
    super();
    if (!spec || typeof spec !== 'object') throw new TypeError('ChatGPT Responses adapter options are required');
    const responsesURL = new URL(spec.responsesURL ?? DEFAULT_RESPONSES_URL);
    const loopback = ['http:', 'https:'].includes(responsesURL.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(responsesURL.hostname);
    const official = responsesURL.protocol === 'https:' && responsesURL.hostname === 'api.openai.com'
      && responsesURL.pathname === '/v1/responses' && responsesURL.username === '' && responsesURL.password === ''
      && responsesURL.search === '' && responsesURL.hash === '';
    if (!official && !loopback) {
      throw new TypeError('ChatGPT Responses URL must be the official endpoint or loopback');
    }
    this.#spec = Object.freeze({
      provider: requiredString(spec.provider, 'provider'),
      accountId: requiredString(spec.accountId, 'accountId'),
      getAuthorizedCredential: spec.getAuthorizedCredential,
      getCatalog: spec.getCatalog,
      transport: spec.transport,
      responsesURL: responsesURL.href,
      onInferenceCompleted: spec.onInferenceCompleted,
    });
    for (const name of ['getAuthorizedCredential', 'getCatalog', 'transport']) {
      if (typeof this.#spec[name] !== 'function') throw new TypeError(`${name} must be a function`);
    }
    if (this.#spec.onInferenceCompleted !== undefined && typeof this.#spec.onInferenceCompleted !== 'function') {
      throw new TypeError('onInferenceCompleted must be a function');
    }
  }

  providerInfo(provider) {
    this.#assertProvider(provider);
    return { id: provider, name: `ChatGPT (${this.#spec.accountId})` };
  }

  providerRetryPolicy(provider) {
    this.#assertProvider(provider);
    return NO_RETRY_POLICY;
  }

  async #current(signal) {
    checkAbort(signal);
    let rawCredential;
    try {
      rawCredential = await this.#spec.getAuthorizedCredential({ provider: this.#spec.provider, accountId: this.#spec.accountId, signal });
    } catch (error) {
      throw credentialError(error);
    }
    const credential = credentialSnapshot(rawCredential);
    checkAbort(signal);
    const catalog = catalogSnapshot(await this.#spec.getCatalog({ provider: this.#spec.provider, accountId: this.#spec.accountId, signal }), credential);
    checkAbort(signal);
    return { credential, catalog };
  }

  async listModels(provider) {
    this.#assertProvider(provider);
    const { catalog } = await this.#current();
    return catalog.models.map(model => ({ provider, id: model.slug, name: model.displayName, inputModalities: ['text'] }));
  }

  async resolveModel(provider, model, signal) {
    this.#assertProvider(provider);
    const { catalog } = await this.#current(signal);
    const found = exactModel(catalog, model);
    return { provider, id: found.slug, name: found.displayName, inputModalities: ['text'] };
  }

  async prepareCall(provider, model, signal) {
    this.#assertProvider(provider);
    const captured = await this.#current(signal);
    const found = exactModel(captured.catalog, model);
    const identity = captured.catalog.identity;
    return Object.freeze({
      model: Object.freeze({ provider, id: found.slug, name: found.displayName, inputModalities: Object.freeze(['text']) }),
      stream: options => this.#dispatch(options, identity),
    });
  }

  stream(options) {
    return this.#dispatch(options);
  }

  async *#dispatch(options, preparedIdentity) {
    this.#assertProvider(options.provider);
    checkAbort(options.signal);
    const current = await this.#current(options.signal);
    exactModel(current.catalog, options.model);
    if (preparedIdentity && !sameIdentity(preparedIdentity, current.catalog.identity)) {
      throw new LlmError('ChatGPT authorization changed after call preparation', 'AUTHORIZATION_CHANGED');
    }
    const body = JSON.stringify(requestBody(options));
    if (Buffer.byteLength(body) > MAX_UPLOAD_BYTES) throw new LlmError('Responses request exceeds the configured limit', 'REQUEST_TOO_LARGE');
    let response;
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    try {
      response = await this.#spec.transport(this.#spec.responsesURL, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          authorization: `Bearer ${current.credential.accessToken}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body,
        deadline,
        signal: options.signal,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxUploadBytes: MAX_UPLOAD_BYTES,
      });
    } catch (error) {
      throw transportError(error, options.signal);
    }
    const requestId = requestIdOf(response?.headers);
    try {
      if (!Number.isInteger(response?.statusCode)) throw new LlmError('Responses transport returned no HTTP status', 'INVALID_RESPONSE');
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const text = await readBody(response.body, options.signal);
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        throw providerFailure(parsed, response.statusCode, requestId);
      }
      const contentType = headerValue(response.headers, 'content-type');
      const classification = contentTypeClass(contentType);
      // Like the official SDK's stream:true path, decode an unlabelled body as
      // SSE. A missing media type alone cannot disprove a Responses stream;
      // only the validated response.completed event below proves success.
      if (mediaTypeOf(contentType) !== 'text/event-stream' && classification !== 'missing') {
        let diagnostic;
        if (classification === 'application/json') {
          try {
            diagnostic = await jsonDiagnostic(response.body, options.signal, deadline);
          } catch (error) {
            throw transportError(error, options.signal, requestId);
          }
        }
        const suffix = diagnostic === undefined ? '' : `; ${diagnostic}`;
        throw new LlmError(`Responses endpoint did not return an event stream (content type: ${classification}${suffix})`, 'INVALID_RESPONSE', { status: response.statusCode, ...(requestId === undefined ? {} : { requestId }) });
      }
      const onCompleted = async usage => {
        if (!this.#spec.onInferenceCompleted) return;
        try {
          await this.#spec.onInferenceCompleted({ provider: this.#spec.provider, accountId: this.#spec.accountId, model: options.model, usage });
        } catch { /* completion remains authoritative even if verification persistence fails */ }
      };
      try {
        yield* translateEvents(sseEvents(response.body, options.signal), { model: options.model, requestId, onCompleted });
      } catch (error) {
        throw transportError(error, options.signal, requestId);
      }
    } finally {
      await response?.close?.();
    }
  }

  #assertProvider(provider) {
    if (provider !== this.#spec.provider) throw new LlmError(`ChatGPT adapter does not own provider ${JSON.stringify(provider)}`, 'NO_ADAPTER');
  }
}

export function createChatGptResponsesAdapter(spec) {
  return new ChatGptResponsesAdapter(spec);
}
