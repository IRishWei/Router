import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { prepareCoordination, submitTask, assertAccounted, coordinationPrompt, waitForSnapshot } from './t18-harness.mjs';

test('a real consultation recovery obeys the smaller recovery cap with one owned intent and one advice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-consult-recovery-cap-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { policy: { maxTokens: 64, forecastTokens: 4096 } }); ctx = fixture.ctx;
    await ctx.router.setCoordinationPolicy({ ...(await ctx.router.snapshot()).config.coordination, maxTokens: 128, forecastTokens: 8192 });
    fixture.advisor.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.lifecycle, 'completed', task.recovery?.reason);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(fixture.advisor.requests.map(request => request.maxTokens), [128, 64]);
    assert.equal(task.recovery.maxTokens, 64);
    assert.equal(task.recovery.forecastTokens, 4096);
    assert.equal(task.recovery.phase, 'consultation');
    assert.equal(task.recovery.attempts, 1);
    const [original, retry] = task.calls.filter(call => call.purpose === 'consultation');
    assert.equal(original.reservation.tokens.output, 128);
    assert.ok(original.reservation.tokens.total <= 8192);
    assert.equal(original.snapshot.maxTokens, 128);
    assert.equal(retry.reservation.tokens.output, 64);
    assert.equal(retry.reservation.tokens.input, 4032);
    assert.equal(retry.reservation.tokens.total, 4096);
    assert.equal(retry.snapshot.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.callId, retry.id);
    assert.equal(task.recovery.finalRequest.ownedRequest, true);
    assert.equal(task.recovery.finalRequest.nativeRequest, false);
    assert.equal(isAgentLoopRequest(fixture.advisor.requests[1]), false);
    assert.ok(Object.isFrozen(fixture.advisor.requests[1]));
    assert.deepEqual(fixture.advisor.requests[1].messages, fixture.advisor.requests[0].messages);
    assert.equal(task.coordination.consultationAttempts, 1);
    const consultation = task.coordination.episodes[0].consultation;
    assert.equal(consultation.state, 'advice-delivered');
    assert.deepEqual(consultation.callIds, [original.id, retry.id]);
    assert.equal(consultation.callId, retry.id);
    assert.ok([original, retry].every(call => call.consultationIntentCallId === original.id));
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
    assert.equal(fixture.nativeRequests.length, 3);
    assertAccounted(task, [fixture.main, fixture.advisor]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a copied consultation recovery request cannot inherit the original owned request identity', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-consult-owned-identity-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { policy: { maxTokens: 64, forecastTokens: 4096 } }); ctx = fixture.ctx;
    fixture.advisor.failures = [{ code: 'CONNECTION' }];
    let copied = false;
    ctx.on('llm/stream', (request, next) => {
      if (request.provider === 't18-advisor' && request.maxTokens === 64 && !copied) {
        copied = true;
        return ctx.llm.stream({ ...request });
      }
      return next();
    }, { prepend: true });
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    t.diagnostic(JSON.stringify({ pauseReason: task.pauseReason, recoveryState: task.recovery.state, recoveryReason: task.recovery.reason, calls: task.calls.map(call => ({ purpose: call.purpose, status: call.status, dispatched: call.dispatchStarted, failureCode: call.failureCode })) }));
    assert.equal(copied, true);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery.state, 'paused');
    assert.equal(fixture.advisor.requests.length, 1);
    const [original, retry] = task.calls.filter(call => call.purpose === 'consultation');
    assert.equal(original.failure.code, 'CONNECTION');
    assert.equal(retry.dispatchStarted, false);
    assert.equal(retry.reservation.state, 'released');
    assert.equal(task.coordination.consultationAttempts, 1);
    assert.deepEqual(task.coordination.episodes[0].consultation.callIds, [original.id, retry.id]);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 0);
    const blocked = (await ctx.router.snapshot()).blockedRequests;
    assert.ok(blocked.some(request => request.provider === 't18-advisor' && request.status === 'not-dispatched' && request.reason === 'AUXILIARY_TASK_UNAVAILABLE'));
    assert.equal(task.ledger.tokens.total, 36);
    assert.equal(task.ledger.unknownTokenCalls.total, 0);
    assertAccounted(task, [fixture.main, fixture.advisor]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a real consultation recovery keeps the smaller consultation cap and forecast within the finite Task budget', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-consult-policy-cap-'));
  let ctx, running;
  try {
    const fixture = await prepareCoordination(home, { policy: { maxTokens: 128, forecastTokens: 8192 } }); ctx = fixture.ctx;
    await ctx.router.setCoordinationPolicy({ ...(await ctx.router.snapshot()).config.coordination, maxTokens: 64, forecastTokens: 4096 });
    await ctx.router.setBudgetDefaults({ tokens: 4500, durationMs: 60000, money: [] });
    fixture.advisor.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId, coordinationPrompt);
    const boundary = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.sessionId === fixture.sessionId && task.recovery && ['completed', 'paused', 'waiting-budget'].includes(task.lifecycle)));
    assert.equal(boundary.lifecycle, 'completed', JSON.stringify({ reason: boundary.recovery.reason, forecastTokens: boundary.recovery.forecastTokens, budget: boundary.budget.waiting, entries: fixture.advisor.requests.length }));
    const task = await running;
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(fixture.advisor.requests.map(request => request.maxTokens), [64, 64]);
    assert.equal(task.recovery.maxTokens, 64);
    assert.equal(task.recovery.forecastTokens, 4096);
    const [original, retry] = task.calls.filter(call => call.purpose === 'consultation');
    assert.equal(original.reservation.tokens.output, 64);
    assert.ok(original.reservation.tokens.total <= 4096);
    assert.equal(original.snapshot.maxTokens, 64);
    assert.equal(retry.reservation.tokens.output, 64);
    assert.equal(retry.reservation.tokens.input, 4032);
    assert.equal(retry.reservation.tokens.total, 4096);
    assert.equal(retry.snapshot.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.ownedRequest, true);
    assert.deepEqual(fixture.advisor.requests[1].messages, fixture.advisor.requests[0].messages);
    assert.equal(task.coordination.consultationAttempts, 1);
    assert.deepEqual(task.coordination.episodes[0].consultation.callIds, [original.id, retry.id]);
    assert.equal(task.coordination.episodes[0].consultation.callId, retry.id);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(task.timeline.filter(event => event.kind === 'budget-wait').length, 0);
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
    assertAccounted(task, [fixture.main, fixture.advisor]);
  } finally {
    if (ctx) {
      for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle && ['running', 'waiting-budget', 'waiting-recovery'].includes(task.lifecycle))) await ctx.router.stopTask(task.id);
      await running?.catch(() => {}); await ctx.fiber.dispose();
    }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
