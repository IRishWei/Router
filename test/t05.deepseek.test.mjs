import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import LlmRuntime, {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import {
  DEEPSEEK_CREDENTIAL_OWNER,
  createDeepSeekConnectionMetadata,
  deepSeekCredentialKey,
  describeDeepSeekCredential,
  fetchDeepSeekModelCatalog,
  mountDeepSeekOwnedProvider,
  storeDeepSeekApiKey,
} from '../src/deepseek-connections.mjs';

function sse(...events) {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}/anthropic`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function bounded(promise, message, timeoutMs = 2_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('an owned DeepSeek connection stores its secret only in its credential record', async () => {
  const home = join(tmpdir(), `router-t05-credentials-${crypto.randomUUID()}`);
  const credentialsPath = join(home, '.credentials.yaml');
  const ctx = new Context();
  try {
    await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false });
    const accountId = `account-${crypto.randomUUID()}`;
    const apiKey = 'test-secret-deepseek-key';
    const key = deepSeekCredentialKey(accountId);
    assert.equal(String(key), `${DEEPSEEK_CREDENTIAL_OWNER}/${accountId}`);

    await storeDeepSeekApiKey(ctx.credentials, accountId, apiKey);
    const credential = await describeDeepSeekCredential(ctx.credentials, accountId);
    const metadata = createDeepSeekConnectionMetadata({
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      credential,
    });

    assert.deepEqual(credential, { configured: true, kind: 'api-key', writable: true });
    assert.equal(metadata.credentialKey, String(key));
    assert.match(metadata.credentialGeneration, /^generation-/);
    assert.equal('authEpoch' in metadata, false);
    assert.equal(metadata.source, 'deepseek-official-api');
    assert.equal(metadata.supportScope, 'owned-provider-metadata');
    assert.equal(metadata.providerAuthorization.status, 'configured');
    assert.equal(metadata.catalog.status, 'declared');
    assert.equal(metadata.capabilities.tools.status, 'declared');
    assert.equal(metadata.inference.status, 'unverified');
    assert.doesNotMatch(JSON.stringify(metadata), /test-secret-deepseek-key/);
    assert.match(await readFile(credentialsPath, 'utf8'), /test-secret-deepseek-key/);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('catalog discovery is a credential-free GET and remains separate from capability and inference verification', async () => {
  const requests = [];
  const endpoint = await listen(async (request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      data: [
        { id: 'deepseek-flash', name: 'Flash live', context_window: 1_048_576, max_output_tokens: 393_216, input_modalities: ['text', 'image'], effort: ['low', 'high', 'max'], api_capabilities: { messages: true, tools: true } },
        { id: 'deepseek-v4-pro', context_window: 1_048_576, max_output_tokens: 393_216, input_modalities: ['text'], api_capabilities: { messages: true, tools: true } },
        { id: 'future-unconfirmed-model', context_window: 1 },
      ],
    }));
  });
  try {
    const catalog = await fetchDeepSeekModelCatalog({ catalogURL: `${endpoint.baseURL.replace('/anthropic', '')}/models` });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, '/models');
    assert.equal(requests[0].headers.authorization, undefined);
    assert.equal(requests[0].headers['x-api-key'], undefined);
    assert.equal(catalog.status, 'listed');
    assert.deepEqual(catalog.models.map(model => model.id), ['deepseek-flash', 'deepseek-v4-pro']);
    assert.deepEqual(catalog.unrecognizedModelIds, ['future-unconfirmed-model']);
    assert.equal(catalog.models[0].inputModalities.includes('image'), true);
    assert.equal(catalog.inference, undefined);
    assert.equal(catalog.capabilityVerification, undefined);
  } finally {
    await endpoint.close();
  }
});

test('an owned provider uses the rc.2 Messages adapter with one POST and no ambient fallback', async () => {
  const requests = [];
  const endpoint = await listen(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(body).toString()) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse(
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LOCAL_OK' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ));
  });
  const home = join(tmpdir(), `router-t05-provider-${crypto.randomUUID()}`);
  const ctx = new Context();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'local-test-key');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const prepared = await ctx.llm.prepareCall({ provider: provider.metadata.provider, model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 8 });
    assert.equal(prepared.retryPolicy.mode, 'normal');
    assert.equal(prepared.retryPolicy.maxRetries, 0);

    const chunks = [];
    for await (const chunk of ctx.llm.stream({
      provider: provider.metadata.provider,
      model: 'deepseek-flash',
      reasoningEffort: 'off',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply LOCAL_OK' }] })],
      maxTokens: 8,
    })) chunks.push(chunk);

    assert.equal(requests.length, 1, JSON.stringify(chunks));
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/anthropic/v1/messages');
    assert.equal(requests[0].headers['x-api-key'], 'local-test-key');
    assert.equal(requests[0].body.model, 'deepseek-flash');
    assert.equal(requests[0].body.max_tokens, 8);
    assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.text, 'LOCAL_OK');
    assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, { inputTokens: 7, outputTokens: 3, totalTokens: 10 });
    assert.equal(chunks.at(-1).type, 'finish');
    assert.equal(chunks.at(-1).reason.kind, 'stop');
  } finally {
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('a tool round trip sends exactly one Messages POST per call', async () => {
  const requests = [];
  const endpoint = await listen(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push(JSON.parse(Buffer.concat(body).toString()));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (requests.length === 1) {
      response.end(sse(
        { type: 'message_start', message: { usage: { input_tokens: 11 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-call-1', name: 'lookup', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"term":"router"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ));
    } else {
      response.end(sse(
        { type: 'message_start', message: { usage: { input_tokens: 18 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'TOOL_OK' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ));
    }
  });
  const home = join(tmpdir(), `router-t05-tools-${crypto.randomUUID()}`);
  const ctx = new Context();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'local-tool-key');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const route = provider.metadata.provider;
    const user = createUserMessage({ content: [{ type: 'text', text: 'Use lookup' }] });
    const tools = [{ name: 'lookup', description: 'Look up a term', parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] } }];
    const first = [];
    for await (const chunk of ctx.llm.stream({ provider: route, model: 'deepseek-v4-pro', reasoningEffort: 'off', messages: [user], tools, maxTokens: 16 })) first.push(chunk);
    const toolCall = first.find(chunk => chunk.type === 'block-end').block;
    const finish = first.at(-1);
    assert.deepEqual(toolCall, { type: 'tool-call', id: 'tool-call-1', name: 'lookup', arguments: '{"term":"router"}' });
    assert.equal(finish.reason.kind, 'tool-calls');

    const assistant = createAssistantMessage({ content: [toolCall], source: { provider: route, model: 'deepseek-v4-pro', replayState: finish.replayState } });
    const result = createToolResultMessage({ callId: toolCall.id, content: [{ type: 'text', text: 'found' }], isError: false });
    const second = [];
    for await (const chunk of ctx.llm.stream({ provider: route, model: 'deepseek-v4-pro', reasoningEffort: 'off', messages: [user, assistant, result], tools, maxTokens: 16 })) second.push(chunk);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools[0].name, 'lookup');
    assert.equal(requests[1].messages.at(-1).role, 'user');
    assert.equal(requests[1].messages.at(-1).content[0].type, 'tool_result');
    assert.equal(second.find(chunk => chunk.type === 'block-end').block.text, 'TOOL_OK');
  } finally {
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of ['wrong-credential', 'truncated-stream']) test(`a ${scenario} is preserved without an automatic retry`, async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    if (scenario === 'wrong-credential') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'controlled rejection', type: 'authentication_error' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse(
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PARTIAL' } },
    ));
  });
  const home = join(tmpdir(), `router-t05-failure-${crypto.randomUUID()}`);
  const ctx = new Context();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'controlled-wrong-key');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const chunks = [];
    for await (const chunk of ctx.llm.stream({
      provider: provider.metadata.provider,
      model: 'deepseek-flash',
      reasoningEffort: 'off',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Fail once' }] })],
      maxTokens: 8,
    })) chunks.push(chunk);

    assert.equal(posts, 1);
    assert.equal(chunks.at(-1).type, 'finish');
    assert.equal(chunks.at(-1).reason.kind, 'error');
    assert.equal(chunks.at(-1).reason.failure.code, scenario === 'wrong-credential' ? 'AUTH' : 'STREAM_CLOSED');
    if (scenario === 'truncated-stream') assert.equal(chunks.some(chunk => chunk.type === 'usage'), false);
  } finally {
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('an original abort closes a live Messages SSE request without retrying', async () => {
  let posts = 0;
  let closeConnection;
  const connectionClosed = new Promise(resolve => { closeConnection = resolve; });
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(sse(
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PARTIAL' } },
    ));
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20);
    response.once('close', () => {
      clearInterval(keepAlive);
      closeConnection();
    });
  });
  const home = join(tmpdir(), `router-t05-abort-${crypto.randomUUID()}`);
  const ctx = new Context();
  const controller = new AbortController();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'controlled-abort-key');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const chunks = [];
    const consume = async () => {
      for await (const chunk of ctx.llm.stream({
        provider: provider.metadata.provider,
        model: 'deepseek-flash',
        reasoningEffort: 'off',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'Abort this stream' }] })],
        maxTokens: 8,
        signal: controller.signal,
      })) {
        chunks.push(chunk);
        if (chunk.type === 'text-delta') controller.abort(new Error('controlled original abort'));
      }
    };

    await bounded(consume(), 'aborted DeepSeek stream did not settle');
    await bounded(connectionClosed, 'aborted DeepSeek transport did not close');
    assert.equal(posts, 1);
    assert.equal(chunks.at(-1).type, 'finish');
    assert.equal(chunks.at(-1).reason.kind, 'aborted');
    assert.equal(chunks.at(-1).reason.failure.code, 'ABORTED');
  } finally {
    controller.abort(new Error('test cleanup'));
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('unknown model ids and stale prepared calls fail before any HTTP request', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(500).end();
  });
  const home = join(tmpdir(), `router-t05-revoke-${crypto.randomUUID()}`);
  const ctx = new Context();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'owned-key-before-revoke');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const user = createUserMessage({ content: [{ type: 'text', text: 'Do not send' }] });
    await assert.rejects(async () => {
      for await (const _chunk of ctx.llm.stream({ provider: provider.metadata.provider, model: 'made-up-model', messages: [user] })) { /* consume */ }
    }, /unsupported DeepSeek model id/);
    assert.equal(posts, 0);

    const prepared = await ctx.llm.prepareCall({ provider: provider.metadata.provider, model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 8 });
    await provider.disconnect({ deleteCredential: false });
    provider = undefined;
    const chunks = [];
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [user] })) chunks.push(chunk);
    assert.equal(posts, 0);
    assert.equal(chunks.at(-1).reason.kind, 'error');
    assert.equal(chunks.at(-1).reason.failure.code, 'AUTHORIZATION_CHANGED');
  } finally {
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('credential replacement revokes the mounted generation instead of rebinding a prepared call', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(500).end();
  });
  const home = join(tmpdir(), `router-t05-rotate-${crypto.randomUUID()}`);
  const ctx = new Context();
  let provider;
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await ctx.plugin(LlmRuntime);
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'credential-generation-one');
    provider = await mountDeepSeekOwnedProvider(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const prepared = await ctx.llm.prepareCall({ provider: provider.metadata.provider, model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 8 });
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'credential-generation-two');
    const chunks = [];
    for await (const chunk of prepared.stream({
      ...prepared.config,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Do not rebind' }] })],
    })) chunks.push(chunk);

    assert.equal(posts, 0);
    assert.equal(chunks.at(-1).reason.failure.code, 'AUTHORIZATION_CHANGED');
  } finally {
    if (provider) await provider.disconnect();
    await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('the owned credential survives a Host restart and disconnect removes it', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse(
      { type: 'message_start', message: { usage: { input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'RESTARTED' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ));
  });
  const home = join(tmpdir(), `router-t05-restart-${crypto.randomUUID()}`);
  const credentialsPath = join(home, '.credentials.yaml');
  const accountId = `account-${crypto.randomUUID()}`;
  let first = new Context();
  let second;
  let third;
  let provider;
  try {
    await first.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false });
    await storeDeepSeekApiKey(first.credentials, accountId, 'persistent-owned-key');
    await first.fiber.dispose();
    first = undefined;

    second = new Context();
    await second.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false });
    await second.plugin(LlmRuntime);
    assert.equal((await describeDeepSeekCredential(second.credentials, accountId)).configured, true);
    provider = await mountDeepSeekOwnedProvider(second, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 2,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const chunks = [];
    for await (const chunk of second.llm.stream({
      provider: provider.metadata.provider,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'off',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'After restart' }] })],
      maxTokens: 8,
    })) chunks.push(chunk);
    assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.text, 'RESTARTED');
    assert.equal(posts, 1);
    await provider.disconnect({ deleteCredential: false });
    assert.equal((await describeDeepSeekCredential(second.credentials, accountId)).configured, true);
    await provider.disconnect();
    assert.equal((await describeDeepSeekCredential(second.credentials, accountId)).configured, false);
    provider = undefined;
    await second.fiber.dispose();
    second = undefined;

    third = new Context();
    await third.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false });
    assert.equal((await describeDeepSeekCredential(third.credentials, accountId)).configured, false);
  } finally {
    if (provider) await provider.disconnect();
    if (first) await first.fiber.dispose();
    if (second) await second.fiber.dispose();
    if (third) await third.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true });
  }
});
