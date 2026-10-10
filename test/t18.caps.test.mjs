import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCoordination, submitTask, register, RecoveryFixture, assertAccounted, coordinationPrompt, waitForSnapshot } from './t18-harness.mjs';

test('takeover recovery honors the smaller takeover output allowance throughout the real Native Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-takeover-cap-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { afterAdviceLength: 8, policy: { maxTokens: 512 } }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-smaller-takeover', target);
    target.failures = [{ code: 'CONNECTION' }];
    target.respond = async function* () {
      yield { type: 'text-delta', index: 0, text: 'A'.repeat(14) };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    };
    await ctx.router.setTakeoverPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, forecastTokens: 32768 });
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ reason: task.recovery?.reason, maxTokens: task.recovery?.maxTokens, entries: target.requests.length, calls: task.calls.map(call => ({ status: call.status, maxTokens: call.snapshot?.maxTokens, dispatched: call.dispatchStarted })) }));
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(target.requests.map(request => request.maxTokens), [128, 128]);
    assert.equal(task.recovery.maxTokens, 128);
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.recovery.phase, 'takeover');
    const retry = task.calls.find(call => call.recoveryId);
    assert.equal(retry.reservation.tokens.output, 128);
    assert.equal(task.recovery.finalRequest.maxTokens, 128);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 128);
    assert.equal(task.takeover.plan.finalRequest.maxTokens, 128);
    assert.equal(task.takeover.plan.finalRequest.prepared.config.maxTokens, 128);
    assert.equal(task.takeover.attempts, 1);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-takeover').length, 1);
    assert.equal(task.calls.length, 6);
    assert.equal(task.ledger.tokens.total, 72);
    assertAccounted(task, [fixture.main, fixture.advisor, target]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('the smaller takeover forecast reserves only its allowance and retains the original native image within the Task budget', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-image-cap-'));
  let ctx, running;
  try {
    const fixture = await prepareCoordination(home, { afterAdviceLength: 8, policy: { maxTokens: 512, forecastTokens: 32768 }, nativeOptions: { images: true }, mainOptions: { image: true } }); ctx = fixture.ctx;
    fixture.main.modalities = ['text', 'image'];
    const previous = await submitTask(ctx, fixture.sessionId, 'Prepare to carry the original image.');
    const target = new RecoveryFixture(); target.modalities = ['text', 'image'];
    const registration = await register(ctx, 't18-image-cap', target, { image: true });
    target.failures = [{ code: 'CONNECTION' }];
    target.respond = async function* () {
      yield { type: 'text-delta', index: 0, text: 'A'.repeat(14) };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    };
    await ctx.router.setTakeoverPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, forecastTokens: 16384 });
    await ctx.router.setBudgetDefaults({ tokens: 16500, durationMs: 60000, money: [] });
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    running = submitTask(ctx, fixture.sessionId, '', [{ type: 'text', text: coordinationPrompt }, { type: 'image', mediaType: 'image/png', data: png }]);
    const boundary = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.sessionId === fixture.sessionId && task.recovery && ['completed', 'paused', 'waiting-budget'].includes(task.lifecycle)));
    assert.equal(boundary.lifecycle, 'completed', JSON.stringify({ reason: boundary.recovery.reason, forecastTokens: boundary.recovery.forecastTokens, budget: boundary.budget.waiting, entries: target.requests.length }));
    const task = await running;
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(target.requests.map(request => request.maxTokens), [128, 128]);
    assert.equal(task.recovery.maxTokens, 128);
    assert.equal(task.recovery.forecastTokens, 16384);
    assert.equal(task.calls.find(call => call.recoveryId).reservation.tokens.total, 16384);
    assert.equal(task.takeover.plan.forecast.totalTokens, 16384);
    assert.equal(task.takeover.plan.forecast.outputTokens, 128);
    assert.equal(task.recovery.imageForecast.visualTokens, 64);
    assert.equal(task.takeover.plan.imageForecast.visualTokens, 64);
    const images = target.requests.map(request => request.messages.flatMap(message => message.content).find(part => part.type === 'image'));
    assert.deepEqual(images[1].attachment, images[0].attachment);
    const original = await ctx.attachments.readImage(images[0].attachment, new AbortController().signal);
    const retained = await ctx.attachments.readImage(images[1].attachment, new AbortController().signal);
    assert.deepEqual(retained.data, original.data);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 128);
    assert.equal(task.takeover.plan.finalRequest.prepared.config.maxTokens, 128);
    assert.equal(task.timeline.filter(event => event.kind === 'budget-wait').length, 0);
    assert.equal(task.calls.length, 6);
    assert.equal(task.ledger.tokens.total, 72);
    assertAccounted(task, [{ requests: fixture.main.requests.slice(previous.calls.length) }, fixture.advisor, target]);
  } finally {
    if (ctx) {
      for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle && ['running', 'waiting-budget', 'waiting-recovery'].includes(task.lifecycle))) await ctx.router.stopTask(task.id);
      await running?.catch(() => {}); await ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('takeover recovery honors the smaller recovery output and forecast allowances without changing the original takeover', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-recovery-cap-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { afterAdviceLength: 8, policy: { maxTokens: 128, forecastTokens: 16384 } }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-smaller-recovery', target);
    target.failures = [{ code: 'CONNECTION' }];
    target.respond = async function* () {
      yield { type: 'text-delta', index: 0, text: 'A'.repeat(14) };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    };
    await ctx.router.setTakeoverPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 512, forecastTokens: 32768 });
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ reason: task.recovery?.reason, entries: target.requests.length }));
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(target.requests.map(request => request.maxTokens), [512, 128]);
    assert.equal(task.recovery.maxTokens, 128);
    assert.equal(task.recovery.forecastTokens, 16384);
    const [original, retry] = task.calls.filter(call => call.selection.provider === 't18-smaller-recovery');
    assert.equal(original.reservation.tokens.output, 512);
    assert.equal(original.reservation.tokens.total, 32768);
    assert.equal(retry.reservation.tokens.output, 128);
    assert.equal(retry.reservation.tokens.total, 16384);
    assert.equal(task.recovery.finalRequest.maxTokens, 128);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 128);
    assert.equal(task.takeover.plan.finalRequest.maxTokens, 128);
    assert.equal(task.takeover.plan.finalRequest.prepared.config.maxTokens, 128);
    assert.deepEqual(task.takeover.plan.forecast, { inputTokens: 16256, outputTokens: 128, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 16384 });
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.takeover.attempts, 1);
    assert.equal(task.calls.length, 6);
    assert.equal(task.ledger.tokens.total, 72);
    assertAccounted(task, [fixture.main, fixture.advisor, target]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
