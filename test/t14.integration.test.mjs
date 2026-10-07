import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { AcceptanceCoordinator } from '../src/acceptance.mjs';
import { createHttpSourceEvidenceResolver } from '../src/research-acceptance.mjs';
import { startNative, submit } from './t02-harness.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

async function waitFor(ctx, predicate) {
  const until = Date.now() + 3_000;
  while (Date.now() < until) {
    const snapshot = await ctx.router.snapshot();
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The research Task did not reach the expected boundary');
}

test('the sole stopping listener publishes before its awaited Host hook and consumes ignored message sequence state', async () => {
  const listeners = new Map();
  const order = [];
  let hooked;
  const task = { id: 't14-hook-task', calls: [], activeSelection: {}, configVersion: 1 };
  const ctx = {
    on: (name, listener) => { listeners.set(name, listener); },
    router: { exactTask: () => structuredClone(task) },
  };
  const coordinator = new AcceptanceCoordinator(ctx, {
    publishAcceptance: async (_taskId, acceptance) => { order.push('publish'); return acceptance; },
    afterAssessment: async payload => { order.push('after'); hooked = structuredClone(payload.acceptance); },
  });
  const agent = { session: { id: 't14-hook-session' }, inbox: { nextStep: [] } };
  listeners.get('session/event')(agent.session, { type: 'user/message', seq: 7, data: { id: 'reused-message-id' } });
  listeners.get('agent/inbox/claimed')({ agent, turn: 1, message: { id: 'reused-message-id', source: { kind: 'router-notice' }, content: [{ type: 'text', text: 'ignored producer message' }] } });
  listeners.get('agent/inbox/claimed')({ agent, turn: 1, message: { id: 'reused-message-id', source: { kind: 'user', rpcId: 'rpc-user' }, content: [{ type: 'text', text: '仅检查以下明确要求：正文必须包含「OK」。' }] } });
  listeners.get('session/event')(agent.session, { type: 'assistant/message', seq: 8, data: { turn: 1, step: 0, interrupted: false, message: { id: 'artifact', content: [{ type: 'text', text: 'OK' }] }, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }] } });
  await listeners.get('agent/turn-stopping')({ agent, turn: 1, signal: new AbortController().signal });

  assert.deepEqual(order, ['publish', 'after']);
  assert.deepEqual(hooked, coordinator.getResult(task.id));
  assert.equal(hooked.requirements[0].origin.seq, null);
  assert.equal(hooked.verdict, 'passed');
});

