import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, isAgentLoopRequest, createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import { startNative, submit } from './t02-harness.mjs';

const policy = { enabled: true, candidateId: null, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, forecastTokens: 32768 };
const handoff = { protocol: 'dsh-canonical-v1', toolProtocol: 'function-json-schema-v1', confidence: 'declared', source: 't17-controlled-wire' };
class TakeoverFixture extends LlmAdapter {
  requests = [];
  imageReads = [];
  modalities = ['text'];
  constructor(role) { super(); this.role = role; }
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: this.modalities, context: { contextWindow: 65536 }, systemPromptUpdate: 'in-history', toolUpdate: 'in-history' });
  }
  async listModels(provider) { return [await this.resolveModel(provider, 'model')]; }
  imageRequestPricing() { return this.pricing === 'unknown' ? undefined : { priceImages: images => images.map(() => ({ visualTokens: 64, text: '' })) }; }
  async *stream(request) {
    this.requests.push(request);
    if (this.beforeResponse) await this.beforeResponse(request.signal);
    if (this.failBeforeResponse) throw new LlmError('Controlled target failure before response', 'NETWORK_ERROR');
    if (this.failAfterResponse) { yield { type: 'text-delta', index: 0, text: 'PARTIAL_TARGET' }; throw new LlmError('Controlled failure after a response', 'NETWORK_ERROR'); }
    for (const part of request.messages.flatMap(message => message.content).filter(part => part.type === 'image')) {
      const image = await this.attachments.readImage(part.attachment, request.signal);
      this.imageReads.push({ ref: image.ref, hash: createHash('sha256').update(image.data).digest('hex') });
    }
    if (this.role === 'main' && this.toolName && !request.messages.some(message => message.role === 'tool')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: 'completed-call-1', name: this.toolName, argumentsDelta: JSON.stringify(this.toolArgs ?? {}) };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    if (this.role === 'target' && this.repeatTool && this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: this.repeatCallId ?? 'new-target-call', name: this.repeatTool, argumentsDelta: JSON.stringify(this.repeatArgs ?? {}) };
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const kinds = request.messages.map(message => message.source?.kind);
    const text = this.role === 'advisor' ? 'Expand the body while keeping every original constraint.'
      : this.role === 'target' ? 'A'.repeat(this.targetLength ?? 14)
        : kinds.includes('router-consultation') ? 'A'.repeat(this.afterAdviceLength ?? 8)
          : kinds.includes('router-self-repair') ? 'A'.repeat(6) : 'A'.repeat(4);
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' }, ...(this.replayState ? { replayState: this.replayState } : {}) };
  }
}
async function register(ctx, provider, adapter, { capacity = 65536, handoffFact = handoff, image = false, model = 'model' } = {}) {
  adapter.attachments = ctx.get('attachments');
  const adapterHandle = ctx.llm.registerAdapter([provider], adapter);
  const source = { provider, connectionId: provider + '-connection', accountId: provider + '-account', billingPath: 't17-local-fixture', ownership: 'router-owned', source: 't17-native-task-fixture', sourceKey: provider + ':' + model, configRevision: 1, configured: true, authorizationStatus: 'configured', models: [{ model, name: provider, maxContextTokens: capacity, handoff: handoffFact, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: image, confidence: image === null ? 'unknown' : 'declared' }, tools: { supported: true, confidence: 'declared' } } }] };
  const dispose = ctx.router.registerOwned(source);
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider && item.identity.model === model);
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidate, dispose, adapterHandle, source };
}
async function prepare(home, options = {}) {
  const ctx = await startNative(home, options.nativeOptions);
  const main = new TakeoverFixture('main'), advisor = new TakeoverFixture('advisor'), target = new TakeoverFixture('target');
  if (options.images) { main.modalities = ['text', 'image']; target.modalities = ['text', 'image']; }
  const nativeRequests = [];
  ctx.on('llm/stream', (request, next) => { if (isAgentLoopRequest(request)) nativeRequests.push(request); return next(); });
  const registrations = [];
  try {
    for (const [id, adapter] of [['t17-main', main], ['t17-advisor', advisor], ['t17-target', target]]) registrations.push(await register(ctx, id, adapter, id === 't17-target' ? { image: Boolean(options.images), ...options.targetOptions } : { image: id === 't17-main' && Boolean(options.images) }));
    await ctx.router.setFixedModel(registrations[0].candidate.candidateId);
    await ctx.router.setBudgetDefaults({ tokens: options.tokens ?? 65536, durationMs: null, money: [] });
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    await ctx.router.setCoordinationPolicy({ enabled: true, candidateId: registrations[1].candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, maxAdviceChars: 1024, forecastTokens: 4096 });
    await ctx.router.setTakeoverPolicy({ ...policy, candidateId: registrations[2].candidate.candidateId, ...options.policy });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    return { ctx, main, advisor, target, registrations, sessionId, nativeRequests };
  } catch (error) { registrations.forEach(item => item.dispose()); await ctx.router.flush(); await ctx.fiber.dispose(); throw error; }
}
async function cleanup(home, run) {
  if (run) { run.registrations.forEach(item => item.dispose()); await run.ctx.router.flush(); await run.ctx.fiber.dispose(); }
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
}
const prompt = 'Keep the original constraint and all earlier work. 仅检查以下明确要求：正文长度为10至20个字符。';
async function waitFor(ctx, predicate) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const snapshot = await ctx.router.snapshot();
    const task = snapshot.tasks.at(-1);
    if (predicate(task)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Native Task did not reach the expected state');
}

test('one native Task takes over after delivered advice and new trusted failure, retaining all history and one ledger', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-takeover-'));
  let run;
  try {
    run = await prepare(home);
    const defaultBefore = run.ctx.agentDefaultModel.currentSelection();
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'passed', JSON.stringify({ takeover: task.takeover?.plan.state, reason: task.takeover?.plan.reason, pause: task.pauseReason }));
    assert.deepEqual(task.acceptance.history.map(item => item.evidence[0].measurement.value), [4, 6, 8]);
    assert.equal(task.acceptance.evidence[0].measurement.value, 14);
    assert.equal(task.turn, 1);
    assert.equal((await run.ctx.router.snapshot()).tasks.length, 1);
    assert.equal(task.takeover.attempts, 1);
    assert.equal(task.takeover.plan.state, 'completed');
    assert.equal(task.takeover.plan.finalRequest.sessionId, task.sessionId);
    assert.equal(task.takeover.plan.finalRequest.taskId, task.id);
    assert.equal(task.takeover.plan.finalRequest.turn, task.turn);
    assert.equal(task.takeover.plan.source.identity.provider, 't17-main');
    assert.equal(task.takeover.plan.target.identity.provider, 't17-target');
    assert.equal(task.executionOwner.identity.provider, 't17-target');
    assert.equal(task.executionOwner.callId, task.takeover.plan.callId);
    assert.equal(task.calls.length, 5);
    assert.equal(task.calls.filter(call => call.purpose === 'consultation').length, 1);
    assert.equal(task.ledger.tokens.total, 60);
    assert.deepEqual(run.ctx.agentDefaultModel.currentSelection(), defaultBefore);
    assert.equal(run.target.requests.length, 1);
    const request = run.target.requests[0];
    assert.equal(isAgentLoopRequest(run.nativeRequests.find(item => item.provider === 't17-target')), true);
    assert.equal(request.messages.find(message => message.id === task.inputs[0].messageId).content[0].text, prompt);
    assert.deepEqual(request.messages.filter(message => message.role === 'assistant').map(message => message.content[0].text), ['AAAA', 'AAAAAA', 'AAAAAAAA']);
    assert.equal(request.messages.some(message => message.source?.kind === 'router-consultation'), true);
    assert.equal(request.messages.some(message => message.source?.kind === 'router-takeover'), true);
    assert.equal(task.takeover.plan.portableHistory.messages.filter(message => message.role === 'assistant').length, 3);
  } finally { await cleanup(home, run); }
});

