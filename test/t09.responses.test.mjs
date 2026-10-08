import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import { createChatGptResponsesAdapter } from '../src/chatgpt-responses.mjs';

const encoder = new TextEncoder();

function streamBody(text, cuts = [text.length]) {
  return (async function* () {
    let offset = 0;
    for (const size of cuts) {
      if (offset >= text.length) break;
      yield encoder.encode(text.slice(offset, offset + size));
      offset += size;
    }
    if (offset < text.length) yield encoder.encode(text.slice(offset));
  })();
}

function sse(...events) {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function fixture({ events, credential, catalog, onInferenceCompleted } = {}) {
  const requests = [];
  const currentCredential = credential ?? {
    access_token: 'oauth-test-token',
    client_id: 'client-1',
    subject: 'subject-1',
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
  };
  const currentCatalog = catalog ?? {
    identity: { client_id: 'client-1', subject: 'subject-1' },
    models: [{ slug: 'gpt-test', display_name: 'GPT Test' }],
  };
  const adapter = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1',
    accountId: 'account-1',
    getAuthorizedCredential: async () => currentCredential,
    getCatalog: async () => currentCatalog,
    transport: async (url, options) => {
      requests.push({ url, options, json: JSON.parse(options.body) });
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-1' },
        body: streamBody(sse(...events), [1, 2, 5, 3, 8, 13]),
      };
    },
    onInferenceCompleted,
  });
  return { adapter, requests, currentCredential, currentCatalog };
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

test('a prepared Responses call sends complete text history and succeeds only at response.completed', async () => {
  const completed = {
    id: 'resp-1',
    status: 'completed',
    output: [{ type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK' }] }],
    usage: { input_tokens: 9, input_tokens_details: { cached_tokens: 2 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 12 },
  };
  const { adapter, requests } = fixture({ events: [
    { type: 'response.output_text.delta', item_id: 'msg-1', output_index: 0, content_index: 0, delta: 'O' },
    { type: 'response.output_text.delta', item_id: 'msg-1', output_index: 0, content_index: 0, delta: 'K' },
    { type: 'response.output_text.done', item_id: 'msg-1', output_index: 0, content_index: 0, text: 'OK' },
    { type: 'response.completed', response: completed },
  ] });
  const prepared = await adapter.prepareCall('router-chatgpt-account-1', 'gpt-test');
  assert.equal(prepared.model.name, 'GPT Test');
  const chunks = await collect(prepared.stream({
    provider: 'router-chatgpt-account-1',
    model: 'gpt-test',
    messages: [
      createSystemMessage('Obey the project rules.'),
      createUserMessage({ content: [{ type: 'text', text: 'Reply OK' }] }),
    ],
    maxTokens: 32,
  }));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].options.headers.authorization, 'Bearer oauth-test-token');
  assert.deepEqual(requests[0].json, {
    model: 'gpt-test',
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Obey the project rules.' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply OK' }] },
    ],
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
  });
  assert.deepEqual(chunks.slice(0, 4), [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'O' },
    { type: 'text-delta', index: 0, text: 'K' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'OK' } },
  ]);
  assert.deepEqual(chunks.at(-2), {
    type: 'usage',
    usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, reasoningTokens: 1, totalTokens: 12 },
  });
  assert.equal(chunks.at(-1).type, 'finish');
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('function namespaces and call ids survive a complete tool round trip', async () => {
  const requests = [];
  const batches = [
    [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'lookup', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc-1', output_index: 0, delta: '{"term":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc-1', output_index: 0, delta: '"router"}' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'lookup', arguments: '{"term":"router"}', status: 'completed' } },
      { type: 'response.completed', response: { id: 'resp-tools', status: 'completed', output: [{ type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'lookup', arguments: '{"term":"router"}', status: 'completed' }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } },
    ],
    [
      { type: 'response.output_text.delta', item_id: 'msg-2', output_index: 0, content_index: 0, delta: 'FOUND' },
      { type: 'response.output_text.done', item_id: 'msg-2', output_index: 0, content_index: 0, text: 'FOUND' },
      { type: 'response.completed', response: { id: 'resp-final', status: 'completed', output: [{ type: 'message', id: 'msg-2', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'FOUND' }] }], usage: { input_tokens: 16, output_tokens: 2, total_tokens: 18 } } },
    ],
  ];
  const adapter = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1', accountId: 'account-1',
    getAuthorizedCredential: async () => ({ access_token: 'token', client_id: 'client-1', subject: 'subject-1', scopes: DIRECT_SCOPES }),
    getCatalog: async () => ({ identity: { client_id: 'client-1', subject: 'subject-1' }, models: [{ slug: 'gpt-test', display_name: 'GPT Test' }] }),
    transport: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return { statusCode: 200, headers: { 'content-type': 'text/event-stream' }, body: streamBody(sse(...batches.shift()), [7, 1, 9, 2]) };
    },
  });
  const tools = [{ name: 'lookup', description: 'Look up a term', parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] } }];
  const user = createUserMessage({ content: [{ type: 'text', text: 'Use lookup' }] });
  const first = await collect(adapter.stream({ provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [user], tools }));
  const call = first.find(chunk => chunk.type === 'block-end').block;
  const finish = first.at(-1);
  assert.deepEqual(call, { type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{"term":"router"}' });
  assert.equal(finish.reason.kind, 'tool-calls');

  const assistant = createAssistantMessage({ content: [call], source: { provider: 'router-chatgpt-account-1', model: 'gpt-test', replayState: finish.replayState } });
  const toolResult = createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'found' }], isError: false });
  const second = await collect(adapter.stream({ provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [user, assistant, toolResult], tools }));

  assert.deepEqual(requests[0].tools, [{
    type: 'namespace', name: 'functions', description: 'Functions provided by the DeepSeek Harness for this task.',
    tools: [{ type: 'function', name: 'lookup', description: 'Look up a term', parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] }, strict: false }],
  }]);
  assert.deepEqual(requests[1].input.slice(1), [
    { type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'lookup', arguments: '{"term":"router"}', status: 'completed' },
    { type: 'function_call_output', call_id: 'call-1', output: [{ type: 'input_text', text: 'found' }] },
  ]);
  assert.equal(second.find(chunk => chunk.type === 'block-end').block.text, 'FOUND');
});

