import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';

async function waitFor(ctx, predicate) {
  for (let i = 0; i < 200; i++) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The public reservation task did not reach the boundary');
}

test('a parallel reservation keeps its completed native task active until extension and its exact runner settle', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-parallel-reserve-'));
  const ctx = await startNative(home);
  let worker, originalSignal;
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId && !worker) {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      originalSignal = request.signal;
      worker = (async () => {
        const id = await ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: task.calls[0].selection, forecast: { totalTokens: 12 } }, originalSignal);
        const stream = ctx.router.streamReservedCall(task.id, id, { provider: request.provider, model: request.model, signal: originalSignal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply CONSULTED' }] })] });
        for await (const _chunk of stream) {}
        return id;
      })().then(id => ({ id }), error => ({ error }));
    }
    yield* next();
  }, { prepend: true });
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    const waiting = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(waiting.lifecycle, 'waiting-budget');
    assert.equal(waiting.nativeLifecycle, 'completed');
    assert.equal(waiting.result, 'MAIN');
    assert.equal(waiting.ledger.tokens.total, 12);
    assert.equal(originalSignal.aborted, false);
    assert.equal((await ctx.router.snapshot()).application.active[0].taskId, waiting.id);
    const call = waiting.calls.find(call => call.purpose === 'consultation');
    assert.equal(call.reservation.state, 'waiting');
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 12 });
    assert.deepEqual(await worker, { id: call.id });
    const task = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'completed')).tasks.at(-1);
    assert.equal(task.id, waiting.id);
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls.find(candidate => candidate.id === call.id).usage.totalTokens, 12);
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === call.id).length, 1);
  } finally { await ctx.fiber.dispose(); await worker; await rm(home, { recursive: true, force: true }); }
});

test('stopping a returned but unbound reservation releases it and rejects a later runner', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-unbound-stop-'));
  const ctx = await startNative(home);
  let id, originalSignal, route;
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId && !id) {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      originalSignal = request.signal; route = task.calls[0].selection;
      id = await ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: route, forecast: { totalTokens: 12 } }, originalSignal);
    }
    yield* next();
  }, { prepend: true });
  try {
    await ctx.router.setBudgetDefaults({ tokens: 24, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const before = await submit(ctx, sessionId, 'Reply MAIN');
    assert.equal(before.nativeLifecycle, 'completed');
    assert.equal(before.calls.find(call => call.id === id).reservation.state, 'reserved');
    await ctx.router.stopTask(before.id);
    const task = (await ctx.router.snapshot()).tasks.at(-1), call = task.calls.find(call => call.id === id);
    assert.equal(call.reservation.state, 'released');
    assert.equal(call.status, 'not-dispatched');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'BUDGET_STOPPED');
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(task.result, 'MAIN');
    assert.equal(originalSignal.aborted, false);
    assert.throws(() => ctx.router.streamReservedCall(task.id, id, { provider: route.provider, model: route.model, signal: originalSignal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply LATE' }] })] }), /does not own/);
    assert.equal(call.dispatchStarted, false);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === id).length, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('an original caller signal abort releases a returned reservation before any runner is bound', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-unbound-abort-'));
  const ctx = await startNative(home), controller = new AbortController();
  let id, route;
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId && !id) {
      const task = (await ctx.router.snapshot()).tasks.at(-1); route = task.calls[0].selection;
      id = await ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: route, forecast: { totalTokens: 12 } }, controller.signal);
    }
    yield* next();
  }, { prepend: true });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const before = await submit(ctx, sessionId, 'Reply MAIN');
    const reason = new Error('Original consultation canceled before binding'); controller.abort(reason);
    const state = await ctx.router.snapshot(), task = state.tasks.at(-1), call = task.calls.find(call => call.id === id);
    assert.equal(call.reservation.state, 'released');
    assert.equal(call.status, 'not-dispatched');
    assert.equal(task.id, before.id);
    assert.equal(task.result, 'MAIN');
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(state.application.active.length, 0);
    assert.equal(controller.signal.reason, reason);
    assert.throws(() => ctx.router.streamReservedCall(task.id, id, { provider: route.provider, model: route.model, signal: controller.signal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply LATE' }] })] }), /does not own/);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === id).length, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const action of ['stop', 'original-abort', 'native-cancel']) test(`a parallel waiting reservation is released by ${action} without losing the caller error`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-parallel-cancel-'));
  const ctx = await startNative(home), controller = new AbortController(), held = Promise.withResolvers();
  let worker, originalSignal, run;
  ctx.on('llm/stream', async function* (request, next) {
    const primary = request.sessionId && !worker;
    if (primary) {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      originalSignal = action === 'original-abort' ? controller.signal : request.signal;
      worker = ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: task.calls[0].selection, forecast: { totalTokens: 12 } }, originalSignal).then(id => ({ id }), error => ({ error }));
    }
    yield* next();
    if (primary && action === 'native-cancel') {
      held.resolve();
      await new Promise((_resolve, reject) => { originalSignal.addEventListener('abort', () => reject(originalSignal.reason), { once: true }); originalSignal.throwIfAborted(); });
    }
  }, { prepend: true });
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply MAIN');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.some(call => call.purpose === 'consultation' && call.status === 'waiting'))).tasks.at(-1);
    const reason = new Error('Original caller cancellation');
    if (action === 'stop') { await run; await ctx.router.stopTask(waiting.id); }
    if (action === 'original-abort') { await run; controller.abort(reason); }
    if (action === 'native-cancel') { await held.promise; ctx.sessionController.cancel({ sessionId }); }
    await run;
    const outcome = await worker;
    assert.equal(outcome.id, undefined);
    if (action === 'original-abort') assert.equal(outcome.error, reason);
    else if (action === 'native-cancel') assert.equal(outcome.error, originalSignal.reason);
    else assert.equal(outcome.error.code, 'ABORTED');
    const state = await ctx.router.snapshot(), task = state.tasks.at(-1), call = task.calls.find(call => call.purpose === 'consultation');
    assert.equal(call.status, 'not-dispatched');
    assert.equal(call.reservation.state, 'released');
    assert.equal(call.dispatchStarted, false);
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(task.result, 'MAIN');
    assert.equal(state.application.active.length, 0);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === call.id).length, 1);
  } finally { if (run) { ctx.sessionController.cancel({ sessionId: (await ctx.router.snapshot()).tasks.at(-1)?.sessionId }); await run; } await ctx.fiber.dispose(); await worker; await rm(home, { recursive: true, force: true }); }
});