test('portable tool proof uses disposable public asynchronous Session observations from one full cut', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-query-cut-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    const observe = run.ctx.sessionQuery.observeSession.bind(run.ctx.sessionQuery);
    const modes = [];
    let released = 0;
    run.ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      modes.push(options.projectionMode);
      return { ...lease, [Symbol.dispose]() { released++; lease[Symbol.dispose](); } };
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.ok(modes.length >= 2);
    assert.equal(modes.every(mode => mode === 'none'), true);
    assert.equal(released, modes.length);
    const proof = task.takeover.plan.portableHistory.sessionProof;
    assert.equal(proof.source, 'live');
    assert.equal(proof.mode, 'none');
    assert.equal(proof.projectionAsOfSeq, null);
    assert.equal(proof.sessionId, run.sessionId);
    assert.equal(proof.toolRecords[0].callId, 'completed-call-1');
    assert.ok(proof.toolRecords[0].callSeq < proof.toolRecords[0].resultSeq);
  } finally { await cleanup(home, run); }
});

test('a legitimate repeated read with a new id remains allowed and the latest full native request is retained for recovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-read-repeat-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run);
    run.target.repeatTool = run.main.toolName;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(calls.length, 2);
    assert.equal(run.target.requests.length, 2);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.takeover.plan.state, 'completed');
    assert.equal(task.takeover.plan.finalRequest.messages.filter(message => message.role === 'tool').length, 2);
    assert.equal(task.takeover.plan.finalRequest.messages.find(message => message.id === task.inputs[0].messageId).content[0].text, prompt);
    assert.equal(task.takeover.plan.finalRequest.callId, task.executionOwner.callId);
    assert.equal(task.calls.length, 7);
    assert.equal(task.ledger.tokens.total, 84);
  } finally { await cleanup(home, run); }
});

test('takeover denies a new tool call id that repeats a completed side-effect operation key before the body runs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-operation-key-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run, { effect: 'side-effect' });
    run.target.repeatTool = run.main.toolName;
    run.target.repeatArgs = run.main.toolArgs;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(calls.length, 1);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_DUPLICATE_OPERATION');
    assert.equal(task.toolReceipts.find(item => item.callId === 'completed-call-1').outcome, 'completed');
    assert.equal(task.toolReceipts.find(item => item.callId === 'new-target-call').outcome, 'unknown');
    assert.equal(run.target.requests.length, 1);
    assert.equal(task.acceptance.verdict, 'failed');
  } finally { await cleanup(home, run); }
});

function registerTool(run, { effect = 'read', fail = false } = {}) {
  const calls = [];
  const name = effect === 'read' ? 't17_read_receipt' : 't17_write_receipt';
  const definition = { name, description: 'Controlled receipt operation', parameters: { type: 'object', properties: { operationId: { type: 'string' } }, additionalProperties: false },
    routerOperation: { version: 1, effect, idempotencyKey: effect === 'side-effect' ? 'operationId' : null, source: 't17-controlled-tool-contract', confidence: 'declared' },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { calls.push(args); if (fail) throw new Error('Controlled result unknown'); return 'RECEIPT_COMPLETE:ORIGINAL_VALUE'; },
  };
  run.toolDefinition = definition;
  run.disposeTool = run.ctx.tools.register(definition);
  run.main.toolName = name;
  run.main.toolArgs = effect === 'side-effect' ? { operationId: 'original-operation' } : {};
  return calls;
}
test('complete native tool call and result survive takeover with exact schema identity and no historical re-execution', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-tools-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run);
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.takeover.plan.state, 'completed');
    assert.equal(calls.length, 1);
    const request = run.target.requests[0];
    assert.equal(request.messages.flatMap(message => message.content).some(part => part.type === 'tool-call' && part.id === 'completed-call-1'), true);
    assert.equal(request.messages.find(message => message.toolCallId === 'completed-call-1').content[0].text, 'RECEIPT_COMPLETE:ORIGINAL_VALUE');
    assert.equal(task.takeover.plan.portableHistory.toolReceipts[0].callId, 'completed-call-1');
    assert.equal(task.takeover.plan.portableHistory.toolReceipts[0].outcome, 'completed');
    assert.equal(request.tools.some(tool => tool.name === 't17_read_receipt'), true);
    assert.equal(task.calls.length, 6);
    assert.equal(task.ledger.tokens.total, 72);
  } finally { await cleanup(home, run); }
});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function submitImage(run, text = prompt) {
  await submit(run.ctx, run.sessionId, 'Prepare to retain the original image.');
  await run.ctx.sessionController.prompt({ sessionId: run.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }, { type: 'image', mediaType: 'image/png', data: png }] }, new AbortController().signal);
  await run.ctx.agents.get(run.sessionId).whenIdle();
  return (await run.ctx.router.snapshot()).tasks.at(-1);
}
test('image-bearing takeover carries the original image bytes and prior dialogue without a placeholder or separate Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-image-'));
  let run;
  try {
    run = await prepare(home, { images: true, nativeOptions: { images: true } });
    const task = await submitImage(run);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.takeover.plan.state, 'completed');
    assert.equal(run.target.requests.length, 1);
    const image = run.main.requests.flatMap(request => request.messages.flatMap(message => message.content)).find(part => part.type === 'image');
    const input = run.target.requests[0].messages.find(message => message.id === task.inputs[0].messageId);
    assert.deepEqual(input.content.find(part => part.type === 'image').attachment, image.attachment);
    assert.equal(run.target.imageReads[0].hash, 'e68bb6828d842a6c845223b2966aef7c28134491c003f940020e17ee8b06391d');
    assert.equal(task.takeover.plan.portableHistory.images.length, 1);
    assert.equal(task.takeover.plan.imageForecast.visualTokens, 64);
    assert.equal((await run.ctx.router.snapshot()).tasks.length, 2);
    assert.equal(task.calls.length, 5);
  } finally { await cleanup(home, run); }
});

