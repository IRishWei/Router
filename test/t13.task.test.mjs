import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startNative, submit } from './t02-harness.mjs';
import { AcceptanceCoordinator } from '../src/acceptance.mjs';
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

async function waitFor(ctx, predicate) {
  const until = Date.now() + 3_000;
  while (Date.now() < until) {
    const state = await ctx.router.snapshot();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The acceptance task did not reach the expected boundary');
}

class ReviewFixture extends LlmAdapter {
  reviews = [];
  #verdicts;
  constructor(verdicts = ['passed']) { super(); this.#verdicts = verdicts; }
  async *stream(request) {
    let text = 'ARTICLE';
    if (!isAgentLoopRequest(request)) {
      const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
      this.reviews.push(input);
      const verdict = this.#verdicts[Math.min(this.reviews.length - 1, this.#verdicts.length - 1)];
      text = verdict === 'invalid-json' ? '{not-json' : JSON.stringify({ artifactHash: input.artifact.hash, requirementHash: input.requirementHash, findings: input.requirements.map(rule => ({ requirementId: rule.id, verdict, artifactQuote: 'ARTICLE', explanation: 'Controlled rubric evidence; no empirical quality claim.' })) });
    }
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('a complete writing task checks its final artifact against explicitly selected literal requirements', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-writing-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply HELLO\n仅检查以下明确要求：\n正文必须包含「HELLO」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.version, 1);
    assert.match(result.requirements[0].id, /^requirement:v1:/u);
    assert.equal(result.requirements[0].version, 1);
    assert.ok(Number.isSafeInteger(result.requirements[0].origin.seq));
    assert.match(result.artifact.id, /^artifact:v1:/u);
    assert.equal(result.artifact.version, 1);
    assert.equal(result.artifact.revision, 1);
    assert.match(result.evidence[0].id, /^evidence:v1:/u);
    assert.equal(result.evidence[0].version, 1);
    assert.equal(result.artifact.text, 'HELLO');
    assert.equal(result.artifact.kind, 'assistant-message');
    assert.equal(result.artifact.sessionId, sessionId);
    assert.ok(result.artifact.messageId);
    assert.equal(result.coverage.required, 1);
    assert.equal(result.coverage.covered, 1);
    assert.equal(result.evidence[0].source.kind, 'deterministic-rule');
    assert.equal(result.requirements[0].origin.messageId, task.inputs[0].messageId);
    assert.equal(task.calls.length, 1);
    assert.equal(task.lifecycle, 'completed');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a rubric review is anonymous, belongs to the original task and is included in its resource ledger', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-controlled'], adapter);
  const acceptance = new AcceptanceCoordinator(ctx, { review: { enabled: true, selection: { connectionId: 'dsh-native:review-controlled', accountId: 'unknown', billingPath: 'unknown', provider: 'review-controlled', model: 'rubric' }, forecast: { totalTokens: 12 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.evidence[0].source.kind, 'model-review');
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls[1].purpose, 'review');
    assert.equal(task.calls[1].reservation.state, 'settled');
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(result.reviews[0].callId, task.calls[1].id);
    assert.equal(adapter.reviews.length, 1);
    const input = adapter.reviews[0];
    for (const field of ['provider', 'model', 'accountId', 'connectionId', 'billingPath', 'strategy', 'cost', 'configVersion']) assert.equal(Object.hasOwn(input, field), false);
    assert.equal(Object.hasOwn(input.artifact, 'sessionId'), false);
    assert.equal(Object.hasOwn(input.requirements[0], 'origin'), false);
    assert.equal(ctx.sessions.get(sessionId).requestHeader().config.provider, 'router-controlled');
    assert.equal(task.result, 'ARTICLE');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('writing length counts Unicode characters with an explicit unit and records the measured value', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-length-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply 你好😀\n仅检查以下明确要求：\n正文长度为3至3个字符。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.evidence[0].measurement.value, 3);
    assert.equal(result.evidence[0].measurement.unit, 'unicode-code-points');
    assert.equal(result.coverage.covered, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a real forbidden-item failure remains failed even when other quality requirements are uncovered', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-failure-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply BAD\n仅检查以下明确要求：\n正文不得包含「BAD」。\n论证需严密且适合目标读者。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'failed');
    assert.equal(result.coverage.required, 2);
    assert.equal(result.coverage.covered, 1);
    assert.equal(result.evidence[0].verdict, 'failed');
    assert.equal(result.evidence[1].verdict, 'unconfirmed');
    assert.equal(result.artifact.text, 'BAD');
    assert.equal(result.blocking.length, 2);
    assert.ok(result.blocking.every(item => item.id.startsWith('blocking:v1:')));
    assert.deepEqual(result.blocking[0].requirementIds, [result.requirements[0].id]);
    assert.deepEqual(result.blocking[0].evidenceIds, [result.evidence[0].id]);
    assert.equal(result.blocking[0].artifactRevision, result.artifact.revision);
    assert.equal(result.blocking[0].selfRepairAttempted, false);
    assert.equal(task.ledger.callCount, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('an explicit writing structure checks ordered literal sections in the final artifact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-structure-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply CONCLUSION INTRO\n仅检查以下明确要求：\n正文结构依次包含「INTRO」「CONCLUSION」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'failed');
    assert.equal(result.requirements[0].kind, 'ordered-literals');
    assert.deepEqual(result.requirements[0].literals, ['INTRO', 'CONCLUSION']);
    assert.equal(result.evidence[0].verdict, 'failed');
    assert.deepEqual(result.evidence[0].observed.positions, [11, 0]);
    assert.equal(result.evidence[0].source.rule, 'ordered-literals');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('trusted Host checks keep programming behavior, build and missing test coverage separate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-programming-'));
  const ctx = await startNative(home);
  const executed = [];
  ctx.tools.register({
    name: 'router_acceptance_check',
    description: 'Execute one fixed acceptance plan from the Host test fixture',
    parameters: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { planId: { type: 'string' }, outcome: { type: 'string', enum: ['passed', 'failed'] }, evidenceRef: { type: 'string' } }, required: ['planId', 'outcome', 'evidenceRef'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      executed.push(args.planId);
      return args.planId === 'behavior-add'
        ? { planId: args.planId, outcome: 'failed', evidenceRef: 'fixture://behavior/add' }
        : { planId: args.planId, outcome: 'passed', evidenceRef: 'fixture://build/app' };
    },
  });
  const acceptance = new AcceptanceCoordinator(ctx, {
    checks: {
      plans: {
        'behavior-add': { authorized: true, kind: 'behavior', toolName: 'router_acceptance_check', arguments: { planId: 'behavior-add' }, authorizationRef: 'host-plan:v1:behavior-add' },
        'build-app': { authorized: true, kind: 'build', toolName: 'router_acceptance_check', arguments: { planId: 'build-app' }, authorizationRef: 'host-plan:v1:build-app' },
      },
    },
  });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n编程行为「加法返回3」由可信检查「behavior-add」验证。\n必须通过构建检查「build-app」。\n必须通过测试检查「tests-add」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'failed');
    assert.deepEqual(executed, ['behavior-add', 'build-app']);
    assert.deepEqual(result.evidence.map(item => item.verdict), ['failed', 'passed', 'unconfirmed']);
    assert.deepEqual(result.evidence.map(item => item.source.kind), ['host-check', 'host-check', 'host-check']);
    assert.equal(result.evidence[0].source.checkKind, 'behavior');
    assert.equal(result.evidence[1].source.checkKind, 'build');
    assert.equal(result.evidence[2].reason, 'CHECK_NOT_AUTHORIZED');
    assert.equal(result.coverage.covered, 2);
    assert.equal(result.coverage.uncovered.length, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a high-risk rubric gets at most one re-review and conflicting findings stay unconfirmed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-conflict-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture(['passed', 'failed']);
  ctx.llm.registerAdapter(['review-conflict'], adapter);
  const acceptance = new AcceptanceCoordinator(ctx, { review: { enabled: true, selection: { connectionId: 'dsh-native:review-conflict', accountId: 'unknown', billingPath: 'unknown', provider: 'review-conflict', model: 'rubric' }, forecast: { totalTokens: 12 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n高风险评审标准：「正文没有危险遗漏」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 2);
    assert.equal(adapter.reviews.length, 2);
    assert.equal(task.calls.length, 3);
    assert.equal(task.ledger.tokens.total, 36);
    assert.equal(result.evidence[0].verdict, 'unconfirmed');
    assert.equal(result.evidence[0].reason, 'REVIEW_CONFLICT');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('invalid review JSON may consume one bounded re-review but cannot establish success', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-invalid-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture(['invalid-json', 'passed']);
  ctx.llm.registerAdapter(['review-invalid'], adapter);
  const acceptance = new AcceptanceCoordinator(ctx, { review: { enabled: true, selection: { connectionId: 'dsh-native:review-invalid', accountId: 'unknown', billingPath: 'unknown', provider: 'review-invalid', model: 'rubric' }, forecast: { totalTokens: 12 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 2);
    assert.equal(task.calls.length, 3);
    assert.equal(result.evidence[0].reason, 'REVIEW_INVALID_OR_INCOMPLETE');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const action of ['extend', 'stop']) test(`a review budget wait preserves the artifact and ${action === 'extend' ? 'continues the same Task after extension' : 'releases the unsent call when stopped'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), `router-t13-review-budget-${action}-`));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-budget'], adapter);
  const acceptance = new AcceptanceCoordinator(ctx, { review: { enabled: true, selection: { connectionId: 'dsh-native:review-budget', accountId: 'unknown', billingPath: 'unknown', provider: 'review-budget', model: 'rubric' }, forecast: { totalTokens: 12 } } });
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    const pendingResult = acceptance.getResult(waiting.id);
    assert.equal(pendingResult.phase, 'awaiting-review');
    assert.equal(pendingResult.artifact.text, 'ARTICLE');
    assert.equal(pendingResult.verdict, 'unconfirmed');
    if (action === 'extend') await ctx.router.extendTaskBudget(waiting.id, { tokens: 12 });
    else await ctx.router.stopTask(waiting.id);
    const task = await run;
    const result = acceptance.getResult(task.id);
    const reviewCall = task.calls.find(call => call.purpose === 'review');
    assert.equal(result.artifact.text, 'ARTICLE');
    if (action === 'extend') {
      assert.equal(result.verdict, 'passed');
      assert.equal(task.ledger.tokens.total, 24);
      assert.equal(reviewCall.reservation.state, 'settled');
    } else {
      assert.equal(result.verdict, 'unconfirmed');
      assert.equal(task.lifecycle, 'paused');
      assert.equal(task.ledger.tokens.total, 12);
      assert.equal(reviewCall.status, 'not-dispatched');
      assert.equal(reviewCall.reservation.state, 'released');
    }
  } finally { if (run) await run.catch(() => {}); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a trustworthy deterministic failure is not sent to a model for a competing success vote', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-deterministic-priority-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-unused'], adapter);
  const acceptance = new AcceptanceCoordinator(ctx, { review: { enabled: true, selection: { connectionId: 'dsh-native:review-unused', accountId: 'unknown', billingPath: 'unknown', provider: 'review-unused', model: 'rubric' }, forecast: { totalTokens: 12 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply BAD ARTICLE\n仅检查以下明确要求：\n正文不得包含「BAD」。\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'failed');
    assert.equal(adapter.reviews.length, 0);
    assert.equal(task.calls.length, 1);
    assert.equal(result.evidence[0].verdict, 'failed');
    assert.equal(result.evidence[1].verdict, 'unconfirmed');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('partial deterministic coverage remains unconfirmed instead of promoting a completed response', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-partial-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply HELLO\n仅检查以下明确要求：\n正文必须包含「HELLO」。\n语言应有感染力。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.coverage.covered, 1);
    assert.equal(result.coverage.uncoveredIds.length, 1);
    assert.equal(result.blocking[0].category, 'coverage-missing');
    assert.equal(task.lifecycle, 'completed');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('acceptance binds to the final committed assistant artifact after a real tool step', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-final-artifact-'));
  const ctx = await startNative(home);
  ctx.tools.register({
    name: 'router_test_wait',
    description: 'Complete the controlled tool step',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'TOOL_OK'; },
  });
  ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply FINAL\n[router:tool]\n仅检查以下明确要求：\n正文必须包含「FINAL」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.artifact.text, 'FINAL');
    assert.equal(result.artifact.step, 2);
    assert.equal(result.artifact.revision, 2);
    assert.equal(result.artifact.seq, task.calls[1].settlementSeq);
    assert.equal(result.evidence[0].artifactHash, result.artifact.hash);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});
