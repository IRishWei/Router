import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import {
  createDeepSeekConnectionMetadata,
  deleteDeepSeekCredential,
  storeDeepSeekApiKey,
} from '../src/deepseek-connections.mjs';
import { deepSeekOwnedSource, mountDeepSeekRouterConnection } from '../src/deepseek-router.mjs';
import { startNative, submit } from './t02-harness.mjs';

function sse(...events) {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function completedSse(text) {
  return sse(
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  );
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

async function waitFor(ctx, predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = await ctx.router.snapshot();
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Router state did not reach the expected DeepSeek boundary');
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

test('DeepSeek metadata projects once into the public owned registry schema', () => {
  const metadata = createDeepSeekConnectionMetadata({
    connectionId: 'connection-deepseek-phase2',
    accountId: 'account-deepseek-phase2',
    configRevision: 7,
    credentialGeneration: 'credential-generation-private',
    credential: { configured: true, kind: 'api-key', writable: true },
  });
  const source = deepSeekOwnedSource(metadata);

  assert.deepEqual(Object.keys(source).sort(), [
    'accountId', 'authorizationStatus', 'billingPath', 'configRevision', 'configured',
    'connectionId', 'models', 'ownership', 'provider', 'source', 'sourceKey', 'supportScope',
  ]);
  assert.equal(source.authorizationStatus, 'configured');
  assert.equal(source.models.length, 2);
  assert.deepEqual(source.models[0].capability, {
    text: { supported: true, confidence: 'declared', source: 'deepseek-public-documentation' },
    image: { supported: false, confidence: 'declared', source: 'deepseek-public-documentation' },
    tools: { supported: true, confidence: 'declared', source: 'deepseek-public-documentation' },
  });
  assert.equal(JSON.stringify(source).includes('credentialGeneration'), false);
  assert.equal(JSON.stringify(source).includes('credentialKey'), false);
});

test('a registered DeepSeek candidate completes main and title calls with an unknown-price ledger', async () => {
  const requests = [];
  const endpoint = await listen(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(body).toString()) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(completedSse('DEEPSEEK_ROUTER_OK'));
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-task-'));
  const secret = 'controlled-router-task-secret';
  let ctx;
  let connection;
  try {
    ctx = await startNative(home);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 2_000 });
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, secret);
    connection = await mountDeepSeekRouterConnection(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const before = await ctx.router.snapshot();
    const candidate = before.models.find(model => model.provider === connection.metadata.provider && model.model === 'deepseek-flash');
    assert(candidate);
    assert.equal(candidate.enabled, false);
    assert.equal(candidate.providerAuthorization.status, 'configured');
    assert.equal(candidate.inferenceVerification.status, 'unknown');
    assert.equal(candidate.capabilities.contextWindow.confidence, 'declared');
    assert.equal(candidate.capabilities.tools.confidence, 'declared');
    assert.equal(JSON.stringify(before).includes(secret), false);

    await ctx.router.setBudgetDefaults({ tokens: 64, durationMs: 5_000, money: [] });
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply DEEPSEEK_ROUTER_OK');
    const task = (await waitFor(ctx, state => {
      const latest = state.tasks.at(-1);
      return latest?.lifecycle === 'completed' && latest.calls.length === 2;
    })).tasks.at(-1);

    assert.equal(task.result, 'DEEPSEEK_ROUTER_OK');
    assert.deepEqual(task.budget.limits, { tokens: 64, durationMs: 5_000, money: [] });
    assert.deepEqual(task.calls.map(call => call.nativePurpose ?? call.purpose).sort(), ['execution', 'session-title']);
    assert.equal(task.calls.every(call => call.candidateId === candidate.candidateId && call.dispatchStarted && call.status === 'completed'), true);
    assert.equal(task.calls.every(call => call.quoteVersion === null && call.priceQuote === null), true);
    assert.equal(task.ledger.tokens.total, 16);
    assert.equal(task.ledger.unknownPriceCalls, 2);
    assert.deepEqual(task.ledger.money, []);
    assert.equal(requests.length, 2);
    assert.equal(requests.every(request => request.headers['x-api-key'] === secret), true);
    assert.equal(requests.every(request => request.body.model === 'deepseek-flash'), true);
    const after = await ctx.router.snapshot();
    assert.equal(after.models.find(model => model.candidateId === candidate.candidateId).inferenceVerification.status, 'verified');
    assert.equal(JSON.stringify(after).includes(secret), false);
  } finally {
    if (connection) await connection.disconnect();
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a DeepSeek authentication failure pauses the Task after one accounted attempt', async () => {
  const secret = 'fakeAPIkey-should-never-escape';
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `controlled rejection leaked ${secret}`, type: 'authentication_error' } }));
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-auth-task-'));
  const sessionEvents = [];
  let ctx;
  let connection;
  try {
    ctx = await startNative(home);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'assistant/attempt' || event.type === 'turn/end') sessionEvents.push(structuredClone(event));
    });
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'controlled-rejected-key');
    connection = await mountDeepSeekRouterConnection(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const candidate = (await ctx.router.snapshot()).models.find(model => model.provider === connection.metadata.provider && model.model === 'deepseek-flash');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply MUST_FAIL_ONCE');

    assert.equal(posts, 1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'AUTH');
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].failureCode, 'AUTH');
    assert.equal(task.calls[0].dispatchStarted, true);
    assert.equal(task.calls[0].usage, null);
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.unknownPriceCalls, 1);
    assert.deepEqual(sessionEvents.map(event => event.type), ['assistant/attempt', 'turn/end']);
    const recordedEvents = JSON.stringify(sessionEvents);
    assert.equal(recordedEvents.includes(secret), false);
    assert.equal(recordedEvents.includes('controlled rejection'), false);
    assert.match(recordedEvents, /DeepSeek provider request failed/);
    assert.match(recordedEvents, /"code":"AUTH"/);
    assert.match(recordedEvents, /"status":401/);
    assert.equal(JSON.stringify(task).includes(secret), false);
  } finally {
    if (connection) await connection.disconnect();
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a DeepSeek credential survives restart and replacement revokes its registered candidate', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(completedSse('AFTER_RESTART_OK'));
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-restart-task-'));
  const accountId = `account-${crypto.randomUUID()}`;
  const connectionId = `connection-${crypto.randomUUID()}`;
  let ctx;
  let connection;
  let replacementConnection;
  let candidateId;
  try {
    ctx = await startNative(home);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'controlled-persisted-key');
    connection = await mountDeepSeekRouterConnection(ctx, {
      connectionId,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const initial = (await ctx.router.snapshot()).models.find(model => model.provider === connection.metadata.provider && model.model === 'deepseek-flash');
    candidateId = initial.candidateId;
    await ctx.router.setModelEnabled(candidateId, true);
    await ctx.router.setFixedModel(candidateId);
    await ctx.fiber.dispose();
    ctx = undefined;
    connection = undefined;

    ctx = await startNative(home);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    connection = await mountDeepSeekRouterConnection(ctx, {
      connectionId,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const restarted = (await ctx.router.snapshot()).models.find(model => model.provider === connection.metadata.provider && model.model === 'deepseek-flash' && model.available);
    assert.equal(restarted.candidateId, candidateId);
    assert.equal(restarted.enabled, true);
    assert.equal((await ctx.router.snapshot()).config.fixedCandidateId, candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const completed = await submit(ctx, sessionId, 'Reply AFTER_RESTART_OK');
    assert.equal(completed.lifecycle, 'completed');
    assert.equal(completed.result, 'AFTER_RESTART_OK');
    assert.equal(posts, 1);

    await deleteDeepSeekCredential(ctx.credentials, accountId);
    const revoked = (await ctx.router.snapshot()).models.find(model => model.candidateId === candidateId);
    assert.equal(revoked.available, false);
    assert.equal(revoked.tombstone.reason, 'OWNED_ROUTE_REMOVED');
    const replacementAccountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, replacementAccountId, 'controlled-replacement-key');
    replacementConnection = await mountDeepSeekRouterConnection(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId: replacementAccountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const replacement = (await ctx.router.snapshot()).models.find(model => model.provider === replacementConnection.metadata.provider && model.model === 'deepseek-flash');
    assert.notEqual(replacement.candidateId, candidateId);
    assert.equal(replacement.enabled, false);
    const blocked = await submit(ctx, sessionId, 'Reply MUST_NOT_USE_REPLACEMENT');
    assert.equal(blocked.lifecycle, 'paused');
    assert.equal(blocked.calls.length, 0);
    assert.equal(blocked.pauseReason, 'CONNECTION_REMOVED');
    assert.equal(posts, 1);
  } finally {
    if (replacementConnection) await replacementConnection.disconnect();
    if (connection) await connection.disconnect();
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('stopping a DeepSeek Task aborts its one live HTTP stream', async () => {
  let posts = 0;
  const transportClosed = Promise.withResolvers();
  const endpoint = await listen(async (request, response) => {
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(sse(
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PARTIAL_DEEPSEEK' } },
    ));
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20);
    response.once('close', () => {
      clearInterval(keepAlive);
      transportClosed.resolve();
    });
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-stop-task-'));
  let ctx;
  let connection;
  let sessionId;
  try {
    ctx = await startNative(home);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    const accountId = `account-${crypto.randomUUID()}`;
    await storeDeepSeekApiKey(ctx.credentials, accountId, 'controlled-stop-key');
    connection = await mountDeepSeekRouterConnection(ctx, {
      connectionId: `connection-${crypto.randomUUID()}`,
      accountId,
      configRevision: 1,
      credentialGeneration: `generation-${crypto.randomUUID()}`,
      endpoint: { kind: 'controlled-test', baseURL: endpoint.baseURL },
    });
    const candidate = (await ctx.router.snapshot()).models.find(model => model.provider === connection.metadata.provider && model.model === 'deepseek-flash');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const partialSeen = Promise.withResolvers();
    ctx.on('llm/stream', async function* (request, next) {
      for await (const chunk of next()) {
        yield chunk;
        if (request.provider === connection.metadata.provider && chunk.type === 'text-delta') partialSeen.resolve();
      }
    });
    ({ sessionId } = await ctx.sessionController.create({ cwd: home }));
    await ctx.sessionController.prompt({
      sessionId,
      requestId: crypto.randomUUID(),
      mode: 'queue',
      content: [{ type: 'text', text: 'Reply PARTIAL_DEEPSEEK' }],
    }, new AbortController().signal);
    await bounded(partialSeen.promise, 'DeepSeek partial output was not observed');
    const active = (await ctx.router.snapshot()).tasks.at(-1);
    await ctx.router.stopTask(active.id);
    await bounded(transportClosed.promise, 'DeepSeek Task abort did not close the transport');
    await bounded(ctx.agents.get(sessionId).whenIdle(), 'DeepSeek Task did not settle after stop');
    const stopped = (await ctx.router.snapshot()).tasks.find(task => task.id === active.id);

    assert.equal(posts, 1);
    assert.equal(stopped.lifecycle, 'paused');
    assert.equal(stopped.pauseReason, 'BUDGET_STOPPED');
    assert.equal(stopped.result, 'PARTIAL_DEEPSEEK');
    assert.equal(stopped.calls.length, 1);
    assert.equal(stopped.calls[0].status, 'interrupted');
    assert.equal(stopped.calls[0].finishReason, 'aborted');
    assert.equal(stopped.calls[0].usage, null);
  } finally {
    if (ctx && sessionId) ctx.agents.get(sessionId)?.cancel({ kind: 'user' });
    if (connection) await connection.disconnect();
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
