import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { prepare, prepareCoordination, register, RecoveryFixture, submitTask, assertAccounted, coordinationPrompt } from './t18-harness.mjs';

test('compatible native allocation retains its initial ceiling and uses the smaller recovery allowance for the new Call', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-compatible-native-cap-'));
  let ctx;
  try {
    const fixture = await prepare(home, { mainOptions: { billingPath: 'compatible-unconfirmed' }, policy: { maxTokens: 64, forecastTokens: 4096 } }); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId);
    t.diagnostic(JSON.stringify({ lifecycle: task.lifecycle, recoveryReason: task.recovery.reason, maxTokens: task.recovery.maxTokens, actualMaxTokens: fixture.main.requests.map(request => request.maxTokens), calls: task.calls.length }));
    assert.equal(task.lifecycle, 'completed', task.recovery.reason);
    assert.deepEqual(fixture.main.requests.map(request => request.maxTokens), [1024, 64]);
    assert.equal(task.recovery.state, 'completed');
    assert.equal(task.recovery.maxTokens, 64);
    assert.equal(task.recovery.forecastTokens, 4096);
    const retry = task.calls.find(call => call.recoveryId);
    assert.equal(retry.reservation.tokens.input, 4032);
    assert.equal(retry.reservation.tokens.output, 64);
    assert.equal(retry.reservation.tokens.total, 4096);
    assert.equal(task.recovery.finalRequest.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 64);
    assert.ok(fixture.nativeRequests.every(isAgentLoopRequest));
    assert.equal(task.recovery.finalRequest.nativeRequest, true);
    assert.equal(fixture.nativeRequests.length, 2);
    assert.equal(task.recovery.target.candidateId, fixture.registration.candidate.candidateId);
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.calls.length, 2);
    assert.equal(task.ledger.tokens.total, 24);
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('compatible owned consultation allocation preserves the consultation cap before recovery and the smaller frozen cap afterward', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-compatible-consult-cap-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { policy: { maxTokens: 64, forecastTokens: 4096 } }); ctx = fixture.ctx;
    const advisor = new RecoveryFixture();
    const registration = await register(ctx, 'router-compatible-t18-advisor', advisor, { billingPath: 'compatible-unconfirmed' });
    await ctx.router.setCoordinationPolicy({ ...(await ctx.router.snapshot()).config.coordination, candidateId: registration.candidate.candidateId, maxTokens: 128, forecastTokens: 8192 });
    advisor.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    t.diagnostic(JSON.stringify({ lifecycle: task.lifecycle, recoveryReason: task.recovery.reason, recoveryMaxTokens: task.recovery.maxTokens, actualMaxTokens: advisor.requests.map(request => request.maxTokens) }));
    assert.equal(task.lifecycle, 'completed', task.recovery.reason);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(advisor.requests.map(request => request.maxTokens), [128, 64]);
    assert.equal(task.recovery.maxTokens, 64);
    assert.equal(task.recovery.forecastTokens, 4096);
    const [original, retry] = task.calls.filter(call => call.purpose === 'consultation');
    assert.equal(original.snapshot.maxTokens, 128);
    assert.equal(original.reservation.tokens.output, 128);
    assert.equal(retry.snapshot.maxTokens, 64);
    assert.equal(retry.reservation.tokens.input, 4032);
    assert.equal(retry.reservation.tokens.output, 64);
    assert.equal(retry.reservation.tokens.total, 4096);
    assert.equal(task.recovery.finalRequest.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 64);
    assert.equal(task.recovery.finalRequest.ownedRequest, true);
    assert.equal(task.recovery.finalRequest.callId, retry.id);
    assert.equal(task.coordination.consultationAttempts, 1);
    assert.deepEqual(task.coordination.episodes[0].consultation.callIds, [original.id, retry.id]);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(fixture.advisor.requests.length, 0);
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
    assertAccounted(task, [fixture.main, advisor]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('execution recovery cannot enlarge the original native request allowance even when its recovery policy is larger', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-compatible-native-ceiling-'));
  let ctx;
  try {
    const fixture = await prepare(home, { mainOptions: { billingPath: 'compatible-unconfirmed' }, policy: { maxTokens: 2048, forecastTokens: 8192 } }); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId);
    t.diagnostic(JSON.stringify({ lifecycle: task.lifecycle, recoveryMaxTokens: task.recovery.maxTokens, actualMaxTokens: fixture.main.requests.map(request => request.maxTokens) }));
    assert.equal(task.lifecycle, 'completed', task.recovery.reason);
    assert.deepEqual(fixture.main.requests.map(request => request.maxTokens), [1024, 1024]);
    assert.equal(task.recoveryPolicy.maxTokens, 2048);
    assert.equal(task.recovery.maxTokens, 1024);
    assert.equal(task.recovery.forecastTokens, 8192);
    const retry = task.calls.find(call => call.recoveryId);
    assert.equal(task.calls[0].hostConfig.maxTokens, 1024);
    assert.equal(retry.hostConfig.maxTokens, 1024);
    assert.equal(retry.reservation.tokens.output, 1024);
    assert.equal(retry.reservation.tokens.input, 7168);
    assert.equal(retry.reservation.tokens.total, 8192);
    assert.equal(task.recovery.finalRequest.maxTokens, 1024);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 1024);
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.calls.length, 2);
    assert.equal(task.ledger.tokens.total, 24);
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('consultation recovery freezes the actual prepared source ceiling when both logical policies allow more', async t => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-compatible-consult-ceiling-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { policy: { maxTokens: 2048, forecastTokens: 8192 } }); ctx = fixture.ctx;
    const advisor = new RecoveryFixture();
    const registration = await register(ctx, 'router-compatible-t18-source-ceiling', advisor, { billingPath: 'compatible-unconfirmed' });
    await ctx.router.setCoordinationPolicy({ ...(await ctx.router.snapshot()).config.coordination, candidateId: registration.candidate.candidateId, maxTokens: 2048, forecastTokens: 8192 });
    advisor.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    t.diagnostic(JSON.stringify({ lifecycle: task.lifecycle, recoveryReason: task.recovery.reason, recoveryMaxTokens: task.recovery.maxTokens, actualMaxTokens: advisor.requests.map(request => request.maxTokens) }));
    assert.equal(task.lifecycle, 'completed', task.recovery.reason);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.deepEqual(advisor.requests.map(request => request.maxTokens), [1024, 1024]);
    assert.equal(task.coordinationPolicy.maxTokens, 2048);
    assert.equal(task.recoveryPolicy.maxTokens, 2048);
    assert.equal(task.recovery.maxTokens, 1024);
    assert.equal(task.recovery.forecastTokens, 8192);
    const [original, retry] = task.calls.filter(call => call.purpose === 'consultation');
    assert.equal(original.snapshot.maxTokens, 1024);
    assert.equal(retry.snapshot.maxTokens, 1024);
    assert.equal(retry.reservation.tokens.input, 7168);
    assert.equal(retry.reservation.tokens.output, 1024);
    assert.equal(retry.reservation.tokens.total, 8192);
    assert.equal(task.recovery.finalRequest.maxTokens, 1024);
    assert.equal(task.recovery.finalRequest.prepared.config.maxTokens, 1024);
    assert.equal(task.recovery.finalRequest.ownedRequest, true);
    assert.equal(task.coordination.consultationAttempts, 1);
    assert.deepEqual(task.coordination.episodes[0].consultation.callIds, [original.id, retry.id]);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
    assertAccounted(task, [fixture.main, advisor]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
