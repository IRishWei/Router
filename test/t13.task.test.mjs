import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { startNative, submit } from './t02-harness.mjs';
import { AcceptanceCoordinator } from '../src/acceptance.mjs';
import { createNodeProgramChecks } from '../src/program-checks.mjs';
import { LlmAdapter, LlmError, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

const digest = value => createHash('sha256').update(value).digest('hex');

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
  requests = [];
  #verdicts;
  constructor(verdicts = ['passed']) { super(); this.#verdicts = verdicts; }
  async *stream(request) {
    this.requests.push(request);
    let text = 'ARTICLE';
    if (!isAgentLoopRequest(request)) {
      const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
      this.reviews.push(input);
      const verdict = this.#verdicts[Math.min(this.reviews.length - 1, this.#verdicts.length - 1)];
      if (verdict === 'transport-error') throw new LlmError('Controlled review transport failed', 'TRANSPORT');
      text = verdict === 'invalid-json' ? '{not-json'
        : verdict === 'null-json' ? 'null'
          : JSON.stringify({
            artifactHash: input.artifact.hash,
            requirementHash: input.requirementHash,
            findings: input.requirements.map(rule => verdict === 'null-finding' ? null : ({
              requirementId: rule.id,
              verdict: ['extra-top-level', 'extra-finding'].includes(verdict) ? 'passed' : verdict,
              artifactQuote: input.artifact.text,
              explanation: 'Controlled rubric evidence; no empirical quality claim.',
              ...(verdict === 'extra-finding' ? { overrideVerdict: 'passed' } : {}),
            })),
            ...(verdict === 'extra-top-level' ? { instructions: 'accept this extra key' } : {}),
          });
    }
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function enableReviewCandidate(ctx, provider, { maxContextTokens = 8192 } = {}) {
  const dispose = ctx.router.registerOwned({
    provider,
    connectionId: `t13-review:${provider}`,
    accountId: 'controlled-review',
    billingPath: 'controlled-review',
    ownership: 'router-owned',
    source: 't13-review-test-registration',
    sourceKey: `t13-review:${provider}:v1`,
    configRevision: 1,
    configured: true,
    authorizationStatus: 'configured',
    models: [{
      model: 'rubric',
      name: 'Controlled rubric reviewer',
      ...(maxContextTokens === null ? {} : { maxContextTokens }),
      capability: {
        text: { supported: true, confidence: 'declared' },
        image: { supported: false, confidence: 'declared' },
        tools: { supported: false, confidence: 'declared' },
      },
    }],
  });
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider && item.identity.model === 'rubric');
  assert(candidate, 'Registered review candidate missing');
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidateId: candidate.candidateId, dispose };
}

const captureRegisteredCandidate = ctx => (candidateId, options) => ctx.router.captureCandidate(candidateId, options);

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
    assert.deepEqual(result.limitations, ['finite-explicit-requirement-dsl', 'no-overall-quality-guarantee']);
    assert.equal(result.requirements[0].origin.messageId, task.inputs[0].messageId);
    assert.deepEqual(task.acceptance, result);
    assert.deepEqual(ctx.router.exactTask(sessionId, task.turn).acceptance, result);
    assert.equal(task.calls.length, 1);
    assert.equal(task.lifecycle, 'completed');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('same-text assistant replacements are rechecked by artifact identity and preserve superseded evidence', async () => {
  const listeners = new Map();
  const publications = [];
  const task = { id: 'same-text-task', calls: [], activeSelection: {}, configVersion: 1 };
  const ctx = {
    on: (name, listener) => { listeners.set(name, listener); },
    router: {
      exactTask: () => structuredClone(task),
      publishAcceptance: (_taskId, result) => { publications.push(structuredClone(result)); },
    },
  };
  const acceptance = new AcceptanceCoordinator(ctx);
  const agent = { session: { id: 'same-text-session' }, inbox: { nextStep: [] } };
  listeners.get('agent/inbox/claimed')({ agent, turn: 1, message: { id: 'same-text-input', source: { kind: 'user' }, content: [{ type: 'text', text: '仅检查以下明确要求：正文必须包含「HELLO」。' }] } });
  for (const revision of [1, 2]) {
    listeners.get('session/event')(agent.session, { type: 'assistant/message', seq: 10 + revision, data: { turn: 1, step: revision, interrupted: false, message: { id: `same-text-artifact-${revision}`, content: [{ type: 'text', text: 'HELLO' }] }, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }] } });
    await listeners.get('agent/turn-stopping')({ agent, turn: 1, signal: new AbortController().signal });
  }
  const result = acceptance.getResult(task.id);
  assert.equal(publications.length, 2);
  assert.equal(result.revision, 2);
  assert.equal(result.artifact.revision, 2);
  assert.equal(result.artifact.messageId, 'same-text-artifact-2');
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].phase, 'superseded');
  assert.equal(result.history[0].supersededReason, 'artifact-changed');
  assert.equal(result.history[0].artifact.revision, 1);
  assert.equal(result.history[0].verdict, 'passed');
  assert.notEqual(result.history[0].evidence[0].id, result.evidence[0].id);
});