test('a newly fixed user choice during target budget wait cancels the un-dispatched plan and retains the last response owner', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-budget-fixed-race-'));
  let run;
  try {
    run = await prepare(home, { tokens: 5000 });
    const pending = submit(run.ctx, run.sessionId, prompt);
    const waiting = await waitFor(run.ctx, task => task?.lifecycle === 'waiting-budget' && task.takeover?.plan.state === 'prepared');
    assert.equal(waiting.executionOwner.identity.provider, 't17-main');
    assert.equal(run.target.requests.length, 0);
    await run.ctx.router.setFixedModel(run.registrations[1].candidate.candidateId);
    const task = await pending;
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.state, 'refused');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_POLICY_CHANGED');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
  } finally { await cleanup(home, run); }
});

test('a target entered before its first response has possible ownership and unknown dispatch, preserving unknown usage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-dispatch-unknown-'));
  let run;
  try {
    run = await prepare(home);
    run.target.failBeforeResponse = true;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(run.target.requests.length, 1);
    assert.equal(task.takeover.plan.state, 'dispatch-unknown');
    assert.equal(task.takeover.plan.acceptanceVerdict, null);
    assert.equal(task.executionOwner.confidence, 'possible');
    assert.equal(task.takeover.plan.source.identity.provider, 't17-main');
    assert.equal(task.takeover.plan.source.confidence, 'response-observed');
    const call = task.calls.find(item => item.takeoverPlanId);
    assert.equal(call.status, 'failed');
    assert.equal(call.usage, null);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.acceptance.revision, 3);
  } finally { await cleanup(home, run); }
});

test('metadata bound by the actual native prepared call must match the accepted target generation before dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-prepared-generation-'));
  let run;
  try {
    run = await prepare(home);
    run.target.prepareCall = async function(provider, model, signal) {
      const prepared = await LlmAdapter.prototype.prepareCall.call(this, provider, model, signal);
      return { ...prepared, model: { ...prepared.model, context: { contextWindow: 1 } } };
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_PREPARED_MODEL_CHANGED');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(task.acceptance.verdict, 'failed');
  } finally { await cleanup(home, run); }
});

for (const possibleDispatch of [false, true]) test(`Host restart preserves a native ${possibleDispatch ? 'possible dispatch with unknown usage' : 'pending un-dispatched handoff'} without automatic replay`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-live-restart-'));
  const cutHome = await mkdtemp(join(tmpdir(), 'router-t17-restart-cut-'));
  let run, restarted;
  try {
    run = await prepare(home, { tokens: possibleDispatch ? 65536 : 5000 });
    if (possibleDispatch) run.target.beforeResponse = signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const pending = submit(run.ctx, run.sessionId, prompt);
    const active = await waitFor(run.ctx, task => possibleDispatch ? task?.takeover?.plan.state === 'dispatch-started' : task?.lifecycle === 'waiting-budget' && task.takeover?.plan.state === 'prepared');
    await run.ctx.router.flush();
    const statePath = join(cutHome, 'router', 'test', 'state.json');
    await mkdir(join(cutHome, 'router', 'test'), { recursive: true });
    await writeFile(statePath, await readFile(join(home, 'router', 'test', 'state.json'), 'utf8'));
    await run.ctx.router.stopTask(active.id);
    await pending;
    restarted = await startNative(cutHome);
    const task = (await restarted.router.snapshot()).tasks.find(item => item.id === active.id);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'HOST_RESTARTED');
    assert.equal(task.takeover.plan.state, possibleDispatch ? 'dispatch-unknown' : 'delivery-unknown');
    assert.equal(task.takeover.attempts, 1);
    assert.equal(task.executionOwner.identity.provider, possibleDispatch ? 't17-target' : 't17-main');
    assert.equal(task.executionOwner.confidence, possibleDispatch ? 'possible' : 'response-observed');
    assert.equal(task.calls.at(-1).status, possibleDispatch ? 'interrupted' : 'not-dispatched');
    assert.equal(task.calls.at(-1).usage, null);
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(task.ledger.tokens.total, possibleDispatch ? null : 48);
    assert.equal(task.calls.length, active.calls.length);
    assert.equal(task.acceptance.verdict, 'failed');
    const durable = JSON.parse(await readFile(statePath, 'utf8')).tasks.find(item => item.id === task.id);
    assert.deepEqual(durable.takeover, task.takeover);
    await restarted.fiber.dispose();
    restarted = await startNative(cutHome);
    const twice = (await restarted.router.snapshot()).tasks.find(item => item.id === task.id);
    assert.deepEqual(twice.takeover, task.takeover);
    assert.deepEqual(twice.calls, task.calls);
    assert.equal((await restarted.router.snapshot()).tasks.length, 1);
  } finally {
    if (restarted) await restarted.fiber.dispose();
    await cleanup(home, run);
    await rm(cutHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
});

test('a failed target receives canonical re-acceptance and a visible attempt limit without ping-pong or another consultation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-attempt-limit-'));
  let run;
  try {
    run = await prepare(home);
    run.target.targetLength = 9;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.acceptance.evidence[0].measurement.value, 9);
    assert.equal(task.takeover.plan.acceptanceVerdict, 'failed');
    assert.equal(task.takeover.attempts, 1);
    assert.equal(task.coordination.timeline.at(-1).reason, 'TAKEOVER_ATTEMPT_LIMIT');
    assert.equal(run.target.requests.length, 1);
    assert.equal(run.main.requests.length, 3);
    assert.equal(run.advisor.requests.length, 1);
    assert.equal(task.calls.length, 5);
    assert.equal(task.ledger.tokens.total, 60);
  } finally { await cleanup(home, run); }
});

for (const scenario of [
  { name: 'unknown capacity', targetOptions: { capacity: null }, reason: 'TAKEOVER_CONTEXT_CAPACITY_UNKNOWN' },
  { name: 'insufficient full-history capacity', targetOptions: { capacity: 1024 }, reason: 'TAKEOVER_CONTEXT_CAPACITY_EXCEEDED' },
  { name: 'unknown handoff declaration', targetOptions: { handoffFact: null }, reason: 'TAKEOVER_PROTOCOL_UNKNOWN' },
  { name: 'unsupported tool protocol including native built-in schemas', targetOptions: { handoffFact: { ...handoff, toolProtocol: 'unsupported' } }, reason: 'TAKEOVER_TOOL_PROTOCOL_UNSUPPORTED' },
  { name: 'fixed-model grant missing', policy: { allowFixedModel: false }, reason: 'FIXED_MODEL_TAKEOVER_NOT_AUTHORIZED' },
  { name: 'cross-model grant missing', policy: { allowCrossModel: false }, reason: 'TAKEOVER_CROSS_MODEL_NOT_AUTHORIZED' },
]) test(`a complete native Task refuses ${scenario.name} before target dispatch and preserves its current response owner`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-incompatible-'));
  let run;
  try {
    run = await prepare(home, scenario);
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.state, 'refused');
    assert.equal(task.takeover.plan.reason, scenario.reason);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.executionOwner.confidence, 'response-observed');
    if (scenario.policy || scenario.targetOptions.handoffFact === null) {
      assert.equal(task.takeover.plan.target, null);
      assert.equal(task.plannedSelection, null);
    }
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.calls.length, 4);
    assert.equal(task.ledger.tokens.total, 48);
    assert.equal((await run.ctx.router.snapshot()).tasks.length, 1);
  } finally { await cleanup(home, run); }
});

