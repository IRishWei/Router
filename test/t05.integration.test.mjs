import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { deleteDeepSeekCredential } from '../src/deepseek-connections.mjs';
import { startNative } from './t02-harness.mjs';

function sse(text) {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}/anthropic`,
    catalogURL: `http://127.0.0.1:${port}/models`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('public DeepSeek Host flow runs one explicit finite Task without changing global routing', async () => {
  const requests = [];
  const secret = 'host-integration-controlled-key';
  const endpoint = await listen(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] }));
      return;
    }
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(body).toString()) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse(requests.length === 1 ? 'DEEPSEEK_CONNECTION_OK' : 'DeepSeek connection'));
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-host-'));
  let ctx;
  try {
    ctx = await startNative(home, { beforeRouter: async current => {
      await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
      current.provide('routerDeepSeekEndpoint', { kind: 'controlled-test', baseURL: endpoint.baseURL });
      current.provide('routerDeepSeekCatalogURL', endpoint.catalogURL);
    } });
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 2_000 });

    let snapshot = await ctx.router.deepSeekSaveCredential({ apiKey: secret });
    const accountId = snapshot.deepSeek.bindings[0].accountId;
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    snapshot = await ctx.router.deepSeekDiscoverCatalog();
    assert.deepEqual(snapshot.deepSeek.catalog.models.map(model => model.id), ['deepseek-flash', 'deepseek-v4-pro']);
    snapshot = await ctx.router.deepSeekConnect({ accountId });
    const candidate = snapshot.models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    assert(candidate);
    assert.equal(candidate.enabled, false);
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setAutomatic(false);
    await ctx.router.setFixedModel('controlled');
    const before = await ctx.router.snapshot();

    const completed = await ctx.router.deepSeekRunDetection({
      candidateId: candidate.candidateId,
      budget: { tokens: 4096, durationMs: 5_000 },
    });
    const task = completed.tasks.find(item => item.id === completed.deepSeek.lastDetectionTaskId);
    assert(task);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ pauseReason: task.pauseReason, calls: task.calls, timeline: task.timeline }));
    assert.equal(task.result, 'DEEPSEEK_CONNECTION_OK');
    assert.deepEqual(task.budget.limits, { tokens: 4096, durationMs: 5_000, money: [] });
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls.every(call => call.candidateId === candidate.candidateId), true);
    assert.deepEqual(task.calls.map(call => call.nativePurpose ?? call.purpose).sort(), ['detection', 'session-title']);
    assert.equal(task.calls.every(call => Number.isSafeInteger(call.reservation.tokens.total) && call.reservation.tokens.total > 0), true);
    assert.equal(task.ledger.callCount, 2);
    assert.equal(task.ledger.unknownPriceCalls, 2);
    assert.equal(requests.length, 2);
    assert.equal(requests.every(item => item.headers['x-api-key'] === secret), true);
    assert.deepEqual(completed.config, before.config);
    assert.equal(JSON.stringify(completed).includes(secret), false);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function connectedHost(home, endpoint) {
  const ctx = await startNative(home, { beforeRouter: async current => {
    await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    current.provide('routerDeepSeekEndpoint', { kind: 'controlled-test', baseURL: endpoint.baseURL });
  } });
  let snapshot = await ctx.router.deepSeekSaveCredential({ apiKey: 'controlled-detection-key' });
  snapshot = await ctx.router.deepSeekConnect({ accountId: snapshot.deepSeek.bindings[0].accountId });
  const candidate = snapshot.models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { ctx, candidate };
}

async function waitForTask(ctx, taskId, predicate) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const task = (await ctx.router.snapshot()).tasks.find(item => item.id === taskId);
    if (task && predicate(task)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('DeepSeek Task did not reach the expected state');
}

