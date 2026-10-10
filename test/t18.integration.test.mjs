import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAgentLoopRequest, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { prepare, submitTask, assertAccounted, waitForSnapshot, register, RecoveryFixture, prepareCoordination, coordinationPrompt } from './t18-harness.mjs';

test('execution, consultation and takeover share one recovery allowance instead of resetting it per phase', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-shared-cap-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { afterAdviceLength: 8 }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-shared-target', target);
    fixture.main.failures = [{ code: 'CONNECTION' }]; fixture.advisor.failures = [{ code: 'CONNECTION' }]; target.failures = [{ code: 'CONNECTION' }];
    await ctx.router.setTakeoverPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, forecastTokens: 32768 });
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.recovery.attempts, 2);
    assert.equal(task.recovery.reason, 'RECOVERY_ATTEMPT_LIMIT');
    assert.equal(task.recovery.phase, 'takeover');
    assert.equal(fixture.main.requests.length, 4); assert.equal(fixture.advisor.requests.length, 2); assert.equal(target.requests.length, 1);
    assert.equal(task.calls.length, 7); assert.equal(task.ledger.tokens.total, 84);
    assert.equal(task.coordination.consultationAttempts, 1); assert.equal(task.takeover.attempts, 1);
    assert.equal(task.acceptance.verdict, 'failed'); assert.equal(task.lifecycle, 'paused');
    assert.deepEqual(task.timeline.filter(event => event.kind === 'recovery-grant').map(event => event.phase), ['execution', 'consultation']);
    assertAccounted(task, [fixture.main, fixture.advisor, target]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a real native title is accounted alongside all recovery Calls without changing its purpose or execution owner', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-title-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { provider: 'router-controlled', model: 'controlled', targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 5000 });
    const entries = [];
    ctx.on('llm/stream', (request, next) => { entries.push(request); return next(); });
    fixture.main.failures = [{ code: 'CONNECTION' }];
    fixture.main.beforeResponse = () => waitForSnapshot(ctx, state => state.tasks.find(task => task.sessionId === fixture.sessionId && task.calls.some(call => call.nativePurpose === 'session-title' && call.status === 'completed')));
    const submitted = await submitTask(ctx, fixture.sessionId);
    const task = await waitForSnapshot(ctx, state => state.tasks.find(task => task.id === submitted.id && ['completed', 'paused'].includes(task.lifecycle)));
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.calls.length, 3, JSON.stringify(task)); assert.equal(entries.length, 3);
    assert.deepEqual(task.calls.map(call => call.purpose).sort(), ['auxiliary', 'execution', 'retry']);
    assert.equal(task.calls.find(call => call.purpose === 'auxiliary').nativePurpose, 'session-title');
    assert.equal(task.ledger.tokens.total, 36);
    assert.equal(task.executionOwner.callId, task.calls.find(call => call.purpose === 'retry').id);
    assert.equal(ctx.sessionTitle.get(ctx.sessions.get(fixture.sessionId)).source.kind, 'provider');
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('known consultation failure cannot bypass earlier unknown Task usage through manual recovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-budget-unknown-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { policy: { automatic: false } }); ctx = fixture.ctx;
    const respond = fixture.main.respond;
    fixture.main.respond = async function* (request) { for await (const chunk of respond(request)) if (chunk.type !== 'usage') yield chunk; };
    fixture.advisor.failures = [{ code: 'CONNECTION' }];
    // If a broken implementation waits manually, stop it through the public Task API.
    const running = submitTask(ctx, fixture.sessionId, coordinationPrompt);
    const boundary = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.sessionId === fixture.sessionId && (task.lifecycle === 'paused' || task.recovery?.state === 'waiting-user')));
    if (boundary.recovery?.state === 'waiting-user') await ctx.router.stopTask(boundary.id);
    const task = await running;
    assert.equal(task.recovery.reason, 'RECOVERY_USAGE_UNKNOWN');
    assert.equal(task.recovery.attempts, 0);
    assert.equal(task.recovery.state, 'paused');
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(fixture.advisor.requests.length, 1);
    assert.equal(task.coordination.episodes[0].consultation.callIds.length, 1);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('known network failure recovers in the same Native Task and step with distinct accounted Calls', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-network-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION', facts: { status: 503, providerRetryAfterMs: 1, requestId: 'local-attempt-1' } }];
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.result, 'RECOVERED_LOCAL_RESULT');
    assert.equal(task.calls.length, 2);
    assert.deepEqual(task.calls.map(call => [call.purpose, call.status, call.step]), [['execution', 'failed', 1], ['retry', 'completed', 1]]);
    assert.equal(task.calls[0].failureCode, 'CONNECTION');
    assert.equal(task.calls[0].failure.status, 503);
    assert.equal(task.calls[1].sourceCallId, task.calls[0].id);
    assert.equal(task.calls[1].recoveryId, task.recovery.id);
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.recovery.category, 'network');
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.ok(fixture.nativeRequests.every(isAgentLoopRequest));
    assert.equal(task.executionOwner.callId, task.calls[1].id);
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('recovery with an unknown configured money budget stops before another model entry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-money-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    await ctx.router.setBudgetDefaults({ tokens: 262144, durationMs: 60000, money: [{ currency: 'USD', kind: 'fixture-reference', amount: 1 }] });
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.recovery.reason, 'RECOVERY_BUDGET_UNPROVEN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.ledger.actualSpend.status, 'unknown');
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a takeover response with known usage and no partial content can recover without repeating the notice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-takeover-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home, { afterAdviceLength: 8 }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-takeover', target);
    target.failures = [{ code: 'CONNECTION' }];
    target.respond = async function* () { yield { type: 'text-delta', index: 0, text: 'A'.repeat(14) }; yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }; yield { type: 'finish', reason: { kind: 'stop' } }; };
    await ctx.router.setTakeoverPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, forecastTokens: 32768 });
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(target.requests.length, 2);
    assert.equal(task.takeover.attempts, 1);
    assert.equal(task.takeover.plan.state, 'completed');
    assert.equal(task.recovery.phase, 'takeover');
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.calls.filter(call => call.selection.provider === 't18-takeover').length, 2);
    assert.equal(task.executionOwner.callId, task.calls.at(-1).id);
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-takeover').length, 1);
    assert.equal(task.calls.length, 6);
    assertAccounted(task, [fixture.main, fixture.advisor, target]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('consultation recovery keeps one intent and one advice while every attempt uses the same Task ledger', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-consultation-'));
  let ctx;
  try {
    const fixture = await prepareCoordination(home); ctx = fixture.ctx;
    fixture.advisor.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId, coordinationPrompt);
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(fixture.advisor.requests.length, 2);
    assert.equal(task.coordination.consultationAttempts, 1);
    const consultation = task.coordination.episodes[0].consultation;
    assert.equal(consultation.state, 'advice-delivered');
    assert.equal(consultation.callIds.length, 2);
    assert.equal(consultation.callId, task.calls.filter(call => call.purpose === 'consultation').at(-1).id);
    assert.equal(task.recovery.phase, 'consultation');
    assert.equal(task.recovery.attempts, 1);
    assert.equal(task.calls.filter(call => call.purpose === 'consultation')[1].originatingPurpose, 'consultation');
    assert.equal(ctx.agents.get(fixture.sessionId).session.deriveMessages().filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(task.executionOwner.identity.provider, 't18-main');
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
    assertAccounted(task, [fixture.main, fixture.advisor]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a live manual recovery has one CAS winner and a terminal Task cannot be revived', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-manual-'));
  let ctx, running;
  try {
    const fixture = await prepare(home, { policy: { automatic: false } }); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    const live = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.sessionId === fixture.sessionId && task.recovery?.state === 'waiting-user'));
    assert.equal(live.lifecycle, 'waiting-recovery');
    assert.equal(fixture.main.requests.length, 1);
    const action = { taskId: live.id, recoveryId: live.recovery.id, expectedRevision: live.recovery.revision, action: 'retry-current' };
    const results = await Promise.allSettled([ctx.router.resolveTaskRecovery(action), ctx.router.resolveTaskRecovery(action)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const task = await running;
    assert.equal(task.id, live.id); assert.equal(task.startedAt, live.startedAt);
    assert.equal(task.lifecycle, 'completed');
    assert.equal(fixture.main.requests.length, 2);
    assert.equal(task.recovery.attempts, 1);
    await assert.rejects(ctx.router.resolveTaskRecovery({ ...action, expectedRevision: task.recovery.revision }), { code: 'RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED' });
    assertAccounted(task, [fixture.main]);
  } finally { if (running && ctx) for (const task of (await ctx.router.snapshot()).tasks.filter(task => task.lifecycle === 'waiting-recovery')) await ctx.router.stopTask(task.id); await running?.catch(() => {}); await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('an explicitly enabled same-account alternative receives complete native history after bounded current-model recovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-alternative-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    const alternative = new RecoveryFixture();
    const target = await register(ctx, 't18-alternative', alternative, { connectionId: fixture.registration.source.connectionId, accountId: fixture.registration.source.accountId });
    const previous = await submitTask(ctx, fixture.sessionId, 'Record a prior completed main-model response.');
    assert.equal(previous.lifecycle, 'completed');
    assert.equal(previous.calls[0].selection.provider, 't18-main');
    await ctx.router.setFixedModel(null);
    await ctx.router.setModelEnabled('controlled', false); await ctx.router.setModelEnabled('controlled-tools', false);
    await ctx.router.setRecoveryPolicy({ ...(await ctx.router.snapshot()).config.recovery, alternativeCandidateId: target.candidate.candidateId });
    fixture.main.failures = [{ code: 'CONNECTION' }, { code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId, 'Retain this entire input and every system instruction.');
    assert.equal(task.lifecycle, 'completed');
    assert.equal(fixture.main.requests.length - previous.calls.length, 2);
    assert.equal(alternative.requests.length, 1);
    assert.equal(task.recovery.attempts, 2);
    assert.equal(task.recovery.target.candidateId, target.candidate.candidateId);
    assert.equal(task.recovery.finalRequest.nativeRequest, true);
    assert.equal(task.recovery.finalRequest.callId, task.calls[2].id);
    assert.equal(task.calls[2].selection.connectionId, task.calls[0].selection.connectionId);
    assert.equal(task.calls[2].selection.accountId, task.calls[0].selection.accountId);
    assert.equal(task.calls[2].selection.billingPath, task.calls[0].selection.billingPath);
    assert.ok(isAgentLoopRequest(fixture.nativeRequests.find(request => request.provider === 't18-alternative')));
    assert.ok(alternative.requests[0].messages.some(message => message.content.some(part => part.type === 'text' && part.text.includes('Retain this entire input'))));
    assert.equal(task.takeover, null, 'network recovery never fabricates a difficulty plan');
    assertAccounted(task, [{ requests: fixture.main.requests.slice(previous.calls.length) }, alternative]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('a completed tool with unproved operation semantics prevents ordinary recovery before a new model entry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-unknown-operation-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    let bodies = 0;
    ctx.tools.register({ name: 't18_unknown_operation', description: 'No operation declaration', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] }, execute() { bodies++; return 'UNPROVED'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    fixture.main.failures = [null, { code: 'CONNECTION' }];
    fixture.main.respond = async function* (request) {
      if (request.messages.some(message => message.role === 'tool')) { yield { type: 'text-delta', index: 0, text: 'UNSAFE_RECOVERY' }; yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
      yield { type: 'tool-call-delta', index: 0, id: 'unknown-operation', name: 't18_unknown_operation', argumentsDelta: '{}' };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    };
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 2);
    assert.equal(bodies, 1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery.reason, 'RECOVERY_TOOL_OPERATION_UNKNOWN');
    assert.equal(task.calls[1].failureCode, 'CONNECTION');
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('ordinary recovery cannot repeat a completed side effect using a new native tool call id', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-operation-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    let bodies = 0;
    ctx.tools.register({ name: 't18_write_once', description: 'Controlled operation', parameters: { type: 'object', properties: { operation: { type: 'string' } }, required: ['operation'], additionalProperties: false },
      routerOperation: { version: 1, effect: 'side-effect', idempotencyKey: 'operation', source: 't18-fixture-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] }, execute() { bodies++; return 'DONE'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    fixture.main.failures = [null, { code: 'CONNECTION' }];
    fixture.main.respond = async function* () {
      if (fixture.main.requests.length > 3) { yield { type: 'text-delta', index: 0, text: 'DUPLICATE_ESCAPED' }; yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
      yield { type: 'tool-call-delta', index: 0, id: fixture.main.requests.length === 1 ? 'original-operation' : 'new-recovery-id', name: 't18_write_once', argumentsDelta: '{"operation":"same-completed-operation"}' };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    };
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(bodies, 1, 'a new callId cannot bypass completed operation identity');
    assert.equal(fixture.main.requests.length, 3);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'RECOVERY_DUPLICATE_OPERATION');
    assert.equal(task.calls[1].failureCode, 'CONNECTION');
    assert.equal(task.toolReceipts[0].outcome, 'completed');
    assert.equal(task.toolReceipts[1].outcome, 'unknown');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('authorization, quota, partial and unknown failures retain their facts and cannot become difficulty or success', async () => {
  for (const [failure, category, reason] of [
    [{ code: 'AUTH', facts: { status: 401 } }, 'authorization', 'RECOVERY_REAUTHORIZE_REQUIRED'],
    [{ code: 'ACCOUNT_QUOTA', facts: { status: 429 } }, 'quota', 'RECOVERY_QUOTA_REQUIRED'],
    [{ code: 'CONNECTION', partial: true }, 'network', 'RECOVERY_RESPONSE_PARTIAL'],
    [{ code: 'CONNECTION', reasoningPartial: true }, 'network', 'RECOVERY_RESPONSE_PARTIAL'],
    [{ code: 'OPAQUE_ADAPTER_FAILURE', facts: { requestId: 'local-unknown' } }, 'unknown', 'RECOVERY_FAILURE_UNSAFE'],
  ]) {
    const home = await mkdtemp(join(tmpdir(), 'router-t18-categories-'));
    let ctx;
    try {
      const fixture = await prepare(home); ctx = fixture.ctx;
      fixture.main.failures = [failure];
      const task = await submitTask(ctx, fixture.sessionId);
      assert.equal(fixture.main.requests.length, 1);
      assert.equal(task.lifecycle, 'paused');
      assert.equal(task.recovery.category, category);
      assert.equal(task.recovery.reason, reason);
      assert.equal(task.calls[0].failureCode, failure.code);
      assert.equal(task.recovery.failure.code, failure.code);
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.coordination, null);
      assert.equal(task.takeover, null);
      assertAccounted(task, [fixture.main]);
    } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
  }
});

test('disabling routing during rate-limit backoff stops the owned Task rather than delegating native retry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-revoke-wait-'));
  let ctx, running;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'RATE_LIMIT', facts: { status: 429, providerRetryAfterMs: 250 } }];
    running = submitTask(ctx, fixture.sessionId);
    const live = await waitForSnapshot(ctx, snapshot => snapshot.tasks.find(task => task.sessionId === fixture.sessionId && task.recovery?.state === 'backoff'));
    assert.equal(live.lifecycle, 'waiting-recovery');
    await ctx.router.setAutomatic(false);
    const task = await running;
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.recoveryOwned, true);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'RECOVERY_POLICY_CHANGED');
    assert.equal(task.recovery.waitMs, 250);
    assertAccounted(task, [fixture.main]);
  } finally { if (running) ctx.agents.get((await ctx.router.snapshot()).tasks.find(task => task.lifecycle === 'waiting-recovery')?.sessionId)?.cancel({ kind: 'user' }); await running?.catch(() => {}); await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('credible rate-limit retry-after above the wait allowance pauses without sending early', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-rate-limit-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'HTTP_429', facts: { status: 429, providerRetryAfterMs: 501 } }];
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery.category, 'rate-limit');
    assert.equal(task.recovery.reason, 'RECOVERY_WAIT_LIMIT');
    assert.equal(task.recovery.failure.providerRetryAfterMs, 501);
    assert.equal(task.calls[0].failureCode, 'HTTP_429');
    assert.equal(task.recovery.attempts, 0);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('Task recovery cap defeats a later outer always retry listener without a fourth dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-always-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.providerRetryPolicy = () => resolveRetryPolicy({ mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, 't18-always');
    fixture.registration.adapterHandle.replace(['t18-main'], fixture.main);
    await ctx.plugin(LlmRetry);
    fixture.main.failures = Array.from({ length: 4 }, () => ({ code: 'CONNECTION' }));
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 3);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'RECOVERY_ATTEMPT_LIMIT');
    assert.equal(task.recovery.attempts, 2);
    assert.equal(task.recovery.reason, 'RECOVERY_ATTEMPT_LIMIT');
    assert.equal(task.calls.filter(call => call.dispatchStarted).length, 3);
    assert.equal(task.result, '');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