for (const enabled of [false, true]) test(`without ${enabled ? 'new trusted evidence' : 'takeover authorization'} there is no new target call`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-no-trigger-'));
  let run;
  try {
    run = await prepare(home, { policy: { enabled } });
    if (enabled) run.main.afterAdviceLength = 6;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.takeover, null);
    assert.equal(run.target.requests.length, 0);
    if (enabled) assert.equal(task.executionOwner.identity.provider, 't17-main');
    else {
      assert.equal(task.executionOwner, null);
      assert.equal(task.calls.at(-1).selection.provider, 't17-main');
    }
    assert.equal(task.calls.length, 4);
    assert.equal(task.ledger.tokens.total, 48);
  } finally { await cleanup(home, run); }
});

for (const sameAdapter of [false, true]) test(`private replay is rejected even for ${sameAdapter ? 'different models sharing one adapter' : 'a different adapter'} without copying its opaque payload`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-private-replay-'));
  let run;
  try {
    run = await prepare(home, { targetOptions: { model: 'other-model' } });
    run.main.replayState = { response: { privateMarker: 'PROVIDER_PRIVATE_MUST_NOT_REPLAY' } };
    if (sameAdapter) run.registrations[2].adapterHandle.replace(['t17-target'], run.main);
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_PRIVATE_REPLAY_UNSUPPORTED');
    assert.equal(run.target.requests.length, 0);
    assert.equal(run.main.requests.some(request => request.provider === 't17-target'), false);
    assert.equal(JSON.stringify(task.takeover).includes('PROVIDER_PRIVATE_MUST_NOT_REPLAY'), false);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.calls.length, 4);
  } finally { await cleanup(home, run); }
});

test('a takeover notice delivered without acknowledgement is durable unknown and pauses before any further execution', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-steer-unknown-'));
  let run;
  try {
    run = await prepare(home);
    const agent = run.ctx.agents.get(run.sessionId), steer = agent.steer.bind(agent);
    agent.steer = async message => {
      await steer(message);
      if (message.source?.kind === 'router-takeover') throw new LlmError('Controlled notice acknowledgement lost', 'TAKEOVER_NOTICE_ACK_UNKNOWN');
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.takeover.plan.state, 'delivery-unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_NOTICE_ACK_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(run.target.requests.length, 0);
    assert.equal(run.main.requests.length, 3);
    assert.equal(task.calls.length, 4);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.acceptance.verdict, 'failed');
  } finally { await cleanup(home, run); }
});

test('re-registering a completed write as a read with identical name and schema during Session observation invalidates its semantic binding', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-tool-owner-race-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run, { effect: 'side-effect' });
    run.target.repeatTool = run.main.toolName;
    run.target.repeatArgs = run.main.toolArgs;
    const observe = run.ctx.sessionQuery.observeSession.bind(run.ctx.sessionQuery);
    let changed = false;
    run.ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      if (!changed) {
        changed = true;
        run.disposeTool();
        run.ctx.tools.register({ ...run.toolDefinition, routerOperation: { ...run.toolDefinition.routerOperation, effect: 'read', idempotencyKey: null }, async execute(args) { calls.push(args); return 'CHANGED_TOOL_BODY'; } });
      }
      return lease;
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(changed, true);
    assert.equal(run.target.requests.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_SEMANTICS_CHANGED');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.toolReceipts[0].operation.effect, 'side-effect');
    assert.equal(task.acceptance.verdict, 'failed');
  } finally { await cleanup(home, run); }
});

test('an unknown completed tool outcome pauses takeover without rerunning or hiding the recorded operation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-tool-outcome-unknown-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run, { effect: 'side-effect', fail: true });
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(calls.length, 1);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.toolReceipts[0].outcome, 'unknown');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
  } finally { await cleanup(home, run); }
});

test('revoking the waiting target wakes and cancels its native reservation without any budget extension', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-revoke-wake-'));
  let run, pending;
  try {
    run = await prepare(home, { tokens: 5000 });
    pending = submit(run.ctx, run.sessionId, prompt);
    await waitFor(run.ctx, task => task?.lifecycle === 'waiting-budget' && task.takeover?.plan.state === 'prepared');
    await run.ctx.router.setModelEnabled(run.registrations[2].candidate.candidateId, false);
    const task = await waitFor(run.ctx, task => task?.lifecycle === 'paused');
    await pending;
    assert.equal(task.takeover.plan.state, 'refused');
    assert.equal(task.takeover.plan.reason, 'MODEL_DISABLED');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(task.budget.extensions.length, 0);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.ledger.tokens.total, 48);
  } finally {
    if (pending) { const active = (await run.ctx.router.snapshot()).tasks.at(-1); if (['running', 'waiting-budget'].includes(active.lifecycle)) await run.ctx.router.stopTask(active.id); await pending; }
    await cleanup(home, run);
  }
});

for (const scenario of [
  { name: 'unknown image capability', targetOptions: { image: null }, reason: 'TAKEOVER_IMAGE_CAPABILITY_UNKNOWN' },
  { name: 'negative image capability', targetOptions: { image: false }, reason: 'TAKEOVER_IMAGE_CAPABILITY_UNSUPPORTED' },
  { name: 'declared image support with a text-only bound model', configure: run => { run.target.modalities = ['text']; }, reason: 'TAKEOVER_IMAGE_CAPABILITY_UNSUPPORTED' },
  { name: 'missing image price', configure: run => { run.target.pricing = 'unknown'; }, reason: 'TAKEOVER_IMAGE_FORECAST_UNKNOWN' },
]) test(`the full image Task refuses ${scenario.name} while retaining its original attachment`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-image-refusal-'));
  let run;
  try {
    run = await prepare(home, { images: true, nativeOptions: { images: true }, targetOptions: scenario.targetOptions });
    scenario.configure?.(run);
    const task = await submitImage(run);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, scenario.reason);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    const image = task.takeover.plan.portableHistory.images[0].attachment;
    const original = await run.ctx.attachments.readImage(image);
    assert.equal(createHash('sha256').update(original.data).digest('hex'), 'e68bb6828d842a6c845223b2966aef7c28134491c003f940020e17ee8b06391d');
    assert.equal(task.acceptance.verdict, 'failed');
  } finally { await cleanup(home, run); }
});