class ArtifactFixture extends LlmAdapter {
  #text;
  constructor(text) { super(); this.#text = text; }
  async *stream() {
    yield { type: 'text-delta', index: 0, text: this.#text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class SequencedArtifactFixture extends LlmAdapter {
  #texts;
  #index = 0;
  constructor(texts) { super(); this.#texts = texts; }
  async *stream() {
    const text = this.#texts[Math.min(this.#index++, this.#texts.length - 1)];
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class IncompleteArtifactFixture extends LlmAdapter {
  async *stream() {
    yield { type: 'text-delta', index: 0, text: 'Claim A. Claim B.' };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  }
}

class ResearchReviewFixture extends LlmAdapter {
  requests = [];
  #mode;
  constructor(mode = 'pass') { super(); this.#mode = mode; }
  async *stream(request) {
    this.requests.push(request);
    const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
    const sourceQuotes = input.sources.map(source => ({ sourceSnapshotId: source.id, quote: source.excerpts[0].text, quoteHash: source.excerpts[0].hash }));
    const verdict = this.#mode === 'conflict' && this.requests.length > 1 ? 'failed' : 'passed';
    const text = JSON.stringify({
      artifactHash: input.artifactHash,
      requirementHash: input.requirementHash,
      caseId: input.caseId,
      findings: input.requirementIds.map(requirementId => ({
        requirementId, verdict, artifactQuote: input.claims.at(-1).text,
        sourceQuotes: this.#mode === 'wrong-source-hash' ? sourceQuotes.map(item => ({ ...item, quoteHash: 'f'.repeat(64) })) : sourceQuotes,
        explanation: 'The cited excerpt directly states the bounded claim.',
        ...(this.#mode === 'extra-field' ? { overrideVerdict: 'passed' } : {}),
      })),
    });
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class CombinedReviewFixture extends LlmAdapter {
  requests = [];
  async *stream(request) {
    this.requests.push(request);
    const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
    const text = input.caseId ? JSON.stringify({
      artifactHash: input.artifactHash,
      requirementHash: input.requirementHash,
      caseId: input.caseId,
      findings: input.requirementIds.map(requirementId => ({
        requirementId, verdict: 'passed', artifactQuote: input.claims.at(-1).text,
        sourceQuotes: input.sources.map(source => ({ sourceSnapshotId: source.id, quote: source.excerpts[0].text, quoteHash: source.excerpts[0].hash })),
        explanation: 'The bounded excerpt supports the bound claim.',
      })),
    }) : JSON.stringify({
      artifactHash: input.artifact.hash,
      requirementHash: input.requirementHash,
      findings: input.requirements.map(requirement => ({ requirementId: requirement.id, verdict: 'passed', artifactQuote: input.artifact.text, explanation: 'The explicit rubric is covered.' })),
    });
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function registerCandidate(ctx, provider, model, name) {
  const dispose = ctx.router.registerOwned({
    provider, connectionId: `${provider}-connection`, accountId: `${provider}-account`, billingPath: 't14-controlled-fixture', ownership: 'router-owned',
    source: 't14-integration-registration', sourceKey: `${provider}:v1`, configRevision: 1, configured: true, authorizationStatus: 'configured',
    models: [{ model, name, maxContextTokens: 8192, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } } }],
  });
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider && item.identity.model === model);
  assert(candidate);
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidate, dispose };
}

test('a real Task artifact produces a validated research contribution without promoting source access', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Mars has Phobos and Deimos.');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sourceUrl = `http://127.0.0.1:${server.address().port}/mars`;
  const artifactText = `Mars has two moons.\n研究来源：论点「Mars has two moons」引用来源「${sourceUrl}」中的引文「Mars has Phobos and Deimos」。`;
  const home = await mkdtemp(join(tmpdir(), 'router-t14-integration-'));
  const resolveSourceEvidence = createHttpSourceEvidenceResolver({
    authorizeUrl: ({ url }) => url.origin === new URL(sourceUrl).origin,
    authorizeAddress: ({ address }) => address === '127.0.0.1',
  });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolveSourceEvidence) });
  const provider = 't14-artifact-fixture';
  ctx.llm.registerAdapter([provider], new ArtifactFixture(artifactText));
  const unregister = ctx.router.registerOwned({
    provider,
    connectionId: 't14-artifact-connection',
    accountId: 't14-artifact-account',
    billingPath: 't14-controlled-fixture',
    ownership: 'router-owned',
    source: 't14-integration-registration',
    sourceKey: 't14-integration-registration:v1',
    configRevision: 1,
    configured: true,
    authorizationStatus: 'configured',
    models: [{
      model: 'artifact', name: 'T14 controlled artifact fixture', maxContextTokens: 8192,
      capability: {
        text: { supported: true, confidence: 'declared' },
        image: { supported: false, confidence: 'declared' },
        tools: { supported: false, confidence: 'declared' },
      },
    }],
  });
  try {
    const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider);
    assert(candidate);
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const prompt = '请回答研究问题。\n仅检查以下研究要求：\n论点「Mars has two moons」必须有来源。';
    const task = await submit(ctx, sessionId, prompt);
    const hostAcceptance = task.acceptance;
    assert.equal(hostAcceptance.artifact.text, artifactText);
    assert.equal(hostAcceptance.artifact.sessionId, sessionId);
    assert.equal(hostAcceptance.artifact.turn, task.turn);
    const userEvent = ctx.sessions.get(sessionId).snapshotEvents().find(event => event.type === 'user/message' && event.data.id === task.inputs[0].messageId);
    assert(userEvent);

    const validated = hostAcceptance.research;
    assert.equal(validated.sourceSnapshots[0].access, 'available');
    assert.equal(validated.evidence.find(item => item.aspect === 'source-access').verdict, 'passed');
    assert.equal(validated.evidence.find(item => item.aspect === 'claim-support').verdict, 'unconfirmed');
    assert.equal(validated.reviewCases.length, 1);
    assert.equal(hostAcceptance.coverage.required, 1);
    assert.equal(hostAcceptance.coverage.covered, 0);
    assert.equal(hostAcceptance.verdict, 'unconfirmed');
    assert.equal(task.calls.length, 1);
    assert.deepEqual(ctx.router.exactTask(sessionId, task.turn).acceptance.research, validated);
  } finally {
    unregister();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('one bounded Task review can promote only decisive claim support from anonymous bound excerpts', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Mars has Phobos and Deimos.');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sourceUrl = `http://127.0.0.1:${server.address().port}/mars`;
  const artifactText = `Mars has two moons.\n研究来源：论点「Mars has two moons」引用来源「${sourceUrl}」中的引文「Mars has Phobos and Deimos」。`;
  const home = await mkdtemp(join(tmpdir(), 'router-t14-review-'));
  const resolveSourceEvidence = createHttpSourceEvidenceResolver({
    authorizeUrl: ({ url }) => url.origin === new URL(sourceUrl).origin,
    authorizeAddress: ({ address }) => address === '127.0.0.1',
  });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolveSourceEvidence) });
  const main = new ArtifactFixture(artifactText);
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-research-main'], main);
  ctx.llm.registerAdapter(['t14-research-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-research-main', 'artifact', 'Research artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-research-review', 'review', 'Research review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '请回答研究问题。\n仅检查以下研究要求：\n论点「Mars has two moons」必须有来源。');

    const support = task.acceptance.evidence.find(item => item.aspect === 'claim-support');
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.acceptance.coverage.covered, 1);
    assert.equal(support.verdict, 'passed');
    assert.equal(support.source.kind, 'research-review');
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review']);
    assert.equal(reviewer.requests.length, 1);
    assert.equal(isAgentLoopRequest(reviewer.requests[0]), false);
    const anonymous = reviewer.requests[0].messages.find(message => message.role === 'user').content[0].text;
    assert.doesNotMatch(anonymous, /https?:|candidate|provider|budget|permission/iu);
    assert.match(anonymous, /Mars has Phobos and Deimos/u);
    assert.equal(task.acceptance.research.evidence.find(item => item.aspect === 'claim-support').verdict, 'unconfirmed');
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('research review extra fields and forged quote hashes cannot establish support', async () => {
  for (const mode of ['extra-field', 'wrong-source-hash']) {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('support');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const artifactText = `Claim A.\n研究来源：论点「Claim A」引用来源「${origin}/fact」中的引文「support」。`;
    const home = await mkdtemp(join(tmpdir(), `router-t14-review-invalid-${mode}-`));
    const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
    const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
    const reviewer = new ResearchReviewFixture(mode);
    ctx.llm.registerAdapter([`t14-invalid-main-${mode}`], new ArtifactFixture(artifactText));
    ctx.llm.registerAdapter([`t14-invalid-review-${mode}`], reviewer);
    let mainRegistration;
    let reviewRegistration;
    try {
      mainRegistration = await registerCandidate(ctx, `t14-invalid-main-${mode}`, 'artifact', 'Invalid review artifact fixture');
      reviewRegistration = await registerCandidate(ctx, `t14-invalid-review-${mode}`, 'review', 'Invalid research review fixture');
      await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
      const { sessionId } = await ctx.sessionController.create({ cwd: home });
      const task = await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.acceptance.evidence.find(item => item.aspect === 'claim-support').reason, 'REVIEW_INVALID_OR_INCOMPLETE');
      assert.equal(task.calls.filter(call => call.purpose === 'review').length, 2);
      assert.equal(reviewer.requests.length, 2);
    } finally {
      reviewRegistration?.dispose();
      mainRegistration?.dispose();
      await ctx.fiber.dispose();
      server.close(); await once(server, 'close');
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
});

test('a high-risk source conflict uses the remaining second review and stays unconfirmed on disagreement', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(request.url === '/a' ? 'support a' : 'support b');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifactText = [
    'Claim A.',
    `研究来源：论点「Claim A」引用来源「${origin}/a」中的引文「support a」。`,
    `研究来源：论点「Claim A」引用来源「${origin}/b」中的引文「support b」。`,
  ].join('\n');
  const home = await mkdtemp(join(tmpdir(), 'router-t14-review-conflict-'));
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new ResearchReviewFixture('conflict');
  ctx.llm.registerAdapter(['t14-conflict-main'], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter(['t14-conflict-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-conflict-main', 'artifact', 'Conflict artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-conflict-review', 'review', 'Conflict review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」需要检查来源冲突。');
    const support = task.acceptance.evidence.find(item => item.aspect === 'claim-support');
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(support.reason, 'REVIEW_CONFLICT');
    assert.deepEqual(task.acceptance.reviews.map(item => item.findings[0].verdict), ['passed', 'failed']);
    assert.equal(task.calls.filter(call => call.purpose === 'review').length, 2);
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a bounded inference review binds the conclusion quote to the cited premise evidence', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('measured outcome improved');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifactText = `Measured outcome improved. Adopt the intervention.\n研究来源：论点「Measured outcome improved」引用来源「${origin}/study」中的引文「measured outcome improved」。`;
  const home = await mkdtemp(join(tmpdir(), 'router-t14-inference-'));
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-inference-main'], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter(['t14-inference-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-inference-main', 'artifact', 'Inference artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-inference-review', 'review', 'Inference review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, [
      '仅检查以下研究要求：',
      '论点「Measured outcome improved」必须有来源。',
      '推论「Adopt the intervention」必须由论点「Measured outcome improved」支持。',
    ].join('\n'));
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.acceptance.coverage.covered, 2);
    assert.equal(task.acceptance.reviews[1].findings[0].artifactQuote, 'Adopt the intervention');
    assert.equal(task.calls.filter(call => call.purpose === 'review').length, 2);
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a research payload outside the configured total forecast makes no review Call', async () => {
  const quote = 'x'.repeat(4_000);
  const sourceUrl = 'https://example.test/large';
  const artifactText = `Claim A.\n研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「${quote}」。`;
  const resolver = async () => ({ access: 'available', displayUrl: sourceUrl, urlHash: digest(sourceUrl), httpStatus: 200, contentType: 'text/plain', contentHash: digest(quote), body: quote });
  const home = await mkdtemp(join(tmpdir(), 'router-t14-review-forecast-'));
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-forecast-main'], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter(['t14-forecast-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-forecast-main', 'artifact', 'Forecast artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-forecast-review', 'review', 'Forecast review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(task.acceptance.reviews[0].reason, 'REVIEW_INPUT_FORECAST_EXCEEDED');
    assert.equal(task.calls.filter(call => call.purpose === 'review').length, 0);
    assert.equal(reviewer.requests.length, 0);
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a citation-only real Task fails without spending a semantic review Call', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('support');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sourceUrl = `http://127.0.0.1:${server.address().port}/fact`;
  const artifactText = `研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「support」。`;
  const home = await mkdtemp(join(tmpdir(), 'router-t14-citation-only-'));
  const resolveSourceEvidence = createHttpSourceEvidenceResolver({
    authorizeUrl: ({ url }) => url.origin === new URL(sourceUrl).origin,
    authorizeAddress: ({ address }) => address === '127.0.0.1',
  });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolveSourceEvidence) });
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-citation-main'], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter(['t14-citation-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-citation-main', 'artifact', 'Citation-only artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-citation-review', 'review', 'Citation-only review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');

    assert.equal(task.acceptance.verdict, 'failed');
    assert.equal(task.acceptance.evidence.find(item => item.aspect === 'artifact-claim').verdict, 'failed');
    assert.equal(task.acceptance.evidence.find(item => item.aspect === 'claim-support').reason, 'CLAIM_NOT_IN_ARTIFACT');
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution']);
    assert.equal(reviewer.requests.length, 0);
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('rubric and research reviews share the same two-Call Task limit', async () => {
  const server = createServer((request, response) => {
    const quote = request.url === '/a' ? 'support a' : 'support b';
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(quote);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifactText = [
    'Claim A. Claim B.',
    `研究来源：论点「Claim A」引用来源「${origin}/a」中的引文「support a」。`,
    `研究来源：论点「Claim B」引用来源「${origin}/b」中的引文「support b」。`,
  ].join('\n');
  const home = await mkdtemp(join(tmpdir(), 'router-t14-shared-review-cap-'));
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new CombinedReviewFixture();
  ctx.llm.registerAdapter(['t14-cap-main'], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter(['t14-cap-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-cap-main', 'artifact', 'Combined artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-cap-review', 'review', 'Combined review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, [
      '仅检查以下明确要求：',
      '评审标准：「正文说明明确研究结论」。',
      '仅检查以下研究要求：',
      '论点「Claim A」必须有来源。',
      '论点「Claim B」必须有来源。',
    ].join('\n'));

    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review', 'review']);
    assert.equal(reviewer.requests.length, 2);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(task.acceptance.coverage.required, 3);
    assert.equal(task.acceptance.coverage.covered, 2);
    const unreviewed = task.acceptance.evidence.filter(item => item.aspect === 'claim-support' && item.verdict === 'unconfirmed');
    assert.equal(unreviewed.length, 1);
    assert.equal(unreviewed[0].reason, 'REVIEW_ATTEMPT_LIMIT');
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

for (const action of ['extend', 'stop', 'revoke']) test(`a research review budget wait ${action === 'extend' ? 'continues the same Task' : action === 'stop' ? 'releases the unsent Call' : 'rechecks current candidate authorization'}`, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('support');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifactText = `Claim A.\n研究来源：论点「Claim A」引用来源「${origin}/fact」中的引文「support」。`;
  const home = await mkdtemp(join(tmpdir(), `router-t14-review-budget-${action}-`));
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter([`t14-budget-main-${action}`], new ArtifactFixture(artifactText));
  ctx.llm.registerAdapter([`t14-budget-review-${action}`], reviewer);
  let mainRegistration;
  let reviewRegistration;
  let run;
  let waitingTaskId;
  try {
    mainRegistration = await registerCandidate(ctx, `t14-budget-main-${action}`, 'artifact', 'Budget artifact fixture');
    reviewRegistration = await registerCandidate(ctx, `t14-budget-review-${action}`, 'review', 'Budget review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setBudgetDefaults({ tokens: 16, durationMs: null, money: [] });
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
    const waiting = (await waitFor(ctx, snapshot => snapshot.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    waitingTaskId = waiting.id;
    assert.equal(waiting.acceptance.phase, 'awaiting-review');
    assert.equal(waiting.acceptance.artifact.text, artifactText);
    assert.equal(waiting.calls.find(call => call.purpose === 'execution').reservation.tokens.total, null);
    if (action === 'extend') await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
    else if (action === 'stop') await ctx.router.stopTask(waiting.id);
    else {
      await ctx.router.setModelEnabled(reviewRegistration.candidate.candidateId, false);
      await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
    }
    const task = await run;
    const reviewCall = task.calls.find(call => call.purpose === 'review');
    assert.equal(task.id, waiting.id);
    assert.equal(task.acceptance.artifact.text, artifactText);
    if (action === 'extend') {
      assert.equal(task.acceptance.verdict, 'passed');
      assert.equal(reviewCall.reservation.state, 'settled');
      assert.equal(reviewer.requests.length, 1);
    } else {
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.lifecycle, 'paused');
      assert.equal(reviewCall.dispatchStarted, false);
      assert.equal(reviewer.requests.length, 0);
      if (action === 'stop') assert.equal(reviewCall.reservation.state, 'released');
    }
  } finally {
    if (run && waitingTaskId) await ctx.router.stopTask(waitingTaskId).catch(() => {});
    if (run) await run.catch(() => {});
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a real steer during a research review budget wait releases the old Call before reviewing the new artifact', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('support');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const firstArtifact = `ORIGINAL. Claim A.\n研究来源：论点「Claim A」引用来源「${origin}/fact」中的引文「support」。`;
  const secondArtifact = `CORRECTED. Claim A.\n研究来源：论点「Claim A」引用来源「${origin}/fact」中的引文「support」。`;
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const home = await mkdtemp(join(tmpdir(), 'router-t14-review-budget-steer-'));
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-review-steer-main'], new SequencedArtifactFixture([firstArtifact, secondArtifact]));
  ctx.llm.registerAdapter(['t14-review-steer-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  let run;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-review-steer-main', 'artifact', 'Review steer artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-review-steer-review', 'review', 'Review steer review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setBudgetDefaults({ tokens: 16, durationMs: null, money: [] });
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
    const waiting = (await waitFor(ctx, snapshot => snapshot.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
    await ctx.sessionController.prompt({ sessionId, requestId: 't14-review-budget-steer', mode: 'steer', content: [{ type: 'text', text: '继续使用同一研究要求并修正正文。' }] }, new AbortController().signal);
    await ctx.router.extendTaskBudget(waiting.id, { tokens: 8192 });
    const task = await run;
    const reviewCalls = task.calls.filter(call => call.purpose === 'review');

    assert.equal(task.result, `${firstArtifact}${secondArtifact}`);
    assert.equal(task.acceptance.artifact.text, secondArtifact);
    assert.equal(task.acceptance.history.length, 1);
    assert.equal(task.acceptance.history[0].phase, 'superseded');
    assert.equal(reviewCalls.length, 2);
    assert.equal(reviewCalls[0].dispatchStarted, false);
    assert.equal(reviewCalls[0].status, 'not-dispatched');
    assert.equal(reviewCalls[0].reservation.state, 'released');
    assert.equal(reviewCalls[1].dispatchStarted, true);
    assert.equal(reviewer.requests.length, 1);
    assert.equal(JSON.parse(reviewer.requests[0].messages.find(message => message.role === 'user').content[0].text).artifactHash, digest(secondArtifact));
  } finally {
    if (run) await run.catch(() => {});
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('an incomplete real Task preserves claim and inference requirements as unconfirmed without review', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t14-incomplete-artifact-'));
  const ctx = await startNative(home);
  ctx.llm.registerAdapter(['t14-incomplete-main'], new IncompleteArtifactFixture());
  const reviewer = new ResearchReviewFixture();
  ctx.llm.registerAdapter(['t14-incomplete-review'], reviewer);
  let mainRegistration;
  let reviewRegistration;
  try {
    mainRegistration = await registerCandidate(ctx, 't14-incomplete-main', 'artifact', 'Incomplete artifact fixture');
    reviewRegistration = await registerCandidate(ctx, 't14-incomplete-review', 'review', 'Incomplete review fixture');
    await ctx.router.setFixedModel(mainRegistration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: reviewRegistration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, [
      '仅检查以下研究要求：',
      '论点「Claim A」必须有来源。',
      '推论「Claim B」必须由论点「Claim A」支持。',
    ].join('\n'));
    const research = task.acceptance;

    assert.equal(research.verdict, 'unconfirmed');
    assert.equal(research.requirements.some(requirement => requirement.kind === 'research-unresolved'), false);
    assert.deepEqual(research.requirements.map(requirement => requirement.kind).sort(), ['research-claim', 'research-inference']);
    assert.equal(research.evidence.filter(evidence => ['artifact-claim', 'claim-support'].includes(evidence.aspect)).length, 4);
    assert.equal(research.evidence.filter(evidence => ['artifact-claim', 'claim-support'].includes(evidence.aspect)).every(evidence => evidence.verdict === 'unconfirmed' && evidence.reason === 'ARTIFACT_INCOMPLETE'), true);
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution']);
    assert.equal(reviewer.requests.length, 0);
  } finally {
    reviewRegistration?.dispose();
    mainRegistration?.dispose();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a real steer during source resolution supersedes the old artifact and revalidates the new one', async () => {
  const sourceUrl = 'https://example.test/fact';
  const firstArtifact = `ORIGINAL. Claim A.\n研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「support」。`;
  const secondArtifact = `CORRECTED. Claim A.\n研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「support」。`;
  let releaseFirst;
  let startFirst;
  const firstStarted = new Promise(resolve => { startFirst = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  let resolutions = 0;
  const resolver = async () => {
    resolutions++;
    if (resolutions === 1) { startFirst(); await firstRelease; }
    return { access: 'available', displayUrl: sourceUrl, urlHash: digest(sourceUrl), httpStatus: 200, contentType: 'text/plain', contentHash: digest('support'), body: 'support' };
  };
  const home = await mkdtemp(join(tmpdir(), 'router-t14-source-steer-'));
  const ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
  ctx.llm.registerAdapter(['t14-source-steer'], new SequencedArtifactFixture([firstArtifact, secondArtifact]));
  let registration;
  let run;
  try {
    registration = await registerCandidate(ctx, 't14-source-steer', 'artifact', 'Source steer artifact fixture');
    await ctx.router.setFixedModel(registration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
    await firstStarted;
    await ctx.sessionController.prompt({ sessionId, requestId: 't14-source-steer', mode: 'steer', content: [{ type: 'text', text: '仅检查以下明确要求：\n正文必须包含「CORRECTED」。' }] }, new AbortController().signal);
    releaseFirst();
    const task = await run;

    assert.equal(task.result, `${firstArtifact}${secondArtifact}`);
    assert.equal(task.acceptance.artifact.text, secondArtifact);
    assert.equal(task.acceptance.history.length, 1);
    assert.equal(task.acceptance.history[0].phase, 'superseded');
    assert.equal(task.acceptance.history[0].supersededReason, 'next-step-pending');
    assert.equal(task.acceptance.history[0].artifact.text, firstArtifact);
    assert.equal(task.acceptance.requirements.some(item => item.origin.requestId === 't14-source-steer'), true);
    assert.equal(resolutions, 2);
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'execution']);
  } finally {
    releaseFirst?.();
    if (run) await run.catch(() => {});
    registration?.dispose();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('Host restart preserves immutable research snapshots and history without refetching old Tasks', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('support');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sourceUrl = `${origin}/fact`;
  const artifactText = `Claim A.\n研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「support」。`;
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const home = await mkdtemp(join(tmpdir(), 'router-t14-restart-'));
  let ctx;
  try {
    ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
    ctx.llm.registerAdapter(['t14-restart-main'], new ArtifactFixture(artifactText));
    const registration = await registerCandidate(ctx, 't14-restart-main', 'artifact', 'Restart artifact fixture');
    await ctx.router.setFixedModel(registration.candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const completed = await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');
    const acceptance = structuredClone(completed.acceptance);
    assert.equal(requests, 1);
    await ctx.router.flush();
    await ctx.fiber.dispose();

    ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
    const restored = (await ctx.router.snapshot()).tasks.find(task => task.id === completed.id);
    assert.deepEqual(restored.acceptance, acceptance);
    assert.equal(restored.acceptance.research.sourceSnapshots[0].access, 'available');
    assert.equal(restored.acceptance.history.length, 0);
    assert.equal(requests, 1);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
