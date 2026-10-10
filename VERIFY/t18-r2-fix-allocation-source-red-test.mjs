import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { prepare, submitTask, assertAccounted } from './t18-harness.mjs';

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