test('a response observed before target failure confirms only the response owner, keeping the result and usage unconfirmed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-partial-response-'));
  let run;
  try {
    run = await prepare(home);
    run.target.failAfterResponse = true;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.state, 'interrupted');
    assert.equal(task.executionOwner.confidence, 'response-observed');
    assert.equal(task.executionOwner.identity.provider, 't17-target');
    assert.equal(task.takeover.plan.acceptanceVerdict, null);
    assert.equal(task.acceptance.revision, 3);
    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.calls.at(-1).usage, null);
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(run.target.requests.length, 1);
  } finally { await cleanup(home, run); }
});

for (const change of ['permission', 'connection', 'stop']) test(`the final native request's async observation rechecks ${change} before dispatch and releases the original reservation`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-final-await-race-'));
  let run;
  try {
    run = await prepare(home);
    const observe = run.ctx.sessionQuery.observeSession.bind(run.ctx.sessionQuery);
    let observations = 0;
    run.ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      if (++observations === 3) {
        if (change === 'permission') await run.ctx.router.setAutomatic(false);
        else if (change === 'connection') { const target = run.registrations[2]; target.dispose(); target.dispose = run.ctx.router.registerOwned({ ...target.source, configRevision: 2 }); }
        else await run.ctx.router.stopTask((await run.ctx.router.snapshot()).tasks.at(-1).id);
      }
      return lease;
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(observations, 3);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(task.takeover.plan.reason, change === 'permission' ? 'TAKEOVER_POLICY_CHANGED' : change === 'connection' ? 'TAKEOVER_CANDIDATE_CHANGED' : 'TAKEOVER_CANCELED');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.ledger.tokens.total, 48);
  } finally { await cleanup(home, run); }
});

test('a public surface replacement cannot be silently compressed into a handoff summary', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-history-replaced-'));
  let run;
  try {
    run = await prepare(home);
    const observe = run.ctx.sessionQuery.observeSession.bind(run.ctx.sessionQuery);
    let replaced = false;
    run.ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      if (replaced) return lease;
      replaced = true;
      const original = lease.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user');
      lease[Symbol.dispose]();
      run.ctx.agents.get(id).session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'LOSSY_SUMMARY' }], source: { kind: 't17-controlled-replacement' } }), { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] });
      return observe(id, options);
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(replaced, true);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_HISTORY_PROJECTED');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(JSON.stringify(task.takeover).includes('LOSSY_SUMMARY'), false);
  } finally { await cleanup(home, run); }
});

test('a completed callId cannot be reused by the target even for a read operation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-call-id-repeat-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run);
    run.target.repeatTool = run.main.toolName;
    run.target.repeatCallId = 'completed-call-1';
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(calls.length, 1);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_DUPLICATE_TOOL_CALL');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.toolReceipts[0].outcome, 'completed');
    assert.equal(run.target.requests.length, 1);
  } finally { await cleanup(home, run); }
});

test('an unrelated registry addition does not invalidate a completed operation binding or drop historical tool declarations', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-unrelated-tool-'));
  let run;
  try {
    run = await prepare(home);
    const calls = registerTool(run);
    const observe = run.ctx.sessionQuery.observeSession.bind(run.ctx.sessionQuery);
    let added = false;
    run.ctx.sessionQuery.observeSession = async (id, options) => {
      const lease = await observe(id, options);
      if (!added) { added = true; run.ctx.tools.register({ ...run.toolDefinition, name: 't17_unrelated_tool' }); }
      return lease;
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(run.target.requests.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(run.target.requests[0].tools.some(tool => tool.name === 't17_unrelated_tool'), true);
    assert.equal(task.takeover.plan.finalRequest.messages.some(message => message.content.some(part => part.type === 'tool-addition' && part.toolName === 't17_unrelated_tool')), true);
  } finally { await cleanup(home, run); }
});

test('native manual selection during budget wait cancels takeover and preserves that pending user choice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-native-selection-'));
  let run, pending;
  try {
    run = await prepare(home, { tokens: 5000 });
    pending = submit(run.ctx, run.sessionId, prompt);
    const waiting = await waitFor(run.ctx, task => task?.lifecycle === 'waiting-budget' && task.takeover?.plan.state === 'prepared');
    await run.ctx.sessionController.selectModel({ sessionId: run.sessionId, provider: 't17-advisor', model: 'model' });
    const task = await pending;
    assert.equal(task.id, waiting.id);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.reason, 'NATIVE_SELECTION_CHANGED');
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(run.ctx.sessionProjections.stateOf(run.ctx.agents.get(run.sessionId).session, 'modelSelection').pending.provider, 't17-advisor');
  } finally {
    if (pending) { const active = (await run.ctx.router.snapshot()).tasks.at(-1); if (['running', 'waiting-budget'].includes(active.lifecycle)) await run.ctx.router.stopTask(active.id); await pending; }
    await cleanup(home, run);
  }
});

test('human steering during budget wait takes precedence without silently consuming or replacing the original Task inputs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-human-steer-'));
  let run, pending;
  try {
    run = await prepare(home, { tokens: 5000 });
    pending = submit(run.ctx, run.sessionId, prompt);
    const waiting = await waitFor(run.ctx, task => task?.lifecycle === 'waiting-budget' && task.takeover?.plan.state === 'prepared');
    const user = createUserMessage({ content: [{ type: 'text', text: 'Please follow this new user instruction.' }], source: { kind: 'user' } });
    await run.ctx.agents.get(run.sessionId).steer(user);
    await pending;
    const snapshot = await run.ctx.router.snapshot(), task = snapshot.tasks.find(item => item.id === waiting.id);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.reason, 'HUMAN_INPUT_PENDING');
    assert.deepEqual(task.inputs, waiting.inputs);
    assert.equal(task.calls.at(-1).status, 'not-dispatched');
    assert.equal(task.calls.at(-1).reservation.state, 'released');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(run.ctx.agents.get(run.sessionId).inbox.nextStep.some(message => message.id === user.id), true);
    assert.equal(snapshot.tasks.length, 1);
  } finally {
    if (pending) { const active = (await run.ctx.router.snapshot()).tasks.at(-1); if (['running', 'waiting-budget'].includes(active.lifecycle)) await run.ctx.router.stopTask(active.id); await pending; }
    await cleanup(home, run);
  }
});

test('target revocation during the public attachment read cancels the image plan before reserving or dispatching a target call', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-image-read-race-'));
  let run;
  try {
    run = await prepare(home, { images: true, nativeOptions: { images: true } });
    const read = run.ctx.attachments.readImage.bind(run.ctx.attachments);
    let revoked = false;
    run.ctx.attachments.readImage = async (ref, signal) => {
      const image = await read(ref, signal);
      const task = (await run.ctx.router.snapshot()).tasks.at(-1);
      if (!revoked && task?.takeover?.plan.state === 'notice-delivered') { revoked = true; await run.ctx.router.setModelEnabled(run.registrations[2].candidate.candidateId, false); }
      return image;
    };
    const task = await submitImage(run);
    assert.equal(revoked, true);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_CANDIDATE_CHANGED');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.calls.some(call => call.selection.provider === 't17-target'), false);
  } finally { await cleanup(home, run); }
});