const DIRECT_SCOPES = ['openid', 'chatgpt.tokens.use.direct'];

test('a prepared call refuses an identity change before HTTP dispatch', async () => {
  let identity = { client_id: 'client-1', subject: 'subject-1' };
  let requests = 0;
  const adapter = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1', accountId: 'account-1',
    getAuthorizedCredential: async () => ({ access_token: 'token', ...identity, scopes: DIRECT_SCOPES }),
    getCatalog: async () => ({ identity, models: [{ slug: 'gpt-test', display_name: 'GPT Test' }] }),
    transport: async () => { requests += 1; throw new Error('must not dispatch'); },
  });
  const prepared = await adapter.prepareCall('router-chatgpt-account-1', 'gpt-test');
  identity = { client_id: 'client-2', subject: 'subject-2' };
  await assert.rejects(async () => collect(prepared.stream({
    provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'Do not send' }] })],
  })), error => error?.failure?.code === 'AUTHORIZATION_CHANGED');
  assert.equal(requests, 0);
});

test('structured admission errors preserve exact code, status, request id, and zero retries', async () => {
  let requests = 0;
  let closes = 0;
  const adapter = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1', accountId: 'account-1',
    getAuthorizedCredential: async () => ({ access_token: 'token', client_id: 'client-1', subject: 'subject-1', scopes: DIRECT_SCOPES }),
    getCatalog: async () => ({ identity: { client_id: 'client-1', subject: 'subject-1' }, models: [{ slug: 'gpt-test', display_name: 'GPT Test' }] }),
    transport: async () => {
      requests += 1;
      return {
        statusCode: 429,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-limit' },
        body: streamBody(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'usage limit reached', param: null } }), [3, 1, 4]),
        close: async () => { closes += 1; },
      };
    },
  });
  await assert.rejects(async () => collect(adapter.stream({
    provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'one attempt' }] })],
  })), error => {
    assert.equal(error.failure.code, 'subscription_sharing_usage_limit_exceeded');
    assert.equal(error.failure.status, 429);
    assert.equal(error.failure.requestId, 'req-limit');
    return true;
  });
  assert.equal(requests, 1);
  assert.equal(closes, 1);
  assert.equal(adapter.providerRetryPolicy('router-chatgpt-account-1').maxRetries, 0);
});

test('an in-stream failure emits known usage before preserving its exact error', async () => {
  const { adapter } = fixture({ events: [
    { type: 'response.failed', response: {
      id: 'resp-failed', status: 'failed',
      error: { code: 'subscription_sharing_usage_unavailable', message: 'usage check unavailable' },
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }, output_tokens: 4, output_tokens_details: { reasoning_tokens: 2 }, total_tokens: 16 },
    } },
  ] });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({
      provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'fail after admission' }] })],
    })) chunks.push(chunk);
  }, error => error?.failure?.code === 'subscription_sharing_usage_unavailable');
  assert.deepEqual(chunks, [{ type: 'usage', usage: {
    inputTokens: 7, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 2, totalTokens: 16,
  } }]);
});

test('an interrupted SSE stream keeps partial text and fails without inventing usage', async () => {
  const { adapter } = fixture({ events: [
    { type: 'response.output_text.delta', item_id: 'msg-partial', output_index: 0, content_index: 0, delta: 'PARTIAL' },
  ] });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({
      provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'interrupt' }] })],
    })) chunks.push(chunk);
  }, error => {
    assert.equal(error.failure.code, 'STREAM_CLOSED');
    assert.equal(error.failure.requestId, 'req-1');
    return true;
  });
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'PARTIAL' },
  ]);
  assert.equal(chunks.some(chunk => chunk.type === 'usage'), false);
});

