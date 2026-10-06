import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

class RequirementAdapter extends LlmAdapter {
  constructor(calls) { super(); this.calls = calls; }
  providerInfo(provider) { return { id: provider, name: 'Requirement proof' }; }
  async listModels(provider) { return [{ provider, id: 'capable', name: 'Capable', contextWindow: 131072, maxTokens: 2048, inputModalities: ['text', 'image'] }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'Capable', contextWindow: 131072, maxTokens: 2048, inputModalities: ['text', 'image'] }; }
  async *stream(options) {
    this.calls.push({ provider: options.provider, model: options.model, messages: structuredClone(options.messages) });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'CAPABLE_OK' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'CAPABLE_OK' } };
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 24 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class MeasuredAdapter extends LlmAdapter {
  constructor(label, delay) { super(); this.label = label; this.delay = delay; }
  providerInfo(provider) { return { id: provider, name: this.label }; }
  async listModels(provider) { return [{ provider, id: 'measured', name: this.label, contextWindow: 32768, maxTokens: 1024, inputModalities: ['text'] }]; }
  async resolveModel(provider, id) { return { provider, id, name: this.label, contextWindow: 32768, maxTokens: 1024, inputModalities: ['text'] }; }
  async *stream() {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: this.label };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.label } };
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 6 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const capability = (supported, confidence = supported === null ? 'unknown' : 'declared') => ({ supported, confidence, source: 't12-owned-metadata' });
const completeAcceptance = task => ({
  version: 1,
  schemaVersion: 1,
  taskId: task.id,
  requirementRevision: 1,
  requirementHash: 't12-comparable-requirement',
  artifact: { hash: `artifact-${task.id}`, complete: true },
  requirements: [{ id: 'requirement:t12:1', required: true }],
  evidence: [{ id: 'evidence:t12:1', requirementId: 'requirement:t12:1', verdict: 'passed' }],
  coverage: { required: 1, requiredIds: ['requirement:t12:1'], covered: 1, coveredIds: ['requirement:t12:1'], failedIds: [], uncovered: [], uncoveredIds: [] },
  verdict: 'passed',
  scope: 'explicit-requirements',
  limitations: ['finite-explicit-requirement-dsl', 'no-overall-quality-guarantee'],
  phase: 'checked',
});

async function addCapable(ctx, calls) {
  const dispose = ctx.router.registerOwned({
    provider: 't12-capable', connectionId: 't12-connection', accountId: 't12-account', billingPath: 'controlled-test',
    ownership: 'router-owned', source: 't12-test-provider', sourceKey: 't12-capable:v1', configRevision: 1,
    configured: true, authorizationStatus: 'authorized',
    models: [{ model: 'capable', name: 'Capable', maxContextTokens: 131072, capability: { text: capability(true), image: capability(true), tools: capability(false) } }],
  });
  const model = (await ctx.router.snapshot()).models.find(item => item.provider === 't12-capable' && item.available);
  await ctx.router.setModelEnabled(model.candidateId, true);
  return { model, dispose };
}

