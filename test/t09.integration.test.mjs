import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { CHATGPT_CREDENTIAL_KEY, CHATGPT_DIRECT_SCOPE } from '../src/chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';
import { startNative } from './t02-harness.mjs';

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const accountIdOf = (clientId, subject) => `account-${createHash('sha256').update(`${clientId}\0${subject}`).digest('hex').slice(0, 24)}`;

async function endpoint(respond, { statusCode = 200, contentType = 'text/event-stream', encode = sse } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/responses') return response.writeHead(404).end();
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(body).toString('utf8')) });
    response.writeHead(statusCode, { 'content-type': contentType, 'x-request-id': `req-${requests.length}` });
    response.end(encode(respond(requests.length)));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, requests, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

async function connected(home, remote, { sessionControllerAsPlugin = false } = {}) {
  const hostId = `urn:uuid:${randomUUID()}`;
  const clientId = 'oaiapp-controlled';
  const subject = 'subject-controlled';
  const accountId = accountIdOf(clientId, subject);
  const connectionId = `connection-${randomUUID()}`;
  const directory = join(home, 'router', 'test');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'state.json'), JSON.stringify({
    schemaVersion: 1, config: { automatic: true, version: 1 }, tasks: [],
    chatGpt: { hostId, account: { accountId, issuedClientId: clientId, configRevision: 1 }, connection: { connectionId, accountId, configRevision: 1 }, lastDetectionTaskId: null, inference: {} },
  }));
  const ctx = await startNative(home, { sessionControllerAsPlugin, beforeRouter: async current => {
    await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await current.credentials.modifyRecord(CHATGPT_CREDENTIAL_KEY, () => ({ kind: 'grant', payload: {
      schemaVersion: 1, issuedClientId: clientId, hostId, issuer: remote.origin, subject,
      idToken: 'id-sensitive', accessToken: 'access-sensitive', refreshToken: 'refresh-sensitive', tokenType: 'Bearer', expiresIn: 3600,
      scopes: ['openid', CHATGPT_DIRECT_SCOPE], savedAt: new Date().toISOString(),
      catalog: { status: 'listed', models: [{ slug: 'gpt-controlled', displayName: 'GPT Controlled' }] },
    } }));
    await current.plugin(AuthorizationService);
    current.provide('routerChatGptTransport', createSourceNetworkTransport({ lookup, directOnly: true }));
    current.provide('routerChatGptEndpoints', {
      kind: 'controlled-test', authorizationURL: `${remote.origin}/authorize`, tokenURL: `${remote.origin}/token`,
      discoveryURL: `${remote.origin}/discovery`, modelsURL: `${remote.origin}/models`, responsesURL: `${remote.origin}/responses`,
    });
  } });
  let snapshot = await ctx.router.snapshot();
  const candidate = snapshot.models.find(model => model.source === 'openai-chatgpt-oauth');
  assert(candidate);
  assert.equal(candidate.maxContextTokens, null);
  snapshot = await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { ctx, candidate, snapshot };
}

const toolEvents = () => [
  { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'router_test_echo', arguments: '' } },
  { type: 'response.function_call_arguments.delta', item_id: 'fc-1', output_index: 0, delta: '{}' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'router_test_echo', arguments: '{}', status: 'completed' } },
  { type: 'response.completed', response: { id: 'resp-tool', status: 'completed', output: [{ type: 'function_call', id: 'fc-1', call_id: 'call-1', namespace: 'functions', name: 'router_test_echo', arguments: '{}', status: 'completed' }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } },
];
const finalEvents = () => [
  { type: 'response.output_text.delta', item_id: 'msg-2', output_index: 0, content_index: 0, delta: 'CHATGPT_CONNECTION_OK' },
  { type: 'response.output_text.done', item_id: 'msg-2', output_index: 0, content_index: 0, text: 'CHATGPT_CONNECTION_OK' },
  { type: 'response.completed', response: { id: 'resp-final', status: 'completed', output: [{ type: 'message', id: 'msg-2', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'CHATGPT_CONNECTION_OK' }] }], usage: { input_tokens: 16, input_tokens_details: { cached_tokens: 3 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 18 } } },
];