test('a detection whose finite token budget cannot cover its assembled input dispatches zero requests', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    if (request.method === 'POST') posts += 1;
    response.writeHead(500).end();
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-no-dispatch-'));
  let ctx;
  try {
    ({ ctx } = await connectedHost(home, endpoint));
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    const snapshot = await ctx.router.deepSeekRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 1, durationMs: 5_000 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.deepSeek.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'waiting-budget');
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].status, 'waiting');
    assert.equal(task.calls[0].dispatchStarted, false);
    assert.equal(task.calls[0].reservation.tokens.total > 1, true);
    assert.equal(posts, 0);
    await ctx.router.stopTask(task.id);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the detection elapsed deadline aborts the original DeepSeek HTTP stream after one attempt', async () => {
  let posts = 0;
  let responseClosed = false;
  const endpoint = await listen(async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(404).end();
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.on('close', () => { responseClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n');
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-deadline-'));
  let ctx;
  try {
    ({ ctx } = await connectedHost(home, endpoint));
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    const snapshot = await ctx.router.deepSeekRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 4096, durationMs: 80 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.deepSeek.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(posts, 1);
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].status, 'interrupted', JSON.stringify(task.calls[0]));
    assert.equal(task.calls[0].failureCode, 'ABORTED');
    for (let attempt = 0; attempt < 100 && !responseClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(responseClosed, true);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a Router storage failure rejects credential save and removes the unbound owned secret', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t05-storage-'));
  const credentialPath = join(home, '.credentials.yaml');
  const secret = 'must-be-rolled-back-after-state-failure';
  let armed = true;
  let ctx;
  try {
    ctx = await startNative(home, {
      files: {
        rename,
        async writeFile(...args) {
          if (armed) { armed = false; throw new Error('controlled Router state failure'); }
          return writeFile(...args);
        },
      },
      beforeRouter: current => current.plugin(LocalCredentialProvider, { path: credentialPath, watch: false }),
    });
    await assert.rejects(ctx.router.deepSeekSaveCredential({ apiKey: secret }), /could not be saved/);
    const snapshot = await ctx.router.snapshot();
    assert.equal(snapshot.storageError, 'STATE_WRITE_FAILED');
    assert.deepEqual(snapshot.deepSeek.bindings, []);
    assert.equal((await readFile(credentialPath, 'utf8')).includes(secret), false);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the Task deadline remains armed while budget waits and aborts a request resumed by extension', async () => {
  let posts = 0;
  let responseClosed = false;
  const endpoint = await listen(async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(404).end();
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.on('close', () => { responseClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n');
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-wait-deadline-'));
  let ctx;
  try {
    ({ ctx } = await connectedHost(home, endpoint));
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    const waiting = await ctx.router.deepSeekRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 1, durationMs: 200 } });
    const taskId = waiting.deepSeek.lastDetectionTaskId;
    assert.equal(waiting.tasks.find(item => item.id === taskId).lifecycle, 'waiting-budget');
    await ctx.router.extendTaskBudget(taskId, { tokens: 4095 });
    const task = await waitForTask(ctx, taskId, item => item.lifecycle === 'paused');
    assert.equal(posts, 1);
    assert.equal(task.calls[0].failureCode, 'ABORTED');
    for (let attempt = 0; attempt < 100 && !responseClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(responseClosed, true);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('extending the detection duration rearms the same Task deadline without resetting elapsed time', async () => {
  let posts = 0;
  const endpoint = await listen(async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(404).end();
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    await new Promise(resolve => setTimeout(resolve, 400));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse('DEEPSEEK_CONNECTION_OK'));
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-extended-deadline-'));
  let ctx;
  try {
    ({ ctx } = await connectedHost(home, endpoint));
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    const waiting = await ctx.router.deepSeekRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 1, durationMs: 200 } });
    const taskId = waiting.deepSeek.lastDetectionTaskId;
    const startedAt = waiting.tasks.find(item => item.id === taskId).startedAt;
    await ctx.router.extendTaskBudget(taskId, { tokens: 4095, durationMs: 1_000 });
    const task = await waitForTask(ctx, taskId, item => item.lifecycle === 'completed' || item.lifecycle === 'paused');
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ pauseReason: task.pauseReason, calls: task.calls, timeline: task.timeline }));
    assert.equal(task.startedAt, startedAt);
    assert.deepEqual(task.budget.limits, { tokens: 4096, durationMs: 1_200, money: [] });
    assert.equal(task.timeline.some(item => item.kind === 'detection-deadline'), false);
    assert.equal(task.result, 'DEEPSEEK_CONNECTION_OK');
    assert.equal(posts, 1);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the Task deadline also aborts an owned title stream after the native turn is idle', async () => {
  let posts = 0;
  let titleClosed = false;
  const endpoint = await listen(async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(404).end();
    posts += 1;
    for await (const _chunk of request) { /* consume */ }
    response.on('close', () => { if (posts === 2) titleClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (posts === 1) response.end(sse('DEEPSEEK_CONNECTION_OK'));
    else response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n');
  });
  const home = await mkdtemp(join(tmpdir(), 'router-t05-title-deadline-'));
  let ctx;
  try {
    ({ ctx } = await connectedHost(home, endpoint));
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 2_000 });
    const candidate = (await ctx.router.snapshot()).models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    const snapshot = await ctx.router.deepSeekRunDetection({ candidateId: candidate.candidateId, budget: { tokens: 4096, durationMs: 250 } });
    const task = snapshot.tasks.find(item => item.id === snapshot.deepSeek.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(posts, 2);
    assert.equal(task.calls[1].nativePurpose, 'session-title');
    assert.equal(task.calls[1].failureCode, 'ABORTED');
    for (let attempt = 0; attempt < 100 && !titleClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(titleClosed, true);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('Host restart restores the same account connection while credential revocation withdraws it', async () => {
  const endpoint = await listen(async (_request, response) => response.writeHead(500).end());
  const home = await mkdtemp(join(tmpdir(), 'router-t05-host-restart-'));
  const credentialPath = join(home, '.credentials.yaml');
  let ctx;
  try {
    const start = () => startNative(home, { beforeRouter: async current => {
      await current.plugin(LocalCredentialProvider, { path: credentialPath, watch: false });
      current.provide('routerDeepSeekEndpoint', { kind: 'controlled-test', baseURL: endpoint.baseURL });
    } });
    ctx = await start();
    let snapshot = await ctx.router.deepSeekSaveCredential({ apiKey: 'restart-owned-key' });
    const accountId = snapshot.deepSeek.bindings[0].accountId;
    snapshot = await ctx.router.deepSeekConnect({ accountId });
    const before = snapshot.models.find(model => model.source === 'deepseek-official-api' && model.model === 'deepseek-flash');
    await ctx.router.setModelEnabled(before.candidateId, true);
    await ctx.fiber.dispose();

    ctx = await start();
    snapshot = await ctx.router.snapshot();
    const restored = snapshot.models.find(model => model.candidateId === before.candidateId);
    assert(restored);
    assert.equal(restored.available, true);
    assert.equal(restored.enabled, true);
    assert.equal(snapshot.deepSeek.connections.length, 1);
    await deleteDeepSeekCredential(ctx.credentials, accountId);
    const revoked = await waitForTaskState(ctx, state => state.models.find(model => model.candidateId === before.candidateId)?.available === false);
    assert.equal(revoked.deepSeek.bindings[0].configured, false);
    assert.equal(JSON.stringify(revoked).includes('restart-owned-key'), false);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await endpoint.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

async function waitForTaskState(ctx, predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Router state did not reach the expected state');
}
