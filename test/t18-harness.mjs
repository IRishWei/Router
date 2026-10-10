import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { startNative } from './t02-harness.mjs';

export const recoveryPolicy = { enabled: true, automatic: true, alternativeCandidateId: null, maxTokens: 128, forecastTokens: 32768 };
export const handoff = { protocol: 'dsh-canonical-v1', toolProtocol: 'function-json-schema-v1', confidence: 'declared', source: 't18-local-wire' };

/** Only the external model slot is substituted; Session, Task, LLM and tools are real rc.2. */
export class RecoveryFixture extends LlmAdapter {
  requests = [];
  failures = [];
  modalities = ['text'];
  async listModels(provider) { return [await this.resolveModel(provider, 'model')]; }
  async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: this.modalities, context: { contextWindow: 65536 }, systemPromptUpdate: 'in-history', toolUpdate: 'in-history' }; }
  imageRequestPricing() { return this.imagePricingUnknown ? undefined : { priceImages: images => images.map(() => ({ visualTokens: 64, text: '' })) }; }
  async *stream(request) {
    this.requests.push(request);
    if (this.beforeResponse) await this.beforeResponse(request);
    const failure = this.failures.shift();
    if (failure) {
      if (failure.partial) yield { type: 'text-delta', index: 0, text: 'PARTIAL_UNCONFIRMED' };
      if (failure.reasoningPartial) yield { type: 'reasoning-delta', index: 0, text: 'PARTIAL_REASONING_UNCONFIRMED' };
      if (failure.usage !== null) yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      throw new LlmError(failure.message ?? 'Local controlled failure', failure.code, failure.facts);
    }
    if (this.respond) { yield* this.respond(request); return; }
    yield { type: 'text-delta', index: 0, text: 'RECOVERED_LOCAL_RESULT' };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export async function register(ctx, provider, adapter, { connectionId = provider + '-connection', accountId = provider + '-account', billingPath = 't18-local-fixture', image = false, capacity = 65536, handoffFact = handoff, model = 'model' } = {}) {
  const adapterHandle = ctx.llm.registerAdapter([provider], adapter);
  const source = { provider, connectionId, accountId, billingPath, ownership: 'router-owned', source: 't18-controlled-native-task', sourceKey: provider + ':' + model, configRevision: 1, configured: true, authorizationStatus: 'configured', models: [{ model, name: provider, maxContextTokens: capacity, handoff: handoffFact, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: image, confidence: image === null ? 'unknown' : 'declared' }, tools: { supported: true, confidence: 'declared' } } }] };
  const dispose = ctx.router.registerOwned(source);
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider && item.identity.model === model);
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidate, source, dispose, adapterHandle };
}
export async function prepare(home, options = {}) {
  const ctx = await startNative(home, options.nativeOptions);
  const main = new RecoveryFixture();
  const nativeRequests = [];
  ctx.on('llm/stream', (request, next) => { if (isAgentLoopRequest(request)) nativeRequests.push(request); return next(); });
  const registration = await register(ctx, 't18-main', main, options.mainOptions);
  await ctx.router.setFixedModel(registration.candidate.candidateId);
  await ctx.router.setBudgetDefaults({ tokens: 262144, durationMs: 60000, money: [] });
  await ctx.router.setRecoveryPolicy({ ...recoveryPolicy, ...options.policy });
  const { sessionId } = await ctx.sessionController.create({});
  return { ctx, main, nativeRequests, registration, sessionId };
}
export async function submitTask(ctx, sessionId, text = 'Reply with a controlled local result.', content) {
  const requestId = randomUUID();
  await ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: content ?? [{ type: 'text', text }] }, new AbortController().signal);
  await ctx.agents.get(sessionId).whenIdle();
  const matches = (await ctx.router.snapshot()).tasks.filter(task => task.sessionId === sessionId && task.inputs.some(input => input.requestId === requestId));
  assert.equal(matches.length, 1, 'the public prompt owns exactly one Task');
  return matches[0];
}
export function assertAccounted(task, fixtures) {
  const requests = fixtures.flatMap(fixture => fixture.requests);
  const calls = task.calls.filter(call => call.dispatchStarted);
  assert.equal(calls.length, requests.length, 'every observed model entry has one ledger Call');
  assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
  assert.ok(task.calls.every(call => ['settled', 'released'].includes(call.reservation.state)));
}
export async function waitForSnapshot(ctx, predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const snapshot = await ctx.router.snapshot();
    const value = predicate(snapshot);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('The public Router state did not reach the expected live seam');
}
export async function prepareCoordination(home, options = {}) {
  const fixture = await prepare(home, options);
  const advisor = new RecoveryFixture();
  const registration = await register(fixture.ctx, 't18-advisor', advisor);
  await fixture.ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
  await fixture.ctx.router.setCoordinationPolicy({ enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, allowFixedModel: true, maxTokens: 128, maxAdviceChars: 1024, forecastTokens: 4096 });
  fixture.main.respond = async function* (request) {
    const kinds = request.messages.map(message => message.source?.kind);
    const text = kinds.includes('router-consultation') ? 'A'.repeat(options.afterAdviceLength ?? 14) : kinds.includes('router-self-repair') ? 'A'.repeat(6) : 'A'.repeat(4);
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  return { ...fixture, advisor, advisorRegistration: registration };
}
export const coordinationPrompt = 'Keep the original constraint and all earlier work. 仅检查以下明确要求：正文长度为10至20个字符。';