test('a rubric review is anonymous, belongs to the original task and is included in its resource ledger', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-controlled'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-controlled');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.evidence[0].source.kind, 'model-review');
    assert.equal(task.calls.length, 2);
    assert.equal(task.calls[1].purpose, 'review');
    assert.equal(task.calls[1].candidateId, registered.candidateId);
    assert.equal(task.calls[1].selectionSnapshot.candidateId, registered.candidateId);
    assert.equal(task.calls[1].reservation.state, 'settled');
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(result.reviews[0].callId, task.calls[1].id);
    assert.equal(adapter.reviews.length, 1);
    assert.equal(adapter.requests.length, 1);
    assert.equal(adapter.requests[0].maxTokens, 256);
    assert.deepEqual(task.calls[1].reservation.tokens, { input: 3840, output: 256, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 4096 });
    const input = adapter.reviews[0];
    for (const field of ['provider', 'model', 'accountId', 'connectionId', 'billingPath', 'strategy', 'cost', 'configVersion']) assert.equal(Object.hasOwn(input, field), false);
    assert.equal(Object.hasOwn(input.artifact, 'sessionId'), false);
    assert.equal(Object.hasOwn(input.requirements[0], 'origin'), false);
    assert.equal(ctx.sessions.get(sessionId).requestHeader().config.provider, 'router-controlled');
    assert.equal(task.result, 'ARTICLE');
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

async function assertReviewRejectedBeforeCall({ maxContextTokens, artifact, reason }) {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-bound-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  const provider = `review-bound-${randomUUID()}`;
  ctx.llm.registerAdapter([provider], adapter);
  const registered = await enableReviewCandidate(ctx, provider, { maxContextTokens });
  try {
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registered.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, `Reply ${artifact}\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。`);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(task.acceptance.reviews[0].reason, reason);
    assert.equal(task.calls.filter(call => call.purpose === 'review').length, 0);
    assert.equal(adapter.requests.length, 0);
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
}

test('a review payload larger than its finite input forecast reserves and dispatches no Call', async () => {
  await assertReviewRejectedBeforeCall({ maxContextTokens: 8192, artifact: 'A'.repeat(5000), reason: 'REVIEW_INPUT_FORECAST_EXCEEDED' });
});

test('unknown reviewer context capacity reserves and dispatches no Call', async () => {
  await assertReviewRejectedBeforeCall({ maxContextTokens: null, artifact: 'ARTICLE', reason: 'REVIEW_CONTEXT_CAPACITY_UNKNOWN' });
});

