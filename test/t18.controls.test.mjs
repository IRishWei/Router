import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import { startNative } from './t02-harness.mjs';
import { prepare, submitTask, waitForSnapshot, assertAccounted } from './t18-harness.mjs';

test('a public lifecycle plugin exception after a recovered response pauses the Task without erasing its output or usage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-plugin-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    ctx.on('agent/turn-stopping', () => { throw new LlmError('T18_SECRET_PLUGIN_MESSAGE', 'T18_PLUGIN_EXCEPTION'); });
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery.reason, 'RECOVERY_PLUGIN_EXCEPTION');
    assert.equal(task.recovery.failure.code, 'T18_PLUGIN_EXCEPTION');
    assert.equal(task.result, 'RECOVERED_LOCAL_RESULT');
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(task.calls[1].status, 'completed');
    assert.equal(task.calls[1].failureCode, undefined);
    assert.equal(JSON.stringify(task).includes('T18_SECRET_PLUGIN_MESSAGE'), false);
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('ambiguous late ancestry spanning two real native Tasks cannot run a child outside the recovery guard', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-ancestry-'));
  let ctx, running;
  try {
    const fixture = await prepare(home, { policy: { automatic: false } }); ctx = fixture.ctx;
    let childBodies = 0;
    const definition = { description: 'Declared local read', parameters: { type: 'object', properties: {}, additionalProperties: false }, routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't18-controlled-operation', confidence: 'declared' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] } };
    ctx.tools.register({ ...definition, name: 't18_same_root', async execute() { return 'COMPLETE_READ'; } });
    ctx.tools.register({ ...definition, name: 't18_ambiguous_child', async execute() { childBodies++; return 'UNSAFE_CHILD'; } });
    fixture.main.respond = async function* (request) {
      if (!request.messages.some(message => message.role === 'tool')) {
        yield { type: 'tool-call-delta', index: 0, id: 'shared-public-root-id', name: 't18_same_root', argumentsDelta: '{}' };
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      if (request.messages.some(message => message.content.some(part => part.text === 'primary'))) throw new LlmError('Controlled primary failure', 'CONNECTION');
      yield { type: 'text-delta', index: 0, text: 'SECONDARY_COMPLETE' }; yield { type: 'finish', reason: { kind: 'stop' } };
    };
    running = submitTask(ctx, fixture.sessionId, 'primary');
    const first = await waitForSnapshot(ctx, state => state.tasks.find(task => task.recovery?.state === 'waiting-user'));
    const { sessionId: secondSession } = await ctx.sessionController.create({});
    const second = await submitTask(ctx, secondSession, 'secondary');
    assert.equal(second.lifecycle, 'completed');
    const child = await ctx.tools.execute({ callId: 'ambiguous-child', rootCallId: 'shared-public-root-id', parent: Symbol('unrelated-parent'), name: 't18_ambiguous_child', arguments: {}, signal: new AbortController().signal });
    assert.equal(childBodies, 0);
    assert.equal(child.isError, true);
    const task = await running;
    assert.equal(task.id, first.id); assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery.reason, 'RECOVERY_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.toolReceipts.find(receipt => receipt.callId === 'ambiguous-child').outcome, 'unknown');
    assert.equal(task.calls.filter(call => call.dispatchStarted).length, 2);
  } finally {
    if (ctx) { for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle)) await ctx.router.stopTask(task.id); await running; await ctx.fiber.dispose(); }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('native errors retain their message while new recovery snapshot and disk DTOs only retain allowlisted facts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-redaction-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    const marker = 'T18_SECRET_FAILURE_MESSAGE_BODY_HEADERS';
    fixture.main.failures = [{ code: 'CONNECTION', message: marker, facts: { status: 503, providerRetryAfterMs: 1, requestId: 'opaque-local-request', body: marker, cause: marker, headers: { authorization: marker } } }];
    let nativeFailure;
    ctx.on('agent/request-error', ({ failure }, next) => { nativeFailure = failure; return next(); }, { prepend: true });
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(nativeFailure.message, marker);
    assert.equal(JSON.stringify(task).includes(marker), false);
    assert.equal((await readFile(join(home, 'router', 'test', 'state.json'), 'utf8')).includes(marker), false);
    assert.deepEqual(task.recovery.failure, { code: 'CONNECTION', status: 503, providerRetryAfterMs: 1, requestId: 'opaque-local-request' });
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

for (const order of ['before-router', 'after-router', 'outer-ignore-decision']) test(`real native retry ${order} cannot expand the Task recovery cap`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-native-retry-'));
  let ctx;
  try {
    const fixture = await prepare(home, { nativeOptions: order === 'before-router' ? { beforeRouter: current => current.plugin(LlmRetry) } : {} }); ctx = fixture.ctx;
    if (order === 'after-router') await ctx.plugin(LlmRetry);
    let nativeDecisions = 0;
    if (order === 'outer-ignore-decision') ctx.on('agent/request-error', async (_payload, next) => { await next(); nativeDecisions++; return { kind: 'retry' }; }, { prepend: true });
    fixture.main.failures = Array.from({ length: 6 }, () => ({ code: 'CONNECTION' }));
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 3);
    assert.equal(task.recovery.attempts, 2);
    assert.equal(task.recovery.reason, 'RECOVERY_ATTEMPT_LIMIT');
    assert.equal(task.lifecycle, 'paused');
    if (order === 'outer-ignore-decision') assert.equal(nativeDecisions, 3);
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

for (const change of ['disabled', 'fixed', 'policy', 'human', 'pending', 'stopped']) test(`an owned recovery budget wait rechecks live ${change} before any new adapter entry`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-budget-race-'));
  let ctx, running;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    await ctx.router.setBudgetDefaults({ tokens: 20, durationMs: 60000, money: [] });
    fixture.main.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    const waiting = await waitForSnapshot(ctx, state => state.tasks.find(task => task.lifecycle === 'waiting-budget' && task.recovery?.callId));
    if (change === 'disabled') await ctx.router.setModelEnabled(fixture.registration.candidate.candidateId, false);
    if (change === 'fixed') await ctx.router.setFixedModel('controlled');
    if (change === 'policy') await ctx.router.setRecoveryPolicy({ ...waiting.recoveryPolicy, enabled: false });
    if (change === 'human') await ctx.sessionController.prompt({ sessionId: fixture.sessionId, requestId: 't18-human-next-step', mode: 'steer', content: [{ type: 'text', text: 'Human changes the next step.' }] }, new AbortController().signal);
    if (change === 'pending') await ctx.sessionController.selectModel({ sessionId: fixture.sessionId, provider: 'router-controlled', model: 'controlled' });
    if (change === 'stopped') await ctx.router.stopTask(waiting.id);
    const task = await running;
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recoveryOwned, true);
    assert.ok(task.calls.every(call => ['settled', 'released'].includes(call.reservation.state)));
    assert.equal(task.calls.filter(call => call.dispatchStarted).length, 1);
  } finally {
    if (ctx) { const state = await ctx.router.snapshot(); for (const task of state.tasks.filter(task => !task.nativeLifecycle && ['running', 'waiting-budget', 'waiting-recovery'].includes(task.lifecycle))) await ctx.router.stopTask(task.id); await running; await ctx.fiber.dispose(); }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the raw native final request gate rechecks permission after its independent awaited observation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-final-race-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery);
    let observations = 0;
    ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      if (++observations === 2) await ctx.router.setAutomatic(false);
      return lease;
    };
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.recovery.state, 'paused');
    assert.equal(observations, 2);
    assert.equal(task.recovery.reason, 'RECOVERY_POLICY_CHANGED');
    assert.equal(task.recovery.failure.code, 'CONNECTION');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('the actual prepared recovery handle is an independent hard gate and retains the source error', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-prepared-'));
  let ctx;
  try {
    const fixture = await prepare(home); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION', facts: { status: 503 } }];
    fixture.main.prepareCall = async function (provider, model, signal) {
      const prepared = await LlmAdapter.prototype.prepareCall.call(this, provider, model, signal);
      return this.requests.length ? { ...prepared, model: { ...prepared.model, context: { contextWindow: 1 } } } : prepared;
    };
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.recovery.reason, 'RECOVERY_PREPARED_MODEL_CHANGED');
    assert.equal(task.recovery.failure.code, 'CONNECTION');
    assert.equal(task.calls[1].status, 'not-dispatched');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('restart preserves the actual persisted live recovery allowance but creates no timer, Call or old-Task resume', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-restart-live-'));
  const restoredHome = await mkdtemp(join(tmpdir(), 'router-t18-restored-'));
  let ctx, restored, running;
  try {
    const fixture = await prepare(home, { policy: { automatic: false } }); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    const live = await waitForSnapshot(ctx, state => state.tasks.find(task => task.recovery?.state === 'waiting-user'));
    await ctx.router.flush();
    const saved = await readFile(join(home, 'router', 'test', 'state.json'), 'utf8');
    await mkdir(join(restoredHome, 'router', 'test'), { recursive: true });
    await writeFile(join(restoredHome, 'router', 'test', 'state.json'), saved);
    let requests = 0, tools = 0;
    restored = await startNative(restoredHome, { beforeRouter: current => {
      current.on('llm/stream', (_request, next) => { requests++; return next(); });
      current.on('tools/pre-execute', (_exec, next) => { tools++; return next(); });
    } });
    const after = (await restored.router.snapshot()).tasks.find(task => task.id === live.id);
    assert.equal(after.lifecycle, 'paused');
    assert.equal(after.pauseReason, 'HOST_RESTARTED');
    assert.equal(after.recovery.state, 'paused');
    assert.equal(after.recovery.reason, 'RECOVERY_RESTARTED_UNKNOWN');
    assert.equal(after.recovery.attempts, live.recovery.attempts);
    assert.equal(after.recovery.waitMs, live.recovery.waitMs);
    assert.equal(after.calls.length, live.calls.length);
    assert.equal(requests, 0); assert.equal(tools, 0);
    await assert.rejects(restored.router.resolveTaskRecovery({ taskId: after.id, recoveryId: after.recovery.id, expectedRevision: after.recovery.revision, action: 'retry-current' }), { code: 'RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED' });
  } finally {
    if (ctx) { const state = await ctx.router.snapshot(); for (const task of state.tasks.filter(task => !task.nativeLifecycle)) await ctx.router.stopTask(task.id); await running; await ctx.fiber.dispose(); }
    await restored?.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    await rm(restoredHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