test('original cancellation closes the active transport and reports ABORTED', async () => {
  const controller = new AbortController();
  let closes = 0;
  let requests = 0;
  const adapter = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1', accountId: 'account-1',
    getAuthorizedCredential: async () => ({ access_token: 'token', client_id: 'client-1', subject: 'subject-1', scopes: DIRECT_SCOPES }),
    getCatalog: async () => ({ identity: { client_id: 'client-1', subject: 'subject-1' }, models: [{ slug: 'gpt-test', display_name: 'GPT Test' }] }),
    transport: async () => {
      requests += 1;
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: (async function* () {
          const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
          yield encoder.encode(sse({ type: 'response.output_text.delta', item_id: 'msg-live', output_index: 0, content_index: 0, delta: 'LIVE' }));
          await aborted;
        })(),
        close: async () => { closes += 1; },
      };
    },
  });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({
      provider: 'router-chatgpt-account-1', model: 'gpt-test', signal: controller.signal,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'cancel' }] })],
    })) {
      chunks.push(chunk);
      if (chunk.type === 'text-delta') controller.abort(new Error('controlled abort'));
    }
  }, error => error?.failure?.code === 'ABORTED');
  assert.equal(requests, 1);
  assert.equal(closes, 1);
});

test('unknown models, private modalities, and unsupported controls fail before HTTP', async () => {
  let requests = 0;
  const { adapter } = fixture({ events: [] });
  const guarded = createChatGptResponsesAdapter({
    provider: 'router-chatgpt-account-1', accountId: 'account-1',
    getAuthorizedCredential: async () => ({ access_token: 'token', client_id: 'client-1', subject: 'subject-1', scopes: DIRECT_SCOPES }),
    getCatalog: async () => ({ identity: { client_id: 'client-1', subject: 'subject-1' }, models: [{ slug: 'gpt-test', display_name: 'GPT Test' }] }),
    transport: async () => { requests += 1; throw new Error('must not dispatch'); },
  });
  await assert.rejects(guarded.resolveModel('router-chatgpt-account-1', 'invented-model'), error => error?.failure?.code === 'MODEL_NOT_FOUND');
  await assert.rejects(async () => collect(guarded.stream({
    provider: 'router-chatgpt-account-1', model: 'gpt-test',
    messages: [{ role: 'user', content: [{ type: 'image', attachment: { id: 'image-1' } }] }],
  })), error => error?.failure?.code === 'UNSUPPORTED_CONTENT');
  await assert.rejects(async () => collect(guarded.stream({
    provider: 'router-chatgpt-account-1', model: 'gpt-test', temperature: 0,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'temperature is unsupported here' }] })],
  })), error => error?.failure?.code === 'UNSUPPORTED_REQUEST');
  assert.equal(requests, 0);
  assert.equal(await adapter.listModels('router-chatgpt-account-1').then(models => models[0].inputModalities[0]), 'text');
});

test('the adapter obeys public LlmRuntime preparation, retry, and replay contracts', async () => {
  const ctx = new Context();
  const { adapter } = fixture({ events: [
    { type: 'response.output_text.delta', item_id: 'msg-runtime', output_index: 0, content_index: 0, delta: 'RUNTIME' },
    { type: 'response.output_text.done', item_id: 'msg-runtime', output_index: 0, content_index: 0, text: 'RUNTIME' },
    { type: 'response.completed', response: {
      id: 'resp-runtime', status: 'completed',
      output: [
        { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-ciphertext', summary: [] },
        { type: 'message', id: 'msg-runtime', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'RUNTIME' }] },
      ],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    } },
  ] });
  try {
    await ctx.plugin(LlmRuntime);
    ctx.llm.registerAdapter(['router-chatgpt-account-1'], adapter);
    const prepared = await ctx.llm.prepareCall({ provider: 'router-chatgpt-account-1', model: 'gpt-test' });
    assert.equal(prepared.retryPolicy.maxRetries, 0);
    const chunks = await collect(prepared.stream({
      ...prepared.config,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'runtime contract' }] })],
    }));
    assert.equal(chunks.at(-1).reason.kind, 'stop');
    assert.equal(chunks.at(-1).replayState.blocks.length, 1);
    assert.equal(chunks.at(-1).replayState.response.items[0].encrypted_content, 'opaque-ciphertext');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('response.incomplete is a failure and preserves known usage', async () => {
  const { adapter } = fixture({ events: [{ type: 'response.incomplete', response: {
    id: 'resp-incomplete', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
  } }] });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({
      provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'incomplete' }] })],
    })) chunks.push(chunk);
  }, error => error?.failure?.code === 'RESPONSE_INCOMPLETE');
  assert.deepEqual(chunks, [{ type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }]);
});

test('completion verification runs only after response.completed and cannot rewrite success', async () => {
  const verified = [];
  const completed = { id: 'resp-hook', status: 'completed', output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
  const { adapter } = fixture({
    events: [{ type: 'response.completed', response: completed }],
    onInferenceCompleted: async value => { verified.push(value); throw new Error('controlled persistence failure'); },
  });
  const chunks = await collect(adapter.stream({
    provider: 'router-chatgpt-account-1', model: 'gpt-test', messages: [createUserMessage({ content: [{ type: 'text', text: 'verify after' }] })],
  }));
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.deepEqual(verified, [{
    provider: 'router-chatgpt-account-1', accountId: 'account-1', model: 'gpt-test',
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  }]);
});