test('native retry policy cannot automatically repeat a takeover with possible dispatch and unknown usage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-native-retry-'));
  let run;
  try {
    run = await prepare(home, { nativeOptions: { beforeRouter: async ctx => ctx.plugin(LlmRetry) } });
    run.target.failBeforeResponse = true;
    run.target.providerRetryPolicy = () => resolveRetryPolicy({ mode: 'normal', maxRetries: 1, retryableCodes: ['NETWORK_ERROR'], backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, 't17-controlled-retry');
    run.registrations[2].adapterHandle.replace(['t17-target'], run.target);
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(run.target.requests.length, 1);
    assert.equal(task.calls.length, 5);
    assert.equal(task.takeover.plan.state, 'dispatch-unknown');
    assert.equal(task.executionOwner.confidence, 'possible');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.ledger.tokens.total, null);
    assert.equal(task.calls.at(-1).usage, null);
  } finally { await cleanup(home, run); }
});

test('a completed composite tool does not hide an unknown nested operation outcome from the same Task takeover', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-nested-unknown-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_nested_unknown', description: 'Controlled nested operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; throw new Error('Controlled nested outcome unknown'); },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_nested_unknown', arguments: {}, agent: exec.agent, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 1);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_nested_unknown').outcome, 'unknown');
    assert.equal(task.toolReceipts.find(item => item.callId === 'completed-call-1').outcome, 'completed');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a completed nested tool receipt is refused when its full protocol cannot be represented in the flat portable history', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-nested-protocol-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    run.ctx.tools.register({ name: 't17_nested_complete', description: 'Controlled nested completed operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'NESTED_ORIGINAL_RECEIPT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_nested_complete', arguments: {}, agent: exec.agent, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.toolReceipts.length, 2);
    assert.equal(task.toolReceipts.every(item => item.outcome === 'completed'), true);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
  } finally { await cleanup(home, run); }
});

test('an outer completed receipt cannot transfer a Task while a public nested operation is still unsettled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-nested-pending-'));
  let run, releaseNested, nested;
  const pending = new Promise(resolve => { releaseNested = resolve; });
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  try {
    run = await prepare(home);
    registerTool(run);
    run.ctx.tools.register({ name: 't17_nested_pending', description: 'Controlled pending nested operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { notifyStarted(); await pending; return 'NESTED_LATE_RECEIPT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      nested = run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_nested_pending', arguments: {}, agent: exec.agent, parent: exec.token, signal: exec.signal });
      await started;
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.toolReceipts.length, 1);
    assert.equal(task.toolReceipts[0].outcome, 'completed');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
  } finally { releaseNested(); await nested; await cleanup(home, run); }
});

test('log-only public PTC records cannot disappear from a handoff because the flat canonical messages still match', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-ptc-log-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    run.toolDefinition.execute = async (_args, exec) => {
      const data = { rootCallId: exec.rootCallId, parentCallId: exec.callId, subCallId: exec.callId + ':ptc:1', name: 't17_logged_child', arguments: {} };
      exec.agent.session.append('tool/ptc-dispatch-start', data);
      exec.agent.session.append('tool/ptc-dispatch', { ...data, isError: false, content: [{ type: 'text', text: 'PTC_ORIGINAL_CHILD' }] });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.toolReceipts.length, 1);
    assert.equal(task.toolReceipts[0].outcome, 'completed');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
  } finally { await cleanup(home, run); }
});

test('a target outer tool grant does not authorize a nested child body under the flat handoff protocol', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-target-nested-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_target_nested', description: 'Controlled target child', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'CHILD_BODY_EXECUTED'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      if (exec.callId === 'new-target-call') await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_target_nested', arguments: {}, agent: exec.agent, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    run.target.repeatTool = run.main.toolName;
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 1);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_HISTORY_UNSUPPORTED');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.toolReceipts.find(item => item.name === 't17_target_nested').outcome, 'unknown');
  } finally { await cleanup(home, run); }
});

test('a tool body resolved after an async wrapper cannot retain the old operation proof when its definition changed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-body-generation-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let replacementBodies = 0;
    run.ctx.on('tools/execute', async (exec, next) => {
      if (exec.callId === 'completed-call-1') {
        await Promise.resolve();
        run.disposeTool();
        run.ctx.tools.register({ ...run.toolDefinition, async execute() { replacementBodies++; return 'REPLACEMENT_BODY_RESULT'; } });
      }
      return next();
    }, { prepend: true });
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(replacementBodies, 1);
    assert.equal(task.toolReceipts[0].outcome, 'unknown');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
  } finally { await cleanup(home, run); }
});

