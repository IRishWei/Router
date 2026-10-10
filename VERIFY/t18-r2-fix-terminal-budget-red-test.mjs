import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startNative } from './t02-harness.mjs';
import { prepare, submitTask, waitForSnapshot, assertAccounted } from './t18-harness.mjs';

test('stopping a real recovery budget wait closes the recovery before terminal history is reopened', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-terminal-budget-'));
  const restoredHome = await mkdtemp(join(tmpdir(), 'router-t18-terminal-budget-read-'));
  let ctx, restored, running;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    await ctx.router.setBudgetDefaults({ tokens: 20, durationMs: 60000, money: [] });
    fixture.main.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    const waiting = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.lifecycle === 'waiting-budget' && task.recovery?.state === 'call-reserved'));
    await ctx.router.stopTask(waiting.id);
    const before = await running;
    await ctx.router.flush();
    await mkdir(join(restoredHome, 'router', 'test'), { recursive: true });
    await writeFile(join(restoredHome, 'router', 'test', 'state.json'), await readFile(join(home, 'router', 'test', 'state.json')));
    let requests = 0, tools = 0;
    restored = await startNative(restoredHome, { beforeRouter: current => {
      current.on('llm/stream', (_request, next) => { requests++; return next(); });
      current.on('tools/pre-execute', (_exec, next) => { tools++; return next(); });
    } });
    const after = (await restored.router.snapshot()).tasks.find(task => task.id === before.id);
    t.diagnostic(JSON.stringify({ before: { lifecycle: before.lifecycle, pauseReason: before.pauseReason, recoveryState: before.recovery.state, recoveryReason: before.recovery.reason }, after: { lifecycle: after.lifecycle, pauseReason: after.pauseReason, recoveryState: after.recovery.state, recoveryReason: after.recovery.reason }, requests, tools }));
    assert.equal(before.lifecycle, 'paused');
    assert.equal(before.pauseReason, 'BUDGET_STOPPED');
    assert.equal(before.recovery.state, 'paused');
    assert.equal(before.recovery.reason, 'RECOVERY_STOPPED');
    assert.equal(before.recovery.attempts, 1);
    assert.equal(before.recovery.failure.code, 'CONNECTION');
    assert.equal(before.recovery.sourceCallId, before.calls[0].id);
    assert.equal(before.calls.filter(call => call.recoveryId).length, 1);
    assert.equal(before.calls[1].dispatchStarted, false);
    assert.equal(before.calls[1].reservation.state, 'released');
    assert.equal(before.ledger.tokens.total, 12);
    assert.equal(before.ledger.unknownTokenCalls.total, 0);
    assertAccounted(before, [fixture.main]);
    assert.deepEqual(after.recovery, before.recovery);
    assert.deepEqual(after.timeline, before.timeline);
    assert.equal(after.pauseReason, before.pauseReason);
    assert.equal(after.calls.length, before.calls.length);
    assert.equal(requests, 0); assert.equal(tools, 0);
    await assert.rejects(restored.router.resolveTaskRecovery({ taskId: after.id, recoveryId: after.recovery.id, expectedRevision: after.recovery.revision, action: 'retry-current' }), { code: 'RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED' });
  } finally {
    if (ctx) { for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle)) await ctx.router.stopTask(task.id); await running; await ctx.fiber.dispose(); }
    await restored?.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    await rm(restoredHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
