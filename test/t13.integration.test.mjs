import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';

const deterministicPolicy = {
  enabled: true,
  review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 256 },
};

class IntegratedReviewer extends LlmAdapter {
  requests = [];
  async *stream(request) {
    this.requests.push(request);
    let text = 'ARTICLE';
    if (!isAgentLoopRequest(request)) {
      const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
      text = JSON.stringify({
        artifactHash: input.artifact.hash,
        requirementHash: input.requirementHash,
        findings: input.requirements.map(requirement => ({ requirementId: requirement.id, verdict: 'passed', artifactQuote: input.artifact.text, explanation: 'The explicit rubric is covered.' })),
      });
    }
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('shared Host wiring keeps acceptance opt-in and persists deterministic results across restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-integrated-'));
  let ctx;
  try {
    ctx = await startNative(home);
    let session = await ctx.sessionController.create({ cwd: home });
    const untouched = await submit(ctx, session.sessionId, 'Reply HELLO\n仅检查以下明确要求：\n正文必须包含「HELLO」。');
    assert.deepEqual(untouched.acceptance, { verdict: 'unconfirmed', evidence: [] });
    await ctx.router.setAcceptancePolicy(deterministicPolicy);
    session = await ctx.sessionController.create({ cwd: home });
    const accepted = await submit(ctx, session.sessionId, 'Reply HELLO\n仅检查以下明确要求：\n正文必须包含「HELLO」。');
    assert.equal(accepted.acceptance.verdict, 'passed');
    assert.equal(accepted.acceptance.evidence[0].source.kind, 'deterministic-rule');
    const acceptedRecord = structuredClone(accepted.acceptance);
    await ctx.fiber.dispose();
    ctx = await startNative(home);
    const snapshot = await ctx.router.snapshot();
    assert.deepEqual(snapshot.config.acceptance, deterministicPolicy);
    assert.deepEqual(snapshot.tasks.find(task => task.id === accepted.id).acceptance, acceptedRecord);
    session = await ctx.sessionController.create({ cwd: home });
    const afterRestart = await submit(ctx, session.sessionId, 'Reply AGAIN\n仅检查以下明确要求：\n正文必须包含「AGAIN」。');
    assert.equal(afterRestart.acceptance.verdict, 'passed');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('shared Host wiring runs an explicitly named Node workspace behavior check', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-integrated-check-'));
  let ctx;
  try {
    await mkdir(join(home, 'src'), { recursive: true });
    await mkdir(join(home, 'test'), { recursive: true });
    await writeFile(join(home, 'src', 'add.mjs'), 'export const add = (left, right) => left + right;\n');
    await writeFile(join(home, 'test', 'add.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from '../src/add.mjs'; test('add', () => assert.equal(add(1, 2), 3));\n");
    ctx = await startNative(home);
    await ctx.router.setAcceptancePolicy(deterministicPolicy);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n编程行为「加法返回3」由可信检查「node-test」验证，工作区产物「src/add.mjs」。');
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.acceptance.evidence[0].source.kind, 'host-check');
    assert.equal(task.acceptance.evidence[0].source.execution.commandId, 'node-test-workspace-v1');
    assert.equal(task.acceptance.evidence[0].artifactRef.path, join(home, 'src', 'add.mjs'));
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('shared review policy uses a canonical enabled candidate and requires explicit cross-model permission', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-integrated-review-'));
  let ctx;
  let dispose;
  try {
    ctx = await startNative(home);
    const adapter = new IntegratedReviewer();
    ctx.llm.registerAdapter(['integrated-reviewer'], adapter);
    dispose = ctx.router.registerOwned({
      provider: 'integrated-reviewer', connectionId: 'review-connection', accountId: 'review-account', billingPath: 'review-billing', ownership: 'router-owned',
      source: 't13-integrated-test', sourceKey: 't13-integrated-reviewer:v1', configRevision: 1, configured: true, authorizationStatus: 'configured',
      models: [{ model: 'review', name: 'Integrated reviewer', maxContextTokens: 8192, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } } }],
    });
    const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === 'integrated-reviewer');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    const policy = { enabled: true, review: { enabled: true, candidateId: candidate.candidateId, allowCrossModel: false, maxTokens: 128, forecastTokens: 128 } };
    await ctx.router.setAcceptancePolicy(policy);
    let session = await ctx.sessionController.create({ cwd: home });
    const denied = await submit(ctx, session.sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明约束」。');
    assert.equal(denied.acceptance.verdict, 'unconfirmed');
    assert.equal(denied.acceptance.reviews[0].reason, 'CROSS_MODEL_REVIEW_NOT_AUTHORIZED');
    assert.equal(adapter.requests.length, 0);
    await ctx.router.setAcceptancePolicy({ ...policy, review: { ...policy.review, allowCrossModel: true } });
    session = await ctx.sessionController.create({ cwd: home });
    const reviewed = await submit(ctx, session.sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明约束」。');
    assert.equal(reviewed.acceptance.verdict, 'passed');
    assert.equal(reviewed.calls.at(-1).candidateId, candidate.candidateId);
    assert.deepEqual(reviewed.calls.at(-1).selection, candidate.identity);
    assert.equal(reviewed.calls.at(-1).selectionSnapshot.candidateId, candidate.candidateId);
    assert.equal(reviewed.calls.at(-1).reservation.tokens.total, 128);
    assert.equal(adapter.requests.length, 1);
    assert.equal(adapter.requests[0].maxTokens, 128);
  } finally {
    if (dispose) dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
