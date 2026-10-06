import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';

async function withTitles(home) {
  const ctx = await startNative(home);
  if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
  await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
  await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 5000 });
  return ctx;
}
async function waitFor(ctx, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The public auxiliary task state did not reach the boundary');
}
test('the real first-prompt title shares the task budget through its own call without clobbering execution', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-'));
  const ctx = await withTitles(home);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    const task = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'completed')).tasks.at(-1);
    assert.equal(task.calls[0].dispatchIntent, 'possible');
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls[0].purpose, 'execution');
    assert.equal(task.calls[1].purpose, 'auxiliary');
    assert.equal(task.calls[1].nativePurpose, 'session-title');
    assert.notEqual(task.calls[0].id, task.calls[1].id);
    assert.equal(task.calls[1].dispatchIntent, 'possible');
    assert.equal(task.calls[1].usage.totalTokens, 12);
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(ctx.sessionTitle.get(ctx.sessions.get(sessionId)).source.kind, 'provider');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const action of ['extend', 'stop', 'original-abort']) test(`a completed native turn retains its waiting title call until ${action}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-budget-'));
  const ctx = await withTitles(home);
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.nativeLifecycle === 'completed' && state.tasks.at(-1)?.calls[1]?.status === 'waiting')).tasks.at(-1);
    assert.equal(waiting.lifecycle, 'waiting-budget');
    assert.equal(waiting.result, 'MAIN');
    assert.equal(waiting.ledger.tokens.total, 12);
    assert.equal(waiting.calls[0].dispatchIntent, 'possible');
    if (action === 'extend') await ctx.router.extendTaskBudget(waiting.id, { tokens: 12 });
    if (action === 'stop') await ctx.router.stopTask(waiting.id);
    if (action === 'original-abort') ctx.sessionTitle.rename(ctx.sessions.get(sessionId), 'PINNED');
    const task = (await waitFor(ctx, state => ['completed', 'paused'].includes(state.tasks.at(-1)?.lifecycle))).tasks.at(-1);
    assert.equal(task.id, waiting.id);
    assert.equal(task.calls[1].id, waiting.calls[1].id);
    assert.equal(task.ledger.tokens.total, action === 'extend' ? 24 : 12);
    assert.equal(task.calls[1].dispatchStarted, action === 'extend');
    if (action === 'stop') assert.equal(task.pauseReason, 'BUDGET_STOPPED');
    if (action !== 'extend') assert.equal(task.calls[1].reservation.state, 'released');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('an explicit consultation request owns its reserved call without an extra auxiliary reservation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-explicit-call-'));
  const ctx = await startNative(home);
  let signal;
  try {
    ctx.on('agent/request', (request, next) => { signal = request.signal; return next(); });
    ctx.tools.register({ name: 'router_test_wait', description: 'Public reserved-call consultation', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      const id = await ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: task.activeSelection, forecast: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } }, signal);
      const request = { provider: task.activeSelection.provider, model: task.activeSelection.model, signal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply CONSULTED' }] })] };
      assert.throws(() => ctx.router.streamReservedCall(task.id, id, { ...request, model: 'controlled-tools' }), /does not own/);
      const stream = ctx.router.streamReservedCall(task.id, id, request);
      assert.throws(() => ctx.router.streamReservedCall(task.id, id, request), /does not own/);
      for await (const _chunk of stream) {}
      return 'TOOL_OK';
    } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '[router:tool]\nReply MAIN');
    assert.equal(task.result, 'MAIN');
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'consultation', 'execution']);
    assert.equal(task.ledger.tokens.total, 36);
    assert.equal(task.calls[1].dispatchIntent, 'possible');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a same-step consultation in flight cannot be claimed by the native execution attempt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-same-step-'));
  const ctx = await startNative(home), held = Promise.withResolvers(), release = Promise.withResolvers();
  let consultationRun;
  ctx.on('llm/stream', async function* (request, next) {
    if (!request.sessionId) { held.resolve(); await release.promise; }
    yield* next();
  }, { prepend: true });
  ctx.on('agent/request', async (request, next) => {
    const config = await next(), snapshot = await ctx.router.snapshot(), task = snapshot.tasks.at(-1);
    const identity = snapshot.models.find(model => model.provider === config.provider && model.model === config.model);
    const callId = await ctx.router.reserveCall(task.id, { purpose: 'consultation', step: request.step, selection: identity, forecast: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } }, request.signal);
    const stream = ctx.router.streamReservedCall(task.id, callId, { ...config, signal: request.signal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply CONSULTED' }] })] });
    consultationRun = (async () => { for await (const _chunk of stream) {} })().then(() => null, error => error);
    await held.promise;
    return config;
  });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    const before = (await ctx.router.snapshot()).tasks.at(-1);
    const execution = before.calls.find(call => call.purpose !== 'consultation');
    const consultation = before.calls.find(call => call.purpose === 'consultation');
    assert.equal(execution.status, 'completed');
    assert.equal(execution.purpose, 'execution');
    assert.equal(execution.usage.totalTokens, 12);
    assert.equal(consultation.hostAttemptId, undefined);
    assert.equal(consultation.dispatchStarted, false);
    release.resolve();
    assert.equal(await consultationRun, null);
    const task = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'completed')).tasks.at(-1);
    assert.equal(task.result, 'MAIN');
    assert.equal(task.calls.length, 2);
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(task.calls.find(call => call.purpose === 'consultation').usage.totalTokens, 12);
  } finally { release.resolve(); await consultationRun; await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a manual title refresh without a live task is visibly blocked before transport', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-unowned-title-'));
  const ctx = await withTitles(home);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'completed');
    await assert.rejects(ctx.sessionTitle.refresh(ctx.sessions.get(sessionId)), /AUXILIARY_TASK_UNAVAILABLE/);
    const snapshot = await ctx.router.snapshot();
    assert.equal(snapshot.blockedRequests.at(-1).reason, 'AUXILIARY_TASK_UNAVAILABLE');
    assert.equal(snapshot.blockedRequests.at(-1).status, 'not-dispatched');
    assert.equal(snapshot.tasks.at(-1).ledger.tokens.total, 24);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a delayed first title remains on its original task while the same session completes a queued turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-queue-'));
  const ctx = await withTitles(home), held = Promise.withResolvers(), release = Promise.withResolvers();
  let delayed = false;
  ctx.on('llm/stream', async function* (request, next) {
    if (!delayed && request.purpose === 'session-title') { delayed = true; held.resolve(); await release.promise; }
    yield* next();
  }, { prepend: true });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const firstRun = submit(ctx, sessionId, 'Reply FIRST'); await held.promise; await firstRun;
    const first = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(first.nativeLifecycle, 'completed');
    assert.equal(first.lifecycle, 'running');
    await ctx.router.setFixedModel('controlled-tools');
    const second = await submit(ctx, sessionId, 'Reply QUEUED');
    assert.notEqual(second.id, first.id);
    assert.equal(second.result, 'QUEUED');
    assert.equal(second.activeSelection.model, 'controlled-tools');
    release.resolve();
    const snapshot = await waitFor(ctx, state => state.tasks.find(task => task.id === first.id)?.lifecycle === 'completed');
    assert.equal(snapshot.tasks.find(task => task.id === first.id).ledger.tokens.total, 24);
    assert.equal(snapshot.tasks.find(task => task.id === first.id).calls[0].selection.model, 'controlled');
    assert.equal(snapshot.tasks.find(task => task.id === second.id).ledger.tokens.total, 12);
    assert.equal(snapshot.tasks.find(task => task.id === second.id).calls.length, 1);
  } finally { release.resolve(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('stopping an old task title cannot cancel the same session next native turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-stop-queue-'));
  const ctx = await withTitles(home), titleHeld = Promise.withResolvers(), titleRelease = Promise.withResolvers(), toolHeld = Promise.withResolvers(), toolRelease = Promise.withResolvers();
  let secondRun;
  ctx.on('llm/stream', async function* (request, next) {
    if (request.purpose === 'session-title') { titleHeld.resolve(); await titleRelease.promise; }
    yield* next();
  }, { prepend: true });
  ctx.tools.register({ name: 'router_test_wait', description: 'Hold the next native turn', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { toolHeld.resolve(); await toolRelease.promise; return 'TOOL_OK'; } });
  ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply FIRST'); await titleHeld.promise;
    const first = (await ctx.router.snapshot()).tasks.at(-1);
    secondRun = submit(ctx, sessionId, '[router:tool]\nReply SECOND'); await toolHeld.promise;
    await ctx.router.stopTask(first.id); titleRelease.resolve(); toolRelease.resolve();
    const second = await secondRun;
    assert.equal(second.lifecycle, 'completed');
    assert.equal(second.result, 'SECOND');
    assert.equal(second.ledger.tokens.total, 24);
    const oldTask = (await ctx.router.snapshot()).tasks.find(task => task.id === first.id);
    assert.equal(oldTask.lifecycle, 'paused');
    assert.equal(oldTask.pauseReason, 'BUDGET_STOPPED');
    assert.equal(oldTask.result, 'FIRST');
    assert.equal(oldTask.ledger.tokens.total, 12);
  } finally { titleRelease.resolve(); toolRelease.resolve(); await secondRun; await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('stopping an auxiliary stream preserves its already reported usage and the original title signal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-partial-'));
  const ctx = await withTitles(home), held = Promise.withResolvers(), release = Promise.withResolvers();
  let originalSignal;
  ctx.on('llm/stream', (request, next) => { if (!originalSignal && request.purpose === 'session-title') originalSignal = request.signal; return next(); }, { prepend: true });
  ctx.on('llm/stream', async function* (request, next) {
    for await (const chunk of next()) { yield chunk; if (request.purpose === 'session-title' && chunk.type === 'usage') { held.resolve(); await release.promise; } }
  });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN'); await held.promise;
    const taskId = (await ctx.router.snapshot()).tasks.at(-1).id;
    await ctx.router.stopTask(taskId); release.resolve();
    const task = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'paused')).tasks.at(-1);
    assert.equal(task.pauseReason, 'BUDGET_STOPPED');
    assert.equal(task.result, 'MAIN');
    assert.equal(task.calls[1].status, 'interrupted');
    assert.equal(task.calls[1].usage.totalTokens, 12);
    assert.equal(task.calls[0].dispatchIntent, 'possible');
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(originalSignal.aborted, false);
  } finally { release.resolve(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const mode of ['main-crash', 'aux-crash', 'budget-crash']) test(`real title ${mode} preserves separate calls across restart without replay`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-crash-'));
  let ctx;
  try {
    const child = spawnSync(process.execPath, ['test/t03-title-crash-child.mjs'], { cwd: process.cwd(), env: { ...process.env, ROUTER_TEST_HOME: home, ROUTER_TEST_MODE: mode }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    const before = JSON.parse(child.stdout.trim());
    assert.equal(before.calls[0].dispatchIntent, 'possible');
    assert.equal(before.calls[0].dispatchStarted, true);
    ctx = await startNative(home);
    const task = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(task.id, before.id);
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls[1].purpose, 'auxiliary');
    assert.equal(task.pauseReason, 'HOST_RESTARTED');
    assert.equal(task.ledger.knownTokens.total, 12);
    assert.equal(task.ledger.unknownTokenCalls.total, mode === 'budget-crash' ? 0 : 1);
    assert.equal(task.ledger.callCount, mode === 'budget-crash' ? 1 : 2);
    assert.equal(task.calls[1].status, mode === 'budget-crash' ? 'not-dispatched' : mode === 'main-crash' ? 'completed' : 'interrupted');
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const quoted of [true, false]) test(`the real title has its own ${quoted ? 'money reservation and quote' : 'unknown price count'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-title-price-'));
  const ctx = await withTitles(home);
  try {
    if (quoted) await ctx.router.setPriceQuote('router-controlled', 'controlled', { source: 'Local title accounting example, not official pricing', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 }, reasoning: 'included-in-output' });
    await ctx.router.setBudgetDefaults({ tokens: null, durationMs: null, money: [{ currency: 'USD', kind: 'fixture-reference', amount: 0.00003 }] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const run = submit(ctx, sessionId, 'Reply MAIN');
    if (quoted) {
      const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
      await ctx.router.extendTaskBudget(waiting.id, { money: [{ currency: 'USD', kind: 'fixture-reference', amount: 0.00002 }] });
      await waitFor(ctx, state => state.tasks.at(-1)?.nativeLifecycle === 'completed' && state.tasks.at(-1)?.calls[1]?.status === 'waiting');
      await ctx.router.extendTaskBudget(waiting.id, { money: [{ currency: 'USD', kind: 'fixture-reference', amount: 0.00004 }] });
    }
    await run;
    const task = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'completed')).tasks.at(-1);
    assert.equal(task.calls.length, 2);
    assert.equal(task.ledger.tokens.total, 24);
    if (quoted) assert.equal(task.ledger.money[0].amount, 0.00008);
    else assert.equal(task.ledger.unknownPriceCalls, 2);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});