test('an enabled takeover Task can pass a trusted Node behavior check without Router owner writes changing its workspace scope', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-enabled-program-check-'));
  let run;
  try {
    await mkdir(join(home, 'src')); await mkdir(join(home, 'test'));
    await writeFile(join(home, 'src/add.mjs'), 'export const add = (left, right) => left + right;\n');
    await writeFile(join(home, 'test/add.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('adds', () => assert.equal(add(1, 2), 3));\n");
    run = await prepare(home);
    const task = await submit(run.ctx, run.sessionId, 'Keep the original implementation. 仅检查以下明确要求：编程行为「加法返回3」由可信检查「node-test」验证，工作区产物「src/add.mjs」。');
    assert.equal(task.acceptance.verdict, 'passed', JSON.stringify(task.acceptance.evidence));
    assert.equal(task.acceptance.evidence[0].source.execution.commandId, 'node-test-workspace-v1');
    assert.equal(task.acceptance.evidence[0].source.execution.exitCode, 0);
    assert.equal(task.takeoverPolicy.enabled, true);
    assert.equal(task.takeover, null);
    assert.equal(task.toolReceipts, undefined);
    assert.equal(task.executionOwner.identity.provider, 't17-main');
    assert.equal(task.executionOwner.confidence, 'response-observed');
    assert.equal(task.calls.length, 1);
    assert.equal((await run.ctx.router.snapshot()).tasks.length, 1);
  } finally { await cleanup(home, run); }
});

test('a child omitting its agent cannot escape the observed native tree or inherit the outer Task permission', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-missing-agent-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_unscoped_child', description: 'Controlled child missing its agent scope', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'UNSCOPED_CHILD_RESULT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_unscoped_child', arguments: {}, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_unscoped_child').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a child with a conflicting root cannot disappear from its observed parent Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-conflicting-root-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_conflicting_root', description: 'Controlled child with an invalid root', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'CONFLICTING_ROOT_RESULT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: 'unrelated-native-root', name: 't17_conflicting_root', arguments: {}, agent: exec.agent, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_conflicting_root').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('an unscoped child using an unobserved parent token does not inherit permission from a matching native root', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-unobserved-parent-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    run.ctx.tools.register({ name: 't17_unobserved_parent', description: 'Controlled child with an unrelated real parent token', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'UNOBSERVED_PARENT_RESULT'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-host-call', name: 't17_host_token', arguments: {}, signal: new AbortController().signal });
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_unobserved_parent', arguments: {}, parent: unrelatedToken, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.some(item => item.name === 't17_host_token'), false);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_unobserved_parent').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('an unscoped child with an ambiguous root pauses every possible native parent instead of escaping both Tasks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-ambiguous-root-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, nestedBodies = 0, roots = 0;
    const bothRoots = Promise.withResolvers(), childSettled = Promise.withResolvers();
    run.ctx.tools.register({ name: 't17_ambiguous_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    run.ctx.tools.register({ name: 't17_ambiguous_child', description: 'Controlled child claiming a shared native root', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'AMBIGUOUS_CHILD_RESULT'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-host-call', name: 't17_ambiguous_host_token', arguments: {}, signal: new AbortController().signal });
    run.toolDefinition.execute = async (_args, exec) => {
      const first = ++roots === 1;
      if (first) {
        await bothRoots.promise;
        try { await run.ctx.tools.execute({ callId: 'ambiguous-child', rootCallId: exec.rootCallId, name: 't17_ambiguous_child', arguments: {}, parent: unrelatedToken, signal: exec.signal }); }
        finally { childSettled.resolve(); }
      } else { bothRoots.resolve(); await childSettled.promise; }
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const { sessionId: secondSessionId } = await run.ctx.sessionController.create({ cwd: home });
    await Promise.all([submit(run.ctx, run.sessionId, prompt), submit(run.ctx, secondSessionId, prompt)]);
    const tasks = (await run.ctx.router.snapshot()).tasks;
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 0);
    assert.equal(tasks.length, 2);
    for (const task of tasks) {
      assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
      assert.equal(task.lifecycle, 'paused');
    }
  } finally { await cleanup(home, run); }
});

test('a missing-tool child result without an agent remains unknown evidence in its observed parent Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-missing-definition-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let childResult;
    run.toolDefinition.execute = async (_args, exec) => {
      childResult = await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_not_registered', arguments: {}, parent: exec.token, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(childResult.isError, true);
    assert.equal(childResult.error.info.code, 'UNKNOWN_TOOL');
    assert.equal(run.target.requests.length, 0);
    const receipt = task.toolReceipts.find(item => item.name === 't17_not_registered');
    assert.equal(receipt.outcome, 'unknown');
    assert.equal(receipt.failureCode, 'UNKNOWN_TOOL');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('an unrelated agent claim cannot hide an unobserved-parent child from its matching native Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-conflicting-agent-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_other_scope_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    run.ctx.tools.register({ name: 't17_other_scope_child', description: 'Controlled child with an unrelated agent claim', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'UNRELATED_AGENT_CHILD_RESULT'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-host-call', name: 't17_other_scope_token', arguments: {}, signal: new AbortController().signal });
    const { sessionId: otherSessionId } = await run.ctx.sessionController.create({ cwd: home });
    const otherAgent = run.ctx.agents.get(otherSessionId);
    run.toolDefinition.execute = async (_args, exec) => {
      await run.ctx.tools.execute({ callId: exec.callId + ':nested:1', rootCallId: exec.rootCallId, name: 't17_other_scope_child', arguments: {}, agent: otherAgent, parent: unrelatedToken, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_other_scope_child').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal((await run.ctx.router.snapshot()).tasks.length, 1);
  } finally { await cleanup(home, run); }
});

test('a child using its completed parent token during target preparation cannot execute or vanish from the original Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-completed-parent-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let lateInput, lateResult, nestedBodies = 0;
    run.ctx.tools.register({ name: 't17_late_child', description: 'Controlled late child of a completed native tool', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'LATE_CHILD_RESULT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      lateInput = { callId: exec.callId + ':late-child', rootCallId: exec.rootCallId, name: 't17_late_child', arguments: {}, parent: exec.token, signal: exec.signal };
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const resolveModel = run.target.resolveModel.bind(run.target);
    run.target.resolveModel = async (provider, model) => {
      if (lateInput && !lateResult) lateResult = await run.ctx.tools.execute(lateInput);
      return resolveModel(provider, model);
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(nestedBodies, 0);
    assert.equal(lateResult.isError, true);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_late_child').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a late child receipt stays with its original Task after the same Session begins a separate turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-original-turn-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let lateInput, lateResult;
    run.ctx.tools.register({ name: 't17_previous_turn_child', description: 'Controlled child from an earlier native Task', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'PREVIOUS_TURN_CHILD_RESULT'; },
    });
    run.toolDefinition.execute = async (_args, exec) => {
      lateInput = { callId: exec.callId + ':previous-turn-child', rootCallId: exec.rootCallId, name: 't17_previous_turn_child', arguments: {}, parent: exec.token, signal: exec.signal };
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const original = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(original.acceptance.verdict, 'passed');
    await run.ctx.router.setTakeoverPolicy({ ...policy, candidateId: run.registrations[2].candidate.candidateId, enabled: false });
    run.main.beforeResponse = async () => { if (!lateResult) lateResult = await run.ctx.tools.execute(lateInput); };
    const second = await submit(run.ctx, run.sessionId, 'A separate independent request with no declared requirement.');
    const tasks = (await run.ctx.router.snapshot()).tasks;
    assert.equal(tasks.length, 2);
    const preserved = tasks.find(task => task.id === original.id);
    assert.equal(preserved.toolReceipts.some(item => item.name === 't17_previous_turn_child'), true);
    assert.equal(second.toolReceipts?.some(item => item.name === 't17_previous_turn_child') ?? false, false);
    assert.equal(second.takeoverPolicy.enabled, false);
    assert.equal(second.executionOwner, null);
    assert.equal(second.turn, original.turn + 1);
  } finally { await cleanup(home, run); }
});

test('a missing definition with an unobserved parent and omitted agent cannot lose its matching native Task evidence', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-combined-unknown-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, childResult;
    run.ctx.tools.register({ name: 't17_combined_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-combined-host-call', name: 't17_combined_host_token', arguments: {}, signal: new AbortController().signal });
    run.toolDefinition.execute = async (_args, exec) => {
      childResult = await run.ctx.tools.execute({ callId: exec.callId + ':combined-child', rootCallId: exec.rootCallId, name: 't17_combined_not_registered', arguments: {}, parent: unrelatedToken, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(childResult.isError, true);
    assert.equal(childResult.error.info.code, 'UNKNOWN_TOOL');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.some(item => item.name === 't17_combined_host_token'), false);
    const receipt = task.toolReceipts.find(item => item.name === 't17_combined_not_registered');
    assert.equal(receipt.outcome, 'unknown');
    assert.equal(receipt.failureCode, 'UNKNOWN_TOOL');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a missing definition child waiting in a public execute wrapper remains unsettled before its result', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-missing-pending-'));
  let run, nested, releaseNested, notifyStarted;
  const pending = new Promise(resolve => { releaseNested = resolve; });
  const started = new Promise(resolve => { notifyStarted = resolve; });
  try {
    run = await prepare(home);
    registerTool(run);
    run.ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 't17_missing_pending_definition') { notifyStarted(); await pending; }
      return next();
    }, { prepend: true });
    run.toolDefinition.execute = async (_args, exec) => {
      nested = run.ctx.tools.execute({ callId: exec.callId + ':missing-pending-child', rootCallId: exec.rootCallId, name: 't17_missing_pending_definition', arguments: {}, parent: exec.token, signal: exec.signal });
      await started;
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(task.toolReceipts.length, 1);
    assert.equal(task.toolReceipts[0].outcome, 'completed');
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.executionOwner.identity.provider, 't17-main');
  } finally { releaseNested(); await nested; await cleanup(home, run); }
});