for (const action of ['extend', 'stop']) test(`a proposed parallel reservation awaiting its first durable write remains owned until ${action}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-proposed-reserve-'));
  const held = Promise.withResolvers(), release = Promise.withResolvers(), ended = Promise.withResolvers();
  let blocked = false, worker, source, originalSignal;
  const files = { rename, async writeFile(path, data, options) {
    if (!blocked && JSON.parse(data).tasks.some(task => task.calls.some(call => call.purpose === 'consultation' && call.dispatchState === 'proposed'))) { blocked = true; held.resolve(); await release.promise; }
    return writeFile(path, data, options);
  } };
  const ctx = await startNative(home, { files });
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId) { source = (await ctx.router.snapshot()).tasks.at(-1); originalSignal = request.signal; }
    yield* next();
  }, { prepend: true });
  ctx.on('agent/turn-stopping', () => {
    worker = (async () => {
      const id = await ctx.router.reserveCall(source.id, { purpose: 'consultation', selection: source.calls[0].selection, forecast: { totalTokens: 12 } }, originalSignal);
      const stream = ctx.router.streamReservedCall(source.id, id, { provider: source.activeSelection.provider, model: source.activeSelection.model, signal: originalSignal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply CONSULTED' }] })] });
      for await (const _chunk of stream) {}
      return id;
    })().then(id => ({ id }), error => ({ error }));
  });
  ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') ended.resolve(); });
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.prompt({ sessionId, requestId: 'proposed-task', mode: 'queue', content: [{ type: 'text', text: 'Reply MAIN' }] }, new AbortController().signal);
    await held.promise; await ended.promise; await ctx.agents.get(sessionId).whenIdle();
    const command = (action === 'extend' ? ctx.router.extendTaskBudget(source.id, { tokens: 12 }) : ctx.router.stopTask(source.id)).then(state => ({ state }), error => ({ error }));
    release.resolve();
    const result = await command;
    assert.equal(result.error, undefined);
    const outcome = await worker;
    const state = await ctx.router.snapshot(), task = state.tasks.at(-1), call = task.calls.find(call => call.purpose === 'consultation');
    assert.equal(task.id, source.id);
    assert.equal(task.nativeLifecycle, 'completed');
    assert.equal(task.result, 'MAIN');
    assert.equal(task.ledger.tokens.total, action === 'extend' ? 24 : 12);
    assert.equal(state.application.active.length, 0);
    if (action === 'extend') { assert.equal(outcome.id, call.id); assert.equal(call.status, 'completed'); }
    else { assert.equal(outcome.error.code, 'ABORTED'); assert.equal(call.status, 'not-dispatched'); assert.equal(call.reservation.state, 'released'); assert.equal(call.dispatchStarted, false); }
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === call.id).length, 1);
  } finally { release.resolve(); await ctx.fiber.dispose(); await worker; await rm(home, { recursive: true, force: true }); }
});

for (const waiting of [false, true]) test(`disabling Router releases ${waiting ? 'a waiting' : 'a returned'} unbound reservation with a visible terminal reason`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-reservation-dispose-'));
  const ctx = await startNative(home), router = ctx.router;
  let worker;
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId && !worker) {
      const task = (await router.snapshot()).tasks.at(-1);
      worker = router.reserveCall(task.id, { purpose: 'consultation', selection: task.calls[0].selection, forecast: { totalTokens: 12 } }, request.signal).then(id => ({ id }), error => ({ error }));
    }
    yield* next();
  }, { prepend: true });
  try {
    await router.setBudgetDefaults({ tokens: waiting ? 12 : null, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply MAIN');
    await ctx.fiber.dispose();
    const outcome = await worker;
    if (waiting) { assert.equal(outcome.error.code, 'MODEL_NOT_FOUND'); assert.match(outcome.error.message, /Router disabled during budget wait/); }
    const state = await router.snapshot(), task = state.tasks.at(-1), call = task.calls.find(call => call.purpose === 'consultation');
    assert.equal(call.reservation.state, 'released');
    assert.equal(call.status, 'not-dispatched');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'ROUTER_DISABLED');
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(state.application.active.length, 0);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a stopped unbound call cannot bind while another precise stream still keeps the task active', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-unbound-held-owner-'));
  const ctx = await startNative(home), held = Promise.withResolvers(), release = Promise.withResolvers();
  let id, originalSignal, route, running;
  ctx.on('llm/stream', async function* (request, next) {
    if (!request.sessionId) { held.resolve(); await release.promise; }
    else if (!id) {
      const task = (await ctx.router.snapshot()).tasks.at(-1); route = task.calls[0].selection; originalSignal = request.signal;
      const details = { purpose: 'consultation', selection: route, forecast: { totalTokens: 12 } };
      id = await ctx.router.reserveCall(task.id, details, originalSignal);
      const secondId = await ctx.router.reserveCall(task.id, details, originalSignal);
      const stream = ctx.router.streamReservedCall(task.id, secondId, { provider: route.provider, model: route.model, signal: originalSignal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply HELD' }] })] });
      running = (async () => { for await (const _chunk of stream) {} })().catch(error => error);
      await held.promise;
    }
    yield* next();
  }, { prepend: true });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const before = await submit(ctx, sessionId, 'Reply MAIN');
    const stopped = await ctx.router.stopTask(before.id);
    assert.equal(stopped.application.active.some(entry => entry.taskId === before.id), true);
    assert.equal(stopped.tasks.at(-1).calls.find(call => call.id === id).reservation.state, 'released');
    assert.throws(() => ctx.router.streamReservedCall(before.id, id, { provider: route.provider, model: route.model, signal: originalSignal, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply LATE' }] })] }), /does not own/);
    release.resolve(); await running;
    const state = await waitFor(ctx, state => state.application.active.length === 0), task = state.tasks.at(-1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'BUDGET_STOPPED');
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(task.calls.every(call => call.purpose !== 'consultation' || !call.dispatchStarted), true);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === id).length, 1);
    assert.equal(originalSignal.aborted, false);
  } finally { release.resolve(); await running; await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('stopping an old task parallel reservation cannot cancel the same session queued native turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-old-reservation-stop-'));
  const ctx = await startNative(home), entered = Promise.withResolvers(), release = Promise.withResolvers();
  let worker, nextRun, nextSignal;
  ctx.on('agent/request', (request, next) => { nextSignal = request.signal; return next(); });
  ctx.on('llm/stream', async function* (request, next) {
    if (request.sessionId && !worker) {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      worker = ctx.router.reserveCall(task.id, { purpose: 'consultation', selection: task.calls[0].selection, forecast: { totalTokens: 12 } }, request.signal).catch(error => error);
    }
    yield* next();
  }, { prepend: true });
  ctx.tools.register({ name: 'router_test_wait', description: 'Hold the next native task', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { entered.resolve(); await release.promise; return 'TOOL_OK'; } });
  ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const old = await submit(ctx, sessionId, 'Reply OLD');
    await ctx.router.setBudgetDefaults({ tokens: null, durationMs: null, money: [] });
    nextRun = submit(ctx, sessionId, '[router:tool]\nReply NEXT'); await entered.promise;
    await ctx.router.stopTask(old.id);
    assert.equal((await worker).code, 'ABORTED');
    assert.equal(nextSignal.aborted, false);
    release.resolve(); const current = await nextRun;
    assert.notEqual(current.id, old.id);
    assert.equal(current.lifecycle, 'completed');
    assert.equal(current.result, 'NEXT');
    assert.equal(current.ledger.tokens.total, 24);
    const previous = (await ctx.router.snapshot()).tasks.find(task => task.id === old.id);
    assert.equal(previous.lifecycle, 'paused');
    assert.equal(previous.pauseReason, 'BUDGET_STOPPED');
    assert.equal(previous.result, 'OLD');
    assert.equal(previous.ledger.tokens.total, 12);
    assert.equal(previous.calls.find(call => call.purpose === 'consultation').reservation.state, 'released');
  } finally { release.resolve(); await nextRun; await ctx.fiber.dispose(); await worker; await rm(home, { recursive: true, force: true }); }
});