test('a complete Task selects by objective and exposes the stable candidate decision', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-objective-'));
  let ctx;
  try {
    ctx = await startNative(home);
    await ctx.router.setPriceQuote('controlled', { source: 'T12 controlled comparison', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'known', perMillion: { input: 9, output: 9 }, reasoning: 'included-in-output' });
    await ctx.router.setPriceQuote('controlled-tools', { source: 'T12 controlled comparison', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'known', perMillion: { input: 1, output: 1 }, reasoning: 'included-in-output' });
    await ctx.router.setRoutingObjective('cost');
    const record = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, 'Reply COST_SELECTED');
    assert.equal(record.result, 'COST_SELECTED');
    assert.equal(record.routing.status, 'selected');
    assert.equal(record.routing.objective, 'cost');
    assert.equal(record.routing.selected.candidateId, 'controlled-tools');
    assert.deepEqual(record.routing.reasonCodes, ['OBJECTIVE_COST']);
    assert.equal(record.calls[0].candidateId, 'controlled-tools');
    assert.deepEqual(record.calls[0].selection, record.routing.selected.identity);
    assert.equal(record.calls[0].selectionSnapshot.authEpoch, record.routing.selected.authEpoch);
    assert.equal(ctx.sessions.get(record.sessionId).requestHeader().config.model, 'controlled-tools');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('real image, tool and context requirements filter candidates before dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-requirements-'));
  const calls = [];
  let ctx, owned;
  try {
    ctx = await startNative(home, { images: true, beforeRouter(host) { host.llm.registerAdapter(['t12-capable'], new RequirementAdapter(calls)); } });
    owned = await addCapable(ctx, calls);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.router.setFixedModel(owned.model.candidateId);
    await submit(ctx, sessionId, 'Reply IMAGE_CAPABLE_BASELINE');
    await ctx.router.setFixedModel(null);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await ctx.sessionController.prompt({ sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Describe the image' }, { type: 'image', mediaType: 'image/png', data: png }] }, new AbortController().signal);
    await ctx.agents.get(sessionId).whenIdle();
    const image = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(image.routing.selected.candidateId, owned.model.candidateId);
    assert.deepEqual(image.routing.requirements.modalities, ['text', 'image']);
    assert.equal(image.routing.excluded.some(item => item.candidateId === 'controlled' && item.reasons.includes('IMAGE_CAPABILITY_UNSUPPORTED')), true);
    assert.equal(image.routing.excluded.some(item => item.candidateId === 'controlled-tools' && item.reasons.includes('IMAGE_CAPABILITY_UNKNOWN')), true);
    assert.equal(calls.length, 2);

    await ctx.router.setFixedModel(null);
    const long = await submit(ctx, sessionId, `${'x'.repeat(40_000)}\nReply LARGE_CONTEXT`);
    assert.equal(long.routing.selected.candidateId, owned.model.candidateId);
    assert.ok(long.routing.requirements.contextTokens >= 40_000);
    assert.equal(long.routing.excluded.some(item => item.candidateId === 'controlled' && item.reasons.includes('CONTEXT_CAPACITY_INSUFFICIENT')), true);

    await ctx.router.setModelEnabled(owned.model.candidateId, false);
    ctx.tools.register({ name: 'router_test_wait', description: 'T12 controlled tool', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    const toolSession = (await ctx.sessionController.create({ cwd: home })).sessionId;
    const tool = await submit(ctx, toolSession, '[router:tool]\nReply TOOL_ROUTED');
    assert.equal(tool.routing.requirements.tools, true);
    assert.equal(tool.calls.every(call => call.selection.model !== 'capable'), true);
    assert.equal(tool.result, 'TOOL_ROUTED');
  } finally {
    owned?.dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('opt-in semantic assessment is one budgeted call in the same Task and can only add requirements', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-assessment-'));
  const calls = [];
  let ctx, owned;
  try {
    ctx = await startNative(home, { beforeRouter(host) { host.llm.registerAdapter(['t12-capable'], new RequirementAdapter(calls)); } });
    owned = await addCapable(ctx, calls);
    await ctx.router.setSemanticAssessment(true);
    const record = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, '[router:assess:image]\nReply ASSESSED');
    assert.equal(record.routing.assessment.status, 'completed');
    assert.equal(typeof record.routing.assessment.callId, 'string');
    assert.deepEqual(record.routing.requirements.modalities, ['text', 'image']);
    assert.equal(record.routing.selected.candidateId, owned.model.candidateId);
    assert.deepEqual(record.calls.map(call => call.purpose), ['assessment', 'execution']);
    assert.equal(record.calls[0].id, record.routing.assessment.callId);
    assert.equal(record.calls[0].status, 'completed');
    assert.deepEqual(record.calls[0].selectionSnapshot, await ctx.router.captureCandidate(record.calls[0].candidateId));
    assert.match(calls[0].messages.map(message => message.content.filter(part => part.type === 'text').map(part => part.text).join('')).join('\n'), /Reply ASSESSED/);
    assert.equal(record.calls[1].selection.provider, 't12-capable');
    assert.equal(record.ledger.callCount, 2);
  } finally {
    owned?.dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a public one-shot assessment carries the actual Task input and is consumed exactly once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-assessment-context-'));
  const observed = [];
  let ctx;
  try {
    ctx = await startNative(home);
    ctx.on('llm/stream', async function* (request, next) {
      if (request.messages.some(message => message.content?.some(part => part.type === 'text' && part.text.startsWith('ROUTER_INITIAL_ASSESSMENT_V1')))) {
        observed.push(structuredClone(request.messages));
      }
      yield* next();
    }, { prepend: true });
    await ctx.router.setSemanticAssessment(true);
    await ctx.router.requestSemanticAssessment();
    assert.equal((await ctx.router.snapshot()).semanticAssessmentRequest.status, 'armed');
    const unique = 'CHECK_CURRENT_TASK_CONTEXT_87219';
    const assessed = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, `Please classify ${unique}`);
    assert.equal(assessed.calls.filter(call => call.purpose === 'assessment').length, 1);
    assert.equal(assessed.routing.assessment.status, 'insufficient');
    assert.match(JSON.stringify(observed), new RegExp(unique));
    assert.equal((await ctx.router.snapshot()).semanticAssessmentRequest, null);

    const ordinary = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, 'Reply ONE_SHOT_CONSUMED');
    assert.equal(ordinary.result, 'ONE_SHOT_CONSUMED');
    assert.equal(ordinary.calls.some(call => call.purpose === 'assessment'), false);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('an oversized one-shot assessment is visibly insufficient without reserving or dispatching a Call', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-assessment-oversized-'));
  let ctx;
  try {
    ctx = await startNative(home);
    await ctx.router.setSemanticAssessment(true);
    await ctx.router.requestSemanticAssessment();
    const task = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, `Classify ${'x'.repeat(20_000)}`);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.routing.assessment.status, 'insufficient');
    assert.equal(task.routing.assessment.reason, 'ASSESSMENT_CONTEXT_TOO_LARGE');
    assert.equal(task.calls.length, 0);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('fixed and native pending choices remain authoritative at the Task boundary', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-fixed-pending-'));
  let ctx;
  try {
    ctx = await startNative(home);
    await ctx.router.setRoutingObjective('cost');
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const fixed = await submit(ctx, sessionId, 'Reply FIXED');
    assert.deepEqual(fixed.routing.reasonCodes, ['FIXED_CANDIDATE']);
    assert.equal(fixed.calls[0].candidateId, 'controlled-tools');

    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    const conflict = await submit(ctx, sessionId, 'Reply MUST_NOT_RUN');
    assert.equal(conflict.lifecycle, 'paused');
    assert.equal(conflict.pauseReason, 'FIXED_MODEL_CONFLICT');
    assert.equal(conflict.calls.length, 0);
    assert.deepEqual(conflict.routing.reasonCodes, ['FIXED_NATIVE_SELECTION_CONFLICT']);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('measured history requires complete acceptance and an identical workload before it can rank candidates', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-observations-'));
  let ctx;
  const disposers = [];
  try {
    ctx = await startNative(home, { beforeRouter(host) {
      host.llm.registerAdapter(['t12-slow'], new MeasuredAdapter('SLOW', 35));
      host.llm.registerAdapter(['t12-fast'], new MeasuredAdapter('FAST', 2));
    } });
    for (const [provider, label] of [['t12-slow', 'Slow'], ['t12-fast', 'Fast']]) {
      disposers.push(ctx.router.registerOwned({
        provider, connectionId: `${provider}-connection`, accountId: `${provider}-account`, billingPath: 'controlled-test',
        ownership: 'router-owned', source: 't12-measurement-provider', sourceKey: `${provider}:v1`, configRevision: 1,
        configured: true, authorizationStatus: 'authorized',
        models: [{ model: 'measured', name: label, maxContextTokens: 32768, capability: { text: capability(true), image: capability(false), tools: capability(false) } }],
      }));
    }
    const owned = (await ctx.router.snapshot()).models.filter(item => item.source === 't12-measurement-provider');
    await ctx.router.setModelEnabled('controlled', false);
    await ctx.router.setModelEnabled('controlled-tools', false);
    for (const model of owned) await ctx.router.setModelEnabled(model.candidateId, true);
    for (const [index, model] of owned.entries()) {
      await ctx.router.setFixedModel(model.candidateId);
      const sessionId = (await ctx.sessionController.create({ cwd: home })).sessionId;
      const record = await submit(ctx, sessionId, `Reply DIFFERENT_WORKLOAD_${index}`);
      ctx.router.publishAcceptance(record.id, completeAcceptance(record));
    }
    await ctx.router.setFixedModel(null);
    await ctx.router.setRoutingObjective('speed');
    const unmatched = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, 'Reply COMPARABLE_WORKLOAD');
    assert.notDeepEqual(unmatched.routing.reasonCodes, ['OBJECTIVE_SPEED']);
    assert.deepEqual(unmatched.routing.comparison.unknowns, ['SPEED_NOT_COMPARABLE']);

    for (const model of owned) {
      await ctx.router.setFixedModel(model.candidateId);
      const sessionId = (await ctx.sessionController.create({ cwd: home })).sessionId;
      const record = await submit(ctx, sessionId, 'Reply COMPARABLE_WORKLOAD');
      ctx.router.publishAcceptance(record.id, completeAcceptance(record));
    }
    await ctx.router.setFixedModel(null);
    const routed = await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, 'Reply COMPARABLE_WORKLOAD');
    assert.equal(routed.routing.selected.identity.provider, 't12-fast');
    assert.deepEqual(routed.routing.reasonCodes, ['OBJECTIVE_SPEED']);
    assert.deepEqual(routed.routing.comparison.evidence, [{ metric: 'speed', direction: 'lower', unit: 'ms', source: 'accepted-measured-history' }]);
    assert.match(routed.routing.comparisonKey, /^sha256:[a-f0-9]{64}$/u);
  } finally {
    for (const dispose of disposers) dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('assessment waits visibly for Task budget and resumes through the same reservation after extension', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-assessment-budget-'));
  let ctx, run;
  try {
    ctx = await startNative(home);
    await ctx.router.setSemanticAssessment(true);
    await ctx.router.setBudgetDefaults({ tokens: 128, durationMs: null, money: [] });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '[router:assess:tools]\nReply AFTER_BUDGET');
    const deadline = Date.now() + 3000;
    let waiting;
    while (Date.now() < deadline) {
      waiting = (await ctx.router.snapshot()).tasks.at(-1);
      if (waiting?.lifecycle === 'waiting-budget') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(waiting.lifecycle, 'waiting-budget');
    assert.equal(waiting.routing.status, 'assessing');
    assert.equal(waiting.calls.length, 1);
    assert.equal(waiting.calls[0].purpose, 'assessment');
    assert.equal(waiting.calls[0].dispatchStarted, false);
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 10_000 });
    const record = await run;
    assert.deepEqual(record.calls.map(call => call.purpose), ['assessment', 'execution']);
    assert.equal(record.routing.assessment.status, 'completed');
    assert.equal(record.result, 'AFTER_BUDGET');
  } finally {
    if (run) { const active = (await ctx.router.snapshot()).tasks.at(-1); if (['running', 'waiting-budget'].includes(active?.lifecycle)) await ctx.router.stopTask(active.id); await run.catch(() => {}); }
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('the Host-only capture facade returns the canonical call snapshot and is absent from RPC', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-capture-'));
  let ctx;
  try {
    ctx = await startNative(home);
    const signal = new AbortController().signal;
    const captured = await ctx.router.captureCandidate('controlled', { signal });
    assert.equal(captured.candidateId, 'controlled');
    assert.deepEqual(captured.identity, { connectionId: 'controlled-local', accountId: 'local', billingPath: 'controlled', provider: 'router-controlled', model: 'controlled' });
    assert.equal(captured.enabled, true);
    assert.equal(captured.capability.text.supported, true);
    assert.ok(captured.connectionConfigRevision > 0 && captured.authEpoch > 0 && captured.registryEpoch > 0);
    await assert.rejects(ctx.router.captureCandidate('controlled', { config: structuredClone((await ctx.router.snapshot()).config), signal }), /Router-owned stable config/);
    assert.equal(descriptors.some(item => item.method === 'captureCandidate'), false);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
