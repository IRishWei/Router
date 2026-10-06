import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startNative, submit } from './t02-harness.mjs';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';

async function waitFor(ctx, predicate) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The public task state did not reach the expected boundary');
}

for (const action of ['stop', 'native-cancel']) test(`a review reservation canceled by ${action} before returning its id is released by the common gate`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-review-reserve-cancel-'));
  let ctx = await startNative(home), run, nativeSignal, reviewSignal, reserveReturned = false;
  ctx.on('agent/request', (request, next) => { nativeSignal = request.signal; return next(); });
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    reviewSignal = signal;
    const task = (await ctx.router.snapshot()).tasks.find(task => task.sessionId === agent.session.id && task.turn === turn);
    await ctx.router.reserveCall(task.id, { purpose: 'review', selection: task.activeSelection, forecast: { totalTokens: 12 } }, signal);
    reserveReturned = true;
  });
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply MAIN');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    assert.equal(reviewSignal, nativeSignal);
    if (action === 'stop') await ctx.router.stopTask(waiting.id);
    else ctx.sessionController.cancel({ sessionId });
    const task = await run, call = task.calls.find(call => call.purpose === 'review');
    assert.equal(reserveReturned, false);
    assert.equal(reviewSignal.aborted, true);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.result, 'MAIN');
    assert.equal(call.status, 'not-dispatched');
    assert.equal(call.reservation.state, 'released');
    assert.equal(call.dispatchStarted, false);
    assert.equal(call.usage, null);
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.timeline.filter(event => event.kind === 'call-settlement' && event.callId === call.id).length, 1);
    await ctx.fiber.dispose(); ctx = await startNative(home);
    const reloaded = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(reloaded.calls.find(candidate => candidate.id === call.id).reservation.state, 'released');
    assert.deepEqual(reloaded.ledger, task.ledger);
  } finally { await run; await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a complete native task reports a reproducible price snapshot and disjoint token ledger', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-ledger-'));
  const ctx = await startNative(home);
  try {
    await ctx.router.setPriceQuote('router-controlled', 'controlled', { source: 'T03 local worked example, not an official price', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 1, cacheWrite: 3 }, reasoning: 'included-in-output' });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply LEDGER_OK');
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(task.ledger.tokens.input, 8);
    assert.equal(task.ledger.tokens.output, 4);
    assert.equal(task.ledger.money[0].amount, 0.00004);
    assert.equal(task.ledger.money[0].billingConfirmation, 'unconfirmed');
    assert.equal(task.calls[0].priceQuote.source, 'T03 local worked example, not an official price');
    assert.equal(task.calls[0].reservation.tokens.total, 12);
    assert.equal(task.calls[0].reservation.state, 'settled');
    assert.ok(task.ledger.elapsedMs >= 0);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('an expected token excess waits before the native header and extension resumes the same task and signal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-budget-'));
  const ctx = await startNative(home);
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 10, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    let nativeSignal, dispatchedSignal;
    ctx.on('agent/request', ({ signal }, next) => { nativeSignal = signal; return next(); });
    ctx.on('llm/stream', async function* ({ signal }, next) { dispatchedSignal = signal; yield* next(); });
    run = submit(ctx, sessionId, 'Reply BUDGET_RESUMED');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
    assert.equal(waiting.calls[0].dispatchState, 'proposed');
    assert.equal(waiting.calls[0].reservation.state, 'waiting');
    assert.equal(waiting.ledger.callCount, 0);
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 2 });
    const task = await run;
    assert.equal(task.id, waiting.id);
    assert.equal(task.turn, waiting.turn);
    assert.equal(task.result, 'BUDGET_RESUMED');
    assert.equal(task.budget.limits.tokens, 12);
    assert.equal(task.budget.extensions.length, 1);
    assert.equal(task.calls.length, 1);
    assert.equal(task.ledger.tokens.total, 12);
    assert.equal(dispatchedSignal, nativeSignal);
    assert.equal(nativeSignal.aborted, false);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('cache and reasoning do not double charge, and one task retains separate currencies and quote versions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-currency-'));
  const ctx = await startNative(home);
  try {
    const quote = { source: 'Local worked example only', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 1, cacheWrite: 3 }, reasoning: 'included-in-output' };
    await ctx.router.setPriceQuote('router-controlled', 'controlled', quote);
    await ctx.router.setPriceQuote('router-controlled', 'controlled-tools', { ...quote, currency: 'CNY', perMillion: { input: 4, output: 12, cacheRead: 1, cacheWrite: 3 } });
    let first = true;
    ctx.on('llm/stream', async function* (_request, next) {
      const complex = first; first = false;
      for await (const chunk of next()) yield complex && chunk.type === 'usage' ? { type: 'usage', usage: { inputTokens: 100, outputTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 10, reasoningTokens: 30, totalTokens: 210 } } : chunk;
    });
    ctx.tools.register({ name: 'router_test_wait', description: 'External controlled tool', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() {
      await ctx.router.setFixedModel('controlled-tools');
      await ctx.router.setPriceQuote('router-controlled', 'controlled', { ...quote, perMillion: { input: 999, output: 999 } });
      return 'TOOL_OK';
    } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '[router:tool]\nReply CURRENCIES');
    assert.equal(task.ledger.tokens.total, 222);
    assert.equal(task.ledger.tokens.reasoning, 30);
    assert.deepEqual(task.ledger.money.map(item => [item.currency, item.amount]), [['USD', 0.00073], ['CNY', 0.00008]]);
    assert.equal(task.calls[0].priceQuote.perMillion.input, 2);
    assert.deepEqual(task.calls[0].overEstimate, ['tokens', 'money']);
    assert.equal(task.calls[0].taskId, task.calls[1].taskId);
    assert.equal(task.calls[0].cost.parts.reasoning, undefined);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('stopping a budget wait sends no call, while stopping a stream preserves its reported partial usage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-stop-'));
  const ctx = await startNative(home);
  let run;
  const entered = Promise.withResolvers();
  try {
    await ctx.router.setBudgetDefaults({ tokens: 0, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply NO_SEND');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    await ctx.router.stopTask(waiting.id);
    const stopped = await run;
    assert.equal(stopped.id, waiting.id);
    assert.equal(stopped.pauseReason, 'BUDGET_STOPPED');
    assert.equal(stopped.ledger.callCount, 0);
    assert.equal(stopped.calls[0].reservation.state, 'released');
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
    await ctx.router.setBudgetDefaults({ tokens: null, durationMs: null, money: [] });
    class Partial extends LlmAdapter {
      async listModels(provider) { return [{ provider, id: 'partial', name: 'Partial fixture' }]; }
      async resolveModel(provider, id) { return { provider, id, name: 'Partial fixture', contextWindow: 32768, maxTokens: 1024 }; }
      async *stream({ signal }) {
        yield { type: 'text-delta', index: 0, text: 'PAID_PREFIX' };
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 7 } };
        entered.resolve();
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
    }
    ctx.llm.registerAdapter(['native-partial'], new Partial());
    await ctx.router.setAutomatic(false);
    await ctx.sessionController.selectModel({ sessionId, provider: 'native-partial', model: 'partial' });
    run = submit(ctx, sessionId, 'Reply PARTIAL');
    await entered.promise;
    const active = (await ctx.router.snapshot()).tasks.at(-1);
    await ctx.router.stopTask(active.id);
    const partial = await run;
    assert.equal(partial.result, 'PAID_PREFIX');
    assert.equal(partial.pauseReason, 'BUDGET_STOPPED');
    assert.equal(partial.calls[0].status, 'interrupted');
    assert.equal(partial.ledger.tokens.total, 7);
    assert.equal(partial.ledger.unknownPriceCalls, 1);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('known failed usage and unknown failed usage remain distinct across native retries in one task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-unknown-'));
  const ctx = await startNative(home);
  try {
    class Retry extends LlmAdapter {
      attempt = 0;
      async listModels(provider) { return [{ provider, id: 'retry', name: 'Retry fixture' }]; }
      async resolveModel(provider, id) { return { provider, id, name: 'Retry fixture', contextWindow: 32768, maxTokens: 1024 }; }
      async *stream() {
        this.attempt++;
        if (this.attempt === 1) yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 7 } };
        if (this.attempt < 3) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONNECTION', message: 'Fixture interruption' } } }; return; }
        yield { type: 'text-delta', index: 0, text: 'ALL_ATTEMPTS' };
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['native-retry'], new Retry());
    await ctx.router.setAutomatic(false);
    await ctx.router.setBudgetDefaults({ tokens: 100, durationMs: null, money: [{ currency: 'USD', kind: 'api-calculated', amount: 1 }] });
    await ctx.router.setPriceQuote('native-retry', 'retry', { source: 'Synthetic API rates for accounting test; no network', date: '2026-10-07', currency: 'USD', kind: 'api-calculated', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 1, cacheWrite: 3 }, reasoning: 'included-in-output' });
    ctx.on('agent/request-error', ({ failure }, next) => failure.code === 'CONNECTION' ? { kind: 'retry' } : next());
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 'native-retry', model: 'retry' });
    const task = await submit(ctx, sessionId, 'A complete retry task');
    assert.equal(task.result, 'ALL_ATTEMPTS');
    assert.deepEqual(task.calls.map(call => [call.purpose, call.usage?.totalTokens ?? null]), [['execution', 7], ['retry', null], ['retry', 12]]);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.knownTokens.total, 19);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    assert.equal(task.ledger.money[0].amount, null);
    assert.equal(task.ledger.money[0].knownSubtotal, 0.000062);
    assert.equal(task.ledger.money[0].unknownCalls, 1);
    assert.ok(task.budget.unenforceableLimits.some(limit => limit.resource === 'tokens' && limit.reason === 'UNKNOWN_USAGE_OR_FORECAST'));
    assert.ok(task.calls.every(call => call.accountingEntry === 'task-call-v1' && call.taskId === task.id && call.reservation.state === 'settled'));
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('steer claimed during the task shares its budget, while queued input becomes the next task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-inputs-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let run;
  try {
    ctx.tools.register({ name: 'router_test_wait', description: 'External wait', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { entered.resolve(); await release.promise; return 'TOOL_OK'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '[router:tool]\nReply ORIGINAL');
    await entered.promise;
    const originalId = (await ctx.router.snapshot()).tasks.at(-1).id;
    await ctx.sessionController.prompt({ sessionId, requestId: 'correction-request', mode: 'steer', content: [{ type: 'text', text: 'Reply CORRECTED' }] }, new AbortController().signal);
    await ctx.sessionController.prompt({ sessionId, requestId: 'queued-request', mode: 'queue', content: [{ type: 'text', text: 'Reply NEXT_TASK' }] }, new AbortController().signal);
    release.resolve(); await run;
    const tasks = (await ctx.router.snapshot()).tasks;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, originalId);
    assert.equal(tasks[0].result, 'CORRECTED');
    assert.equal(tasks[0].ledger.tokens.total, 24);
    assert.ok(tasks[0].inputs.some(input => input.requestId === 'correction-request'));
    assert.ok(!tasks[0].inputs.some(input => input.requestId === 'queued-request'));
    assert.ok(tasks[1].inputs.some(input => input.requestId === 'queued-request'));
    assert.equal(tasks[1].result, 'NEXT_TASK');
    assert.notEqual(tasks[0].id, tasks[1].id);
  } finally {
    release.resolve(); if (run) await run.catch(() => {});
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('a reference-money limit waits before dispatch and changing price cannot rewrite the reserved quote', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-money-'));
  let ctx = await startNative(home), run;
  try {
    const quote = { source: 'Local budget example only', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 1, cacheWrite: 3 }, reasoning: 'included-in-output' };
    await ctx.router.setPriceQuote('router-controlled', 'controlled', quote);
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [{ currency: 'USD', kind: 'fixture-reference', amount: 0.00003 }] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply MONEY_RESUMED');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    assert.deepEqual(waiting.budget.waiting.blockedBy, [{ resource: 'money', currency: 'USD', kind: 'fixture-reference', reason: 'EXPECTED_LIMIT_EXCEEDED' }]);
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
    await ctx.router.setPriceQuote('router-controlled', 'controlled', { ...quote, perMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    await ctx.router.extendTaskBudget(waiting.id, { money: [{ currency: 'USD', kind: 'fixture-reference', amount: 0.00002 }] });
    const resumed = await run;
    assert.equal(resumed.id, waiting.id);
    assert.equal(resumed.ledger.money[0].amount, 0.00004);
    assert.equal(resumed.calls[0].priceQuote.perMillion.input, 2);
    await ctx.fiber.dispose(); ctx = await startNative(home);
    const restored = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(restored.id, resumed.id);
    assert.equal(restored.ledger.money[0].amount, 0.00004);
    assert.equal(restored.budget.extensions.length, 1);
    assert.equal(restored.budget.limits.money[0].amount, 0.00005);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('budget release after model revocation still rejects downstream dispatch and retains the original snapshot', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-revoked-'));
  const ctx = await startNative(home);
  let run, sends = 0;
  try {
    await ctx.router.setFixedModel('controlled-tools');
    await ctx.router.setBudgetDefaults({ tokens: 10, durationMs: null, money: [] });
    ctx.on('llm/stream', async function* (_request, next) { sends++; yield* next(); });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply REVOKED');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    await ctx.router.removeModel('controlled-tools');
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 2 });
    const task = await run;
    assert.equal(sends, 0);
    assert.equal(task.pauseReason, 'MODEL_REMOVED');
    assert.equal(task.id, waiting.id);
    assert.equal(task.calls[0].configVersion, waiting.calls[0].configVersion);
    assert.equal(task.calls[0].selection.model, 'controlled-tools');
    assert.equal(task.result, '');
    assert.equal(task.ledger.callCount, 0);
    assert.equal(task.ledger.tokens.total, 0);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('a time limit waits before dispatch and an explicit time extension preserves the task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-time-'));
  const ctx = await startNative(home);
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: null, durationMs: 0, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply TIME_EXTENDED');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    assert.deepEqual(waiting.budget.waiting.blockedBy, [{ resource: 'durationMs', reason: 'ELAPSED_LIMIT_EXCEEDED' }]);
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
    await ctx.router.extendTaskBudget(waiting.id, { durationMs: 60_000 });
    const task = await run;
    assert.equal(task.id, waiting.id);
    assert.equal(task.result, 'TIME_EXTENDED');
    assert.ok(task.ledger.elapsedMs > 0);
    assert.ok(task.calls[0].elapsedMs >= 0);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('native selection changed during budget waiting cannot dispatch the old assembled route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-pending-'));
  const ctx = await startNative(home);
  let run, sends = 0;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 10, durationMs: null, money: [] });
    ctx.on('llm/stream', async function* (_request, next) { sends++; yield* next(); });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply OLD_ASSEMBLY');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 2 });
    const task = await run;
    assert.equal(sends, 0);
    assert.equal(task.pauseReason, 'NATIVE_SELECTION_CHANGED');
    assert.equal(ctx.sessionProjections.stateOf(ctx.sessions.get(sessionId), 'modelSelection').pending.model, 'controlled-tools');
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('a failed budget-extension write releases the waiting native turn without dispatching', { timeout: 3000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-disk-'));
  let armed = false;
  const ctx = await startNative(home, { files: { rename, async writeFile(...args) { if (armed) { armed = false; throw new Error('Controlled disk failure'); } return writeFile(...args); } } });
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 10, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply NOT_PERSISTED');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.lifecycle === 'waiting-budget')).tasks.at(-1);
    armed = true;
    await assert.rejects(ctx.router.extendTaskBudget(waiting.id, { tokens: 2 }), /not persisted|storage is unavailable/i);
    const task = await run;
    assert.equal(task.pauseReason, 'STATE_WRITE_FAILED');
    assert.equal(task.result, '');
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

test('a dispatch-intent write failure cannot enter the real native adapter', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-intent-eio-'));
  try {
    const child = spawnSync(process.execPath, ['test/t03-dispatch-child.mjs'], { cwd: process.cwd(), env: { ...process.env, ROUTER_TEST_HOME: home, ROUTER_TEST_MODE: 'write-failure' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.adapterEntries, 0);
    assert.equal(result.task.pauseReason, 'STATE_WRITE_FAILED');
    assert.equal(result.task.result, '');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a crash after real adapter entry reloads possible consumption as unknown and never replays', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-adapter-crash-'));
  let ctx;
  try {
    const child = spawnSync(process.execPath, ['test/t03-dispatch-child.mjs'], { cwd: process.cwd(), env: { ...process.env, ROUTER_TEST_HOME: home, ROUTER_TEST_MODE: 'adapter-crash' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout.trim()).adapterEntries, 1);
    ctx = await startNative(home);
    const task = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(task.pauseReason, 'HOST_RESTARTED');
    assert.equal(task.calls[0].status, 'interrupted');
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    assert.equal(task.result, '');
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('an unpersisted not-sent clarification stays unknown after a crash', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-clear-crash-'));
  let ctx;
  try {
    const child = spawnSync(process.execPath, ['test/t03-dispatch-child.mjs'], { cwd: process.cwd(), env: { ...process.env, ROUTER_TEST_HOME: home, ROUTER_TEST_MODE: 'blocked-clear-crash' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.adapterEntries, 0);
    assert.equal(result.task.calls[0].dispatchIntent, 'blocked');
    assert.equal(result.task.ledger.callCount, 0);
    ctx = await startNative(home);
    const task = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(task.calls[0].dispatchIntent, 'possible');
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.uncertainDispatchCalls, 1);
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const concurrent of [false, true]) test(`a partial money forecast counts its known lower bound${concurrent ? ' and another held partial reservation' : ''}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-partial-money-'));
  const ctx = await startNative(home);
  let run, signal;
  try {
    await ctx.router.setPriceQuote('router-controlled', 'controlled', { source: 'Local partial forecast worked example', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6 }, reasoning: 'included-in-output' });
    await ctx.router.setBudgetDefaults({ tokens: null, durationMs: null, money: [{ currency: 'USD', kind: 'fixture-reference', amount: concurrent ? 0.0003 : 0.00004 }] });
    ctx.on('agent/request', (request, next) => { signal = request.signal; return next(); });
    ctx.tools.register({ name: 'router_test_wait', description: 'Controlled accounting boundary', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() {
      const task = (await ctx.router.snapshot()).tasks.at(-1);
      const common = { purpose: 'consultation', selection: task.activeSelection, routerSnapshot: task.calls[0].routerSnapshot };
      const ids = [await ctx.router.reserveCall(task.id, { ...common, forecast: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 115 } }, signal)];
      if (concurrent) ids.push(await ctx.router.reserveCall(task.id, { ...common, forecast: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 15 } }, signal));
      for (const id of ids) {
        await ctx.router.persistDispatchIntent(task.id, id);
        ctx.router.settleCall(task.id, id, { status: 'completed', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
      }
      return 'TOOL_OK';
    } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '[router:tool]\nReply PARTIAL_MONEY');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.filter(call => call.purpose === 'consultation').length >= (concurrent ? 2 : 1))).tasks.at(-1);
    assert.equal(waiting.lifecycle, 'waiting-budget');
    assert.equal(waiting.budget.waiting.proposedMoney.amount, null);
    assert.ok(Math.abs(waiting.budget.waiting.proposedMoney.knownSubtotal - (concurrent ? 0.00002 : 0.00026)) < 1e-15);
    assert.equal(waiting.ledger.money[0].amount, 0.00004);
    assert.deepEqual(waiting.budget.waiting.blockedBy, [{ resource: 'money', currency: 'USD', kind: 'fixture-reference', reason: 'EXPECTED_LIMIT_EXCEEDED' }]);
    await ctx.router.extendTaskBudget(waiting.id, { money: [{ currency: 'USD', kind: 'fixture-reference', amount: concurrent ? 0.00004 : 0.00027 }] });
    const task = await run;
    assert.equal(task.id, waiting.id);
    assert.equal(task.result, 'PARTIAL_MONEY');
    assert.equal(task.calls[1].reservation.money.amount, null);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of ['revoke', 'native-pending', 'abort']) test(`the durable-intent wait rechecks ${scenario} before downstream consumption`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-intent-window-'));
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let held = false, run, command, signal, sessionId, taskId, sends = 0;
  const ctx = await startNative(home, { files: { rename, async writeFile(path, data, options) {
    const call = JSON.parse(data).tasks.at(-1)?.calls.at(-1);
    if (!held && call?.dispatchIntent === 'possible' && !call.dispatchStarted) { held = true; entered.resolve(); await release.promise; }
    return writeFile(path, data, options);
  } } });
  try {
    ctx.on('agent/request', async (request, next) => { signal = request.signal; const config = await next(); taskId = (await ctx.router.snapshot()).tasks.at(-1).id; return config; });
    ctx.on('llm/stream', async function* (_request, next) { sends++; yield* next(); });
    ({ sessionId } = await ctx.sessionController.create({ cwd: home }));
    run = submit(ctx, sessionId, 'Reply SHOULD_NOT_DISPATCH');
    await entered.promise;
    if (scenario === 'revoke') command = ctx.router.removeModel('controlled');
    if (scenario === 'native-pending') await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    if (scenario === 'abort') command = ctx.router.stopTask(taskId);
    release.resolve(); if (command) await command;
    const task = await run;
    assert.equal(sends, 0);
    assert.equal(task.result, '');
    assert.equal(task.pauseReason, scenario === 'revoke' ? 'MODEL_REMOVED' : scenario === 'native-pending' ? 'NATIVE_SELECTION_CHANGED' : 'BUDGET_STOPPED');
    assert.equal(task.ledger.callCount, 0);
    assert.equal(signal.aborted, scenario === 'abort');
    if (scenario === 'native-pending') assert.equal(ctx.sessionProjections.stateOf(ctx.sessions.get(sessionId), 'modelSelection').pending.model, 'controlled-tools');
  } finally {
    release.resolve(); if (command) await command.catch(() => {});
    if (run) { ctx.agents.get(sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});

for (const legacy of [false, true]) test(`restart retains unknown consumption for ${legacy ? 'a legacy 0.3.0 ambiguous header' : 'a durable intent before adapter entry'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-intent-crash-'));
  let ctx;
  try {
    const child = spawnSync(process.execPath, ['test/t03-dispatch-child.mjs'], { cwd: process.cwd(), env: { ...process.env, ROUTER_TEST_HOME: home, ROUTER_TEST_MODE: 'intent-crash' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout.trim()).adapterEntries, 0);
    if (legacy) {
      const path = join(home, 'router', 'test', 'state.json');
      const state = JSON.parse(await readFile(path, 'utf8'));
      const call = state.tasks.at(-1).calls[0];
      delete call.dispatchProtocol; delete call.dispatchIntent; delete call.dispatchIntentAt;
      state.tasks.at(-1).budget.unenforceableLimits = ['tokens: unknown usage or forecast; only known consumption is enforceable', 'money:USD:api-calculated: unknown usage, missing price or different currency; amount forecast cannot be enforced'];
      const notSent = structuredClone(state.tasks.at(-1));
      notSent.id = 'legacy-explicit-not-sent'; notSent.lifecycle = 'paused'; notSent.pauseReason = 'BUDGET_STOPPED'; notSent.endedAt = notSent.startedAt;
      notSent.calls[0].taskId = notSent.id; notSent.calls[0].status = 'not-dispatched'; notSent.calls[0].dispatchState = 'proposed'; notSent.calls[0].reservation.state = 'released';
      state.tasks.unshift(notSent);
      await writeFile(path, JSON.stringify(state));
    }
    ctx = await startNative(home);
    const task = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(task.pauseReason, 'HOST_RESTARTED');
    assert.equal(task.calls[0].status, 'interrupted');
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    if (legacy) assert.deepEqual(task.budget.unenforceableLimits, [{ resource: 'tokens', reason: 'UNKNOWN_USAGE_OR_FORECAST' }, { resource: 'money', currency: 'USD', kind: 'api-calculated', reason: 'UNKNOWN_PRICE_USAGE_OR_CURRENCY' }]);
    if (legacy) {
      const notSent = (await ctx.router.snapshot()).tasks.find(task => task.id === 'legacy-explicit-not-sent');
      assert.equal(notSent.calls[0].status, 'not-dispatched');
      assert.equal(notSent.ledger.callCount, 0);
      assert.equal(notSent.ledger.tokens.total, 0);
    }
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('upgrade corrects an ambiguous record already restarted and saved by 0.3.0 without resetting its task context', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-legacy-saved-'));
  let ctx, sends = 0;
  try {
    // Captured from real 0.3.0: adapter entered, marker EIO, crash, old restart, public settings save.
    const state = JSON.parse(await readFile(new URL('./fixtures/t03-legacy-restarted.json', import.meta.url), 'utf8'));
    const before = structuredClone(state.tasks[0]);
    const variants = [
      { id: 'budget-wait-proven-unsent', lifecycle: 'waiting-budget', status: 'waiting', dispatchState: 'proposed' },
      { id: 'restarted-proposed-unsent', lifecycle: 'paused', status: 'not-dispatched', dispatchState: 'proposed' },
      { id: 'revoked-header-proven-unsent', lifecycle: 'paused', status: 'not-dispatched', dispatchState: 'header-confirmed', pauseReason: 'MODEL_REMOVED' },
      { id: 'new-protocol-blocked-unsent', lifecycle: 'paused', status: 'not-dispatched', dispatchState: 'header-confirmed', dispatchProtocol: 'durable-intent-v2', dispatchIntent: 'blocked' },
    ];
    for (const variant of variants) {
      const task = structuredClone(before);
      task.id = variant.id; task.lifecycle = variant.lifecycle;
      task.pauseReason = variant.pauseReason ?? 'HOST_RESTARTED';
      Object.assign(task.calls[0], { taskId: task.id, status: variant.status, dispatchState: variant.dispatchState });
      if (variant.dispatchProtocol) Object.assign(task.calls[0], { dispatchProtocol: variant.dispatchProtocol, dispatchIntent: variant.dispatchIntent });
      state.tasks.push(task);
    }
    await mkdir(join(home, 'router', 'test'), { recursive: true });
    await writeFile(join(home, 'router', 'test', 'state.json'), JSON.stringify(state));
    ctx = await startNative(home);
    ctx.on('llm/stream', async function* (_request, next) { sends++; yield* next(); });
    const snapshot = await ctx.router.snapshot(), task = snapshot.tasks.find(task => task.id === before.id);
    assert.equal(task.calls[0].status, 'interrupted');
    assert.equal(task.calls[0].dispatchUncertain, true);
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    assert.equal(task.ledger.money[0].amount, null);
    assert.equal(task.ledger.money[0].unknownCalls, 1);
    assert.equal(task.ledger.uncertainDispatchCalls, 1);
    for (const key of ['id', 'sessionId', 'turn', 'configVersion', 'activeSelection', 'inputs', 'startedAt', 'endedAt', 'result']) assert.deepEqual(task[key], before[key]);
    for (const key of ['id', 'taskId', 'selection', 'priceQuote', 'routerSnapshot', 'configVersion', 'reservation']) assert.deepEqual(task.calls[0][key], before.calls[0][key]);
    assert.deepEqual(task.budget.limits, before.budget.limits);
    assert.deepEqual(task.budget.extensions, before.budget.extensions);
    assert.deepEqual(snapshot.config.budget, state.config.budget);
    assert.deepEqual(snapshot.config.prices, state.config.prices);
    for (const variant of variants) {
      const unsent = snapshot.tasks.find(task => task.id === variant.id);
      assert.equal(unsent.ledger.callCount, 0, variant.id);
      assert.equal(unsent.ledger.tokens.total, 0, variant.id);
    }
    assert.equal(sends, 0);
    await ctx.router.setAutomatic(false); // Preserve the correction through the public persistence seam.
    await ctx.fiber.dispose(); ctx = await startNative(home);
    const reloaded = (await ctx.router.snapshot()).tasks.find(task => task.id === before.id);
    assert.equal(reloaded.calls[0].status, 'interrupted');
    assert.equal(reloaded.ledger.unknownTokenCalls.total, 1);
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('legacy 0.3.2 title-clobbered v1 markers migrate as uncertain without discarding known usage or task context', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-legacy-title-'));
  let ctx;
  try {
    const state = JSON.parse(await readFile(new URL('./fixtures/t03-legacy-title-restarted.json', import.meta.url), 'utf8'));
    const before = structuredClone(state.tasks[0]);
    const known = structuredClone(before);
    known.id = 'legacy-title-known-usage'; known.calls[0].taskId = known.id;
    known.calls[0].usage = { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 };
    state.tasks.push(known);
    await mkdir(join(home, 'router', 'test'), { recursive: true });
    await writeFile(join(home, 'router', 'test', 'state.json'), JSON.stringify(state));
    ctx = await startNative(home);
    const snapshot = await ctx.router.snapshot(), task = snapshot.tasks[0];
    assert.equal(task.calls[0].status, 'interrupted');
    assert.equal(task.calls[0].dispatchStarted, false);
    assert.equal(task.calls[0].dispatchUncertain, true);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.ledger.callCount, 1);
    assert.equal(task.ledger.unknownTokenCalls.total, 1);
    for (const key of ['id', 'sessionId', 'turn', 'configVersion', 'activeSelection', 'inputs', 'startedAt', 'endedAt', 'result']) assert.deepEqual(task[key], before[key]);
    for (const key of ['id', 'taskId', 'selection', 'priceQuote', 'routerSnapshot', 'configVersion', 'reservation']) assert.deepEqual(task.calls[0][key], before.calls[0][key]);
    assert.deepEqual(task.budget, before.budget);
    assert.equal(snapshot.tasks[1].ledger.tokens.total, 12);
    assert.equal(snapshot.tasks[1].ledger.unknownTokenCalls.total, 0);
    assert.deepEqual(snapshot.tasks[1].calls[0].usage, known.calls[0].usage);
    await ctx.router.setAutomatic(false);
    await ctx.fiber.dispose(); ctx = await startNative(home);
    assert.equal((await ctx.router.snapshot()).tasks[0].ledger.unknownTokenCalls.total, 1);
  } finally { if (ctx) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});