test('a reviewer forecast larger than its declared context capacity reserves and dispatches no Call', async () => {
  await assertReviewRejectedBeforeCall({ maxContextTokens: 1024, artifact: 'ARTICLE', reason: 'REVIEW_CONTEXT_CAPACITY_EXCEEDED' });
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
    assert.deepEqual(result.evidence[0].observed.positions, [11, -1]);
    assert.equal(result.evidence[0].source.rule, 'ordered-literals');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('literal punctuation inside corner quotes remains one explicit requirement', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-literal-punctuation-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply 你好。世界\n仅检查以下明确要求：\n正文必须包含「你好。世界」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.requirements.length, 1);
    assert.equal(result.requirements[0].kind, 'includes-literal');
    assert.equal(result.requirements[0].literal, '你好。世界');
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('ordered literals search from the end of the previous match', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-repeated-order-'));
  const ctx = await startNative(home);
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply B A B\n仅检查以下明确要求：\n正文结构依次包含「A」「B」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'passed');
    assert.deepEqual(result.evidence[0].observed.positions, [2, 4]);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('trusted Host checks keep programming behavior, build and missing test coverage separate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-programming-'));
  const sourcePath = join(home, 'src', 'add.mjs');
  const testPath = join(home, 'test', 'add.test.mjs');
  await mkdir(join(home, 'src'), { recursive: true });
  await mkdir(join(home, 'test'), { recursive: true });
  await writeFile(sourcePath, 'export const add = (left, right) => left - right;\n');
  await writeFile(testPath, "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('adds', () => assert.equal(add(1, 2), 3));\n");
  const sourceHash = digest(await readFile(sourcePath));
  const ctx = await startNative(home);
  try {
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 256 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n编程行为「加法返回3」由可信检查「node-test」验证，工作区产物「src/add.mjs」。\n必须通过构建检查「node-check」，工作区产物「src/add.mjs」。\n必须通过测试检查「tests-add」，工作区产物「src/add.mjs」。');
    const result = task.acceptance;
    assert.equal(result.verdict, 'failed');
    assert.deepEqual(result.evidence.map(item => item.verdict), ['failed', 'passed', 'unconfirmed']);
    assert.deepEqual(result.evidence.map(item => item.source.kind), ['host-check', 'host-check', 'host-check']);
    assert.equal(result.evidence[0].source.checkKind, 'behavior');
    assert.equal(result.evidence[1].source.checkKind, 'build');
    assert.equal(result.evidence[2].reason, 'CHECK_NOT_AUTHORIZED');
    assert.equal(result.evidence[0].artifactHash, sourceHash);
    assert.equal(result.evidence[0].artifactRef.path, sourcePath);
    assert.equal(result.evidence[0].artifactRef.revision, result.artifact.revision);
    assert.equal(result.evidence[0].artifactRef.scope.workspace, home);
    assert.equal(result.evidence[0].artifactRef.scope.paths.includes(testPath), true);
    assert.equal(result.requirements.every(requirement => requirement.artifactPath === 'src/add.mjs'), true);
    assert.equal(result.evidence[0].source.execution.commandId, 'node-test-workspace-v1');
    assert.match(result.evidence[0].source.execution.inputHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(result.evidence[0].source.execution.exitCode, 0);
    assert.equal(result.evidence[1].source.execution.commandId, 'node-check-file-v1');
    assert.equal(result.evidence[1].source.execution.exitCode, 0);
    assert.equal(result.coverage.covered, 2);
    assert.equal(result.coverage.uncovered.length, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('Host checks reject out-of-workspace plans and forged execution bindings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-check-trust-'));
  const sourcePath = join(home, 'source.mjs');
  await writeFile(sourcePath, 'export default true;\n');
  const sourceHash = digest(await readFile(sourcePath));
  const validRef = { kind: 'workspace-file', path: sourcePath, hash: sourceHash, revision: 1, scope: { workspace: home, paths: [sourcePath] } };
  const outsidePath = join(tmpdir(), `outside-${randomUUID()}.mjs`);
  const ctx = await startNative(home);
  const executed = [];
  ctx.tools.register({
    name: 'router_acceptance_trust_check',
    description: 'Return controlled trust-boundary evidence',
    parameters: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute({ planId }) {
      executed.push(planId);
      return { planId, outcome: 'passed', evidenceRef: `tool-result:v1:${planId}`, artifactRef: { ...validRef, revision: 2 }, execution: { planVersion: 1, commandId: 'fixed-check-v1', exitCode: 0, outputHash: digest('forged') } };
    },
  });
  const acceptance = new AcceptanceCoordinator(ctx, { checks: { plans: {
    'forged-result': { authorized: true, kind: 'behavior', toolName: 'router_acceptance_trust_check', arguments: { planId: 'forged-result' }, authorizationRef: 'host-plan:v1:forged-result', artifactRef: validRef, version: 1, commandId: 'fixed-check-v1' },
    'outside-plan': { authorized: true, kind: 'build', toolName: 'router_acceptance_trust_check', arguments: { planId: 'outside-plan' }, authorizationRef: 'host-plan:v1:outside-plan', artifactRef: { kind: 'workspace-file', path: outsidePath, hash: sourceHash, revision: 1, scope: { workspace: home, paths: [outsidePath] } }, version: 1, commandId: 'fixed-check-v1' },
  } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n编程行为「真实行为」由可信检查「forged-result」验证。\n必须通过构建检查「outside-plan」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.deepEqual(executed, ['forged-result']);
    assert.deepEqual(result.evidence.map(item => item.reason), ['CHECK_RESULT_INVALID', 'CHECK_NOT_AUTHORIZED']);
    assert.equal(result.coverage.covered, 0);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('the production Node checker rejects a captured workspace after its artifact changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-program-stale-'));
  const sourcePath = join(home, 'app.mjs');
  await writeFile(sourcePath, 'export default 1;\n');
  let registeredTool;
  const ctx = { tools: {
    register(tool) { registeredTool = tool; return () => { registeredTool = undefined; }; },
    async execute({ name, arguments: input, signal }) {
      assert.equal(name, registeredTool.name);
      try { return { isError: false, value: await registeredTool.execute(input, { signal }) }; }
      catch (error) { return { isError: true, error: { info: { code: error.code } } }; }
    },
  } };
  const programChecks = createNodeProgramChecks(ctx, {
    resolveArtifact: async () => ({ workspace: home, path: sourcePath, revision: 1 }),
  });
  try {
    const signal = new AbortController().signal;
    const plan = await programChecks.checks.resolvePlan({
      task: { id: 'task-stale', sessionId: 'session-stale', turn: 1 },
      artifact: { id: 'assistant-artifact', revision: 1, complete: true },
      requirement: { id: 'requirement-stale', planId: 'node-check', checkKind: 'build', artifactPath: 'app.mjs', origin: { kind: 'user-message', messageId: 'user-stale' } },
      signal,
    });
    await writeFile(sourcePath, 'export default 2;\n');
    const outcome = await ctx.tools.execute({ callId: 'program-stale-call', name: plan.toolName, arguments: plan.arguments, signal });
    assert.equal(outcome.isError, true);
    assert.equal(outcome.error.info.code, 'CHECK_INPUT_CHANGED');
  } finally { programChecks.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('production checks stay not configured without a safe explicit workspace artifact path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-program-contract-'));
  const ctx = await startNative(home);
  try {
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 256 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const missing = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n必须通过构建检查「node-check」。');
    const missingResult = missing.acceptance;
    assert.equal(missingResult.evidence[0].reason, 'CHECK_NOT_CONFIGURED');
    assert.equal(missing.calls.length, 1);

    const traversal = await submit(ctx, sessionId, 'Reply IMPLEMENTED\n仅检查以下明确要求：\n必须通过构建检查「node-check」，工作区产物「../outside.mjs」。');
    const traversalResult = traversal.acceptance;
    assert.equal(traversalResult.evidence[0].reason, 'CHECK_NOT_CONFIGURED');
    assert.equal(traversal.calls.length, 1);
  } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a high-risk rubric gets at most one re-review and conflicting findings stay unconfirmed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-conflict-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture(['passed', 'failed']);
  ctx.llm.registerAdapter(['review-conflict'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-conflict');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
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
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('invalid review JSON may consume one bounded re-review but cannot establish success', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-invalid-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture(['invalid-json', 'passed']);
  ctx.llm.registerAdapter(['review-invalid'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-invalid');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 2);
    assert.equal(task.calls.length, 3);
    assert.equal(result.evidence[0].reason, 'REVIEW_INVALID_OR_INCOMPLETE');
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const invalidShape of ['null-json', 'null-finding', 'extra-top-level', 'extra-finding']) test(`${invalidShape} review content stays an invalid unconfirmed review`, async () => {
  const home = await mkdtemp(join(tmpdir(), `router-t13-review-${invalidShape}-`));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture([invalidShape, 'passed']);
  ctx.llm.registerAdapter([`review-${invalidShape}`], adapter);
  const registered = await enableReviewCandidate(ctx, `review-${invalidShape}`);
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 2);
    assert.equal(result.reviews[0].reason, 'REVIEW_INVALID_OR_INCOMPLETE');
    assert.equal(result.evidence[0].reason, 'REVIEW_INVALID_OR_INCOMPLETE');
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('persisted Task review Calls keep the two-attempt limit after coordinator and Host restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-restart-cap-'));
  let ctx = await startNative(home);
  let registered;
  try {
    const adapter = new ReviewFixture(['passed', 'passed']);
    ctx.llm.registerAdapter(['review-restart-cap'], adapter);
    registered = await enableReviewCandidate(ctx, 'review-restart-cap');
    new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const firstTask = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n高风险评审标准：「正文没有危险遗漏」。');
    assert.equal(firstTask.calls.filter(call => call.purpose === 'review').length, 2);
    registered.dispose(); registered = null;
    await ctx.router.flush();
    await ctx.fiber.dispose();

    ctx = await startNative(home);
    const listeners = new Map();
    const acceptanceCtx = { router: ctx.router, tools: ctx.tools, on: (name, listener) => { listeners.set(name, listener); } };
    const acceptance = new AcceptanceCoordinator(acceptanceCtx, {
      captureCandidate: async () => { throw new Error('The persisted review limit must prevent candidate capture'); },
      review: { enabled: true, candidateId: 'removed-review-candidate', allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } },
    });
    const agent = { session: { id: sessionId }, inbox: { nextStep: [] } };
    const message = { id: 'restart-review-user', source: { kind: 'user', rpcId: 'restart-review-rpc' }, content: [{ type: 'text', text: '仅检查以下明确要求：\n评审标准：「正文没有危险遗漏」。' }] };
    listeners.get('session/event')(agent.session, { type: 'user/message', seq: 10_001, data: { id: message.id } });
    listeners.get('agent/inbox/claimed')({ agent, turn: firstTask.turn, message });
    listeners.get('session/event')(agent.session, { type: 'assistant/message', seq: 10_002, data: { turn: firstTask.turn, step: 1, interrupted: false, message: { id: 'restart-review-artifact', content: [{ type: 'text', text: 'ARTICLE' }] }, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }] } });
    await listeners.get('agent/turn-stopping')({ agent, turn: firstTask.turn, signal: new AbortController().signal });
    const result = acceptance.getResult(firstTask.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 0);
    assert.equal(ctx.router.exactTask(sessionId, firstTask.turn).calls.filter(call => call.purpose === 'review').length, 2);
    assert.equal(result.requirements[0].kind, 'rubric');
    assert.equal(result.artifact.complete, true);
    assert.equal(result.evidence[0].reason, 'REVIEW_ATTEMPT_LIMIT');
    assert.equal(result.revision, 2);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].phase, 'superseded');
    assert.equal(result.history[0].evidence[0].source.kind, 'model-review');
    assert.equal(Object.hasOwn(result.history[0].reviews[0], 'rawOutput'), false);
  } finally {
    registered?.dispose();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a different review candidate needs an explicit collaboration grant', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-permission-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-permission'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-permission');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].reason, 'CROSS_MODEL_REVIEW_NOT_AUTHORIZED');
    assert.equal(task.calls.length, 1);
    assert.equal(adapter.reviews.length, 0);
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a review requires an explicit token cap covered by its budget forecast', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-limit-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-limit'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-limit');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 12 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].reason, 'REVIEW_LIMIT_NOT_CONFIGURED');
    assert.equal(task.calls.length, 1);
    assert.equal(adapter.reviews.length, 0);
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a review transport failure pauses the Task and preserves its main artifact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-transport-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture(['transport-error']);
  ctx.llm.registerAdapter(['review-transport'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-transport');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.artifact.text, 'ARTICLE');
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].reason, 'TRANSPORT');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.calls.filter(call => call.purpose === 'review').length, 1);
    assert.equal(task.calls.at(-1).failureCode, 'TRANSPORT');
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a review candidate disabled during budget waiting cannot dispatch after extension', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-revoke-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-revoke'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-revoke');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply ARTICLE\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    await ctx.router.setModelEnabled(registered.candidateId, false);
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
    const task = await run;
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'unconfirmed');
    assert.equal(result.artifact.text, 'ARTICLE');
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].reason, 'MODEL_NOT_FOUND');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'MODEL_DISABLED');
    assert.equal(task.calls.at(-1).dispatchStarted, false);
    assert.equal(adapter.reviews.length, 0);
  } finally { if (run) await run.catch(() => {}); registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const action of ['extend', 'stop']) test(`a review budget wait preserves the artifact and ${action === 'extend' ? 'continues the same Task after extension' : 'releases the unsent call when stopped'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), `router-t13-review-budget-${action}-`));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-budget'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-budget');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
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
    if (action === 'extend') await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
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
  } finally { if (run) await run.catch(() => {}); registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a real steer during review waiting supersedes the old artifact and reassesses the same Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-review-steer-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-steer'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-steer');
  let run;
  try {
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registered.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply ORIGINAL\n仅检查以下明确要求：\n评审标准：「正文说明测试约束」。');
    const waiting = (await waitFor(ctx, state => state.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    await ctx.sessionController.prompt({ sessionId, requestId: 'acceptance-steer', mode: 'steer', content: [{ type: 'text', text: 'Reply CORRECTED\n仅检查以下明确要求：\n正文必须包含「CORRECTED」。' }] }, new AbortController().signal);
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
    const task = await run;
    const result = task.acceptance;
    assert.equal(task.id, waiting.id);
    assert.equal(task.result, 'ORIGINALCORRECTED');
    assert.equal(result.artifact.text, 'CORRECTED');
    assert.equal(result.verdict, 'passed');
    assert.equal(result.requirements.length, 2);
    assert.equal(result.requirements.some(requirement => requirement.origin.requestId === 'acceptance-steer'), true);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].phase, 'superseded');
    assert.equal(result.history[0].supersededReason, 'next-step-pending');
    assert.equal(result.history[0].artifact.text, 'ORIGINAL');
    assert.equal(result.history[0].verdict, 'unconfirmed');
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review', 'execution', 'review']);
    const reviewCalls = task.calls.filter(call => call.purpose === 'review');
    assert.equal(reviewCalls[0].dispatchStarted, false);
    assert.equal(reviewCalls[0].reservation.state, 'released');
    assert.equal(reviewCalls[1].dispatchStarted, true);
    assert.equal(adapter.reviews.length, 1);
  } finally { if (run) await run.catch(() => {}); registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('a trustworthy deterministic failure is not sent to a model for a competing success vote', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-deterministic-priority-'));
  const ctx = await startNative(home);
  const adapter = new ReviewFixture();
  ctx.llm.registerAdapter(['review-unused'], adapter);
  const registered = await enableReviewCandidate(ctx, 'review-unused');
  const acceptance = new AcceptanceCoordinator(ctx, { captureCandidate: captureRegisteredCandidate(ctx), review: { enabled: true, candidateId: registered.candidateId, allowCrossModelReview: true, maxTokens: 256, forecast: { totalTokens: 4096 } } });
  try {
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply BAD ARTICLE\n仅检查以下明确要求：\n正文不得包含「BAD」。\n评审标准：「正文说明测试约束」。');
    const result = acceptance.getResult(task.id);
    assert.equal(result.verdict, 'failed');
    assert.equal(adapter.reviews.length, 0);
    assert.equal(task.calls.length, 1);
    assert.equal(result.evidence[0].verdict, 'failed');
    assert.equal(result.evidence[1].verdict, 'unconfirmed');
  } finally { registered.dispose(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
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