test('an early tool preparation error without pre-execute retains a matching native Task owner', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-early-error-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, childResult, childPreExecutions = 0;
    run.ctx.tools.register({ name: 't17_early_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-early-host-call', name: 't17_early_host_token', arguments: {}, signal: new AbortController().signal });
    run.ctx.on('tools/pre-execute', (exec, next) => { if (exec.name === 't17_early_not_registered') childPreExecutions++; return next(); });
    run.toolDefinition.execute = async (_args, exec) => {
      childResult = await run.ctx.tools.execute({ callId: exec.callId + ':early-child', rootCallId: exec.rootCallId, name: 't17_early_not_registered', arguments: undefined, parent: unrelatedToken, signal: exec.signal });
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(childPreExecutions, 0);
    assert.equal(childResult.isError, true);
    assert.match(childResult.error.message, /losslessly JSON-serializable/);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.some(item => item.name === 't17_early_host_token'), false);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_early_not_registered').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a late early tool error with an unobserved parent retains the completed native root Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-late-early-error-'));
  let run;
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, lateInput, lateResult, childPreExecutions = 0, outerCompleted = false;
    run.ctx.tools.register({ name: 't17_late_early_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-late-early-host-call', name: 't17_late_early_host_token', arguments: {}, signal: new AbortController().signal });
    run.ctx.on('tools/pre-execute', (exec, next) => { if (exec.name === 't17_late_early_not_registered') childPreExecutions++; return next(); });
    run.toolDefinition.execute = async (_args, exec) => {
      lateInput = { callId: exec.callId + ':late-early-child', rootCallId: exec.rootCallId, name: 't17_late_early_not_registered', arguments: undefined, parent: unrelatedToken, signal: exec.signal };
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const resolveModel = run.target.resolveModel.bind(run.target);
    run.target.resolveModel = async (provider, model) => {
      if (lateInput && !lateResult) {
        outerCompleted = (await run.ctx.router.snapshot()).tasks.at(-1).toolReceipts.some(receipt => receipt.callId === 'completed-call-1' && receipt.outcome === 'completed');
        lateResult = await run.ctx.tools.execute(lateInput);
      }
      return resolveModel(provider, model);
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(outerCompleted, true);
    assert.equal(childPreExecutions, 0);
    assert.equal(lateResult.isError, true);
    assert.match(lateResult.error.message, /losslessly JSON-serializable/);
    assert.equal(run.target.requests.length, 0);
    assert.equal(task.toolReceipts.some(item => item.name === 't17_late_early_host_token'), false);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_late_early_not_registered').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { await cleanup(home, run); }
});

test('a late registered child cannot execute or hide its pending result under a completed native root', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t17-child-late-registered-pending-'));
  let run, nested, releaseNested, notifyStarted;
  const pending = new Promise(resolve => { releaseNested = resolve; });
  const started = new Promise(resolve => { notifyStarted = resolve; });
  try {
    run = await prepare(home);
    registerTool(run);
    let unrelatedToken, lateInput, lateResult, nestedBodies = 0, wrapperWaiting = false, outerCompleted = false;
    run.ctx.tools.register({ name: 't17_late_pending_host_token', description: 'Independent Host operation', parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) { unrelatedToken = exec.token; return 'HOST_TOKEN_CREATED'; },
    });
    run.ctx.tools.register({ name: 't17_late_registered_pending', description: 'Controlled late child with delayed result', parameters: { type: 'object', properties: {}, additionalProperties: false },
      routerOperation: { version: 1, effect: 'read', idempotencyKey: null, source: 't17-nested-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { nestedBodies++; return 'LATE_CHILD_BODY_RESULT'; },
    });
    await run.ctx.tools.execute({ callId: 'independent-late-pending-host-call', name: 't17_late_pending_host_token', arguments: {}, signal: new AbortController().signal });
    run.ctx.on('tools/execute', async (exec, next) => {
      const result = await next();
      if (exec.name === 't17_late_registered_pending') { wrapperWaiting = true; notifyStarted(); await pending; }
      return result;
    }, { prepend: true });
    run.toolDefinition.execute = async (_args, exec) => {
      lateInput = { callId: exec.callId + ':late-pending-child', rootCallId: exec.rootCallId, name: 't17_late_registered_pending', arguments: {}, parent: unrelatedToken, signal: exec.signal };
      return 'RECEIPT_COMPLETE:ORIGINAL_VALUE';
    };
    const resolveModel = run.target.resolveModel.bind(run.target);
    run.target.resolveModel = async (provider, model) => {
      if (lateInput && !nested) {
        outerCompleted = (await run.ctx.router.snapshot()).tasks.at(-1).toolReceipts.some(receipt => receipt.callId === 'completed-call-1' && receipt.outcome === 'completed');
        nested = run.ctx.tools.execute(lateInput);
        await Promise.race([started, nested.then(result => { lateResult = result; })]);
      }
      return resolveModel(provider, model);
    };
    const task = await submit(run.ctx, run.sessionId, prompt);
    assert.equal(outerCompleted, true);
    assert.equal(run.target.requests.length, 0, JSON.stringify({ targetRequests: run.target.requests.length, nestedBodies, wrapperWaiting }));
    assert.equal(nestedBodies, 0);
    assert.equal(wrapperWaiting, false);
    assert.equal(lateResult.isError, true);
    assert.equal(task.toolReceipts.some(item => item.name === 't17_late_pending_host_token'), false);
    assert.equal(task.toolReceipts.find(item => item.name === 't17_late_registered_pending').outcome, 'unknown');
    assert.equal(task.takeover.plan.reason, 'TAKEOVER_TOOL_OUTCOME_UNKNOWN');
    assert.equal(task.lifecycle, 'paused');
  } finally { releaseNested(); await nested; await cleanup(home, run); }
});