test('one bounded ChatGPT validation Task completes a native tool round trip in exactly two requests', async () => {
  const remote = await endpoint(index => index === 1 ? toolEvents() : finalEvents());
  const home = await mkdtemp(join(tmpdir(), 'router-t09-task-'));
  let ctx;
  try {
    ({ ctx } = await connected(home, remote, { sessionControllerAsPlugin: true }));
    ctx.tools.register({ name: 'router_test_echo', description: 'Return a controlled result', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'openai-chatgpt-oauth');
    const snapshot = await ctx.router.chatGptRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 65_536, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.chatGpt.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ pauseReason: task.pauseReason, calls: task.calls, timeline: task.timeline }));
    assert.equal(task.result, 'CHATGPT_CONNECTION_OK');
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls.every(call => call.taskId === task.id && call.candidateId === candidate.candidateId && call.status === 'completed'), true);
    assert.equal(remote.requests.length, 2);
    assert.equal(remote.requests.every(item => item.headers.authorization === 'Bearer access-sensitive'), true);
    assert.match(JSON.stringify(remote.requests[1].body), /TOOL_OK/u);
    assert.equal(remote.requests.every(item => item.body.store === false && item.body.stream === true && item.body.max_output_tokens === undefined), true);
    assert.equal(JSON.stringify(snapshot).includes('access-sensitive'), false);
    assert.equal(task.ledger.callCount, 2);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a native ChatGPT validation preserves an HTTP 200 non-SSE INVALID_RESPONSE without retrying or inventing usage', async () => {
  const remote = await endpoint(
    () => ({ error: { message: 'controlled non-event-stream response' } }),
    { contentType: 'application/json', encode: JSON.stringify },
  );
  const home = await mkdtemp(join(tmpdir(), 'router-t09-invalid-response-'));
  let ctx;
  try {
    const connectedHost = await connected(home, remote, { sessionControllerAsPlugin: true });
    ctx = connectedHost.ctx;
    await ctx.plugin(LlmRetry);
    const snapshot = await ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 65_536, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.chatGpt.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(remote.requests.length, 1);
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].failureCode, 'INVALID_RESPONSE');
    assert.equal(task.calls[0].usage, null);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    assert.equal(task.pauseReason, 'INVALID_RESPONSE');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the native retry plugin honors the ChatGPT zero-retry policy for a retryable SERVER failure', async () => {
  const remote = await endpoint(
    () => ({ error: { message: 'controlled server failure' } }),
    { statusCode: 503, contentType: 'application/json', encode: JSON.stringify },
  );
  const home = await mkdtemp(join(tmpdir(), 'router-t09-server-failure-'));
  let ctx;
  try {
    const connectedHost = await connected(home, remote, { sessionControllerAsPlugin: true });
    ctx = connectedHost.ctx;
    await ctx.plugin(LlmRetry);
    const snapshot = await ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 65_536, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.chatGpt.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(remote.requests.length, 1);
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].failureCode, 'SERVER');
    assert.equal(task.calls[0].usage, null);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.pauseReason, 'SERVER');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a native session-title call consumes the second authorized request without being recorded as a retry', async () => {
  const remote = await endpoint(() => finalEvents());
  const home = await mkdtemp(join(tmpdir(), 'router-t09-title-'));
  let ctx;
  try {
    const connectedHost = await connected(home, remote, { sessionControllerAsPlugin: true });
    ctx = connectedHost.ctx;
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    await ctx.plugin(LlmRetry);
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 5_000 });
    const snapshot = await ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 65_536, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.chatGpt.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ pauseReason: task.pauseReason, calls: task.calls, timeline: task.timeline }));
    assert.equal(remote.requests.length, 2);
    assert.equal(task.calls.length, 2);
    assert.deepEqual(task.calls.map(call => call.nativePurpose ?? call.purpose).sort(), ['detection', 'session-title']);
    assert.equal(task.calls.some(call => call.purpose === 'retry'), false);
    assert.equal(task.calls.every(call => call.status === 'completed' && call.usage?.totalTokens === 18), true);
    assert.equal(task.ledger.callCount, 2);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a persisted validation claim rejects a concurrent second Task while the first waits with zero dispatches', async () => {
  const remote = await endpoint(() => finalEvents());
  const home = await mkdtemp(join(tmpdir(), 'router-t09-claim-'));
  let ctx;
  try {
    const connectedHost = await connected(home, remote);
    ctx = connectedHost.ctx;
    const first = await ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 1, durationMs: 5_000 } });
    const task = first.tasks.find(item => item.id === first.chatGpt.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'waiting-budget');
    await assert.rejects(ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 1, durationMs: 5_000 } }), /already been used/u);
    assert.equal(remote.requests.length, 0);
    await ctx.router.stopTask(task.id);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the two-request gate pauses a third tool continuation before transport dispatch', async () => {
  const remote = await endpoint(() => toolEvents());
  const home = await mkdtemp(join(tmpdir(), 'router-t09-limit-'));
  let ctx;
  try {
    const connectedHost = await connected(home, remote);
    ctx = connectedHost.ctx;
    ctx.tools.register({ name: 'router_test_echo', description: 'Return a controlled result', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const snapshot = await ctx.router.chatGptRunDetection({ candidateId: connectedHost.candidate.candidateId, budget: { tokens: 65_536, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.chatGpt.lastDetectionTaskId);
    assert.equal(remote.requests.length, 2);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'CALL_LIMIT_REACHED');
    assert.equal(task.calls.length, 2);
    assert.equal(task.timeline.some(item => item.kind === 'call-limit' && item.limit === 2), true);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await remote.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
