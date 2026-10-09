import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { act } from 'react-test-renderer';
import { startNative, submit } from './t02-harness.mjs';
import { createHttpSourceEvidenceResolver } from '../src/research-acceptance.mjs';
import { mountSettings } from './client-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const capability = supported => ({ supported, confidence: supported === null ? 'unknown' : 'declared', source: 't15-controlled-boundary' });

class ImageArtifactProvider extends LlmAdapter {
  requests = [];
  imageReads = [];
  constructor(text, { modalities = ['text', 'image'], finish = 'stop' } = {}) { super(); this.text = text; this.modalities = modalities; this.finish = finish; }
  providerInfo(provider) { return { id: provider, name: 'T15 controlled image provider' }; }
  async listModels(provider) { return [await this.resolveModel(provider, 'image')]; }
  async resolveModel(provider, id) { return { provider, id, name: 'T15 image fixture', contextWindow: 65536, maxTokens: 1024, ...(this.modalities ? { inputModalities: this.modalities } : {}) }; }
  async readImages(request) {
    for (const block of request.messages.flatMap(message => message.content).filter(block => block.type === 'image')) {
      const stored = await this.attachments.readImage(block.attachment, request.signal);
      this.imageReads.push({ attachment: stored.ref, hash: createHash('sha256').update(stored.data).digest('hex'), bytes: stored.data.byteLength });
    }
  }
  async *stream(request) {
    this.requests.push(request);
    await this.readImages(request);
    yield { type: 'text-delta', index: 0, text: this.text };
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 } };
    if (this.beforeFinish) await this.beforeFinish(request);
    yield { type: 'finish', reason: { kind: this.finish } };
  }
}

class ImageReviewProvider extends ImageArtifactProvider {
  constructor(mode = 'pass', options = {}) { super('', options); this.mode = mode; this.pricing = options.pricing ?? 'known'; }
  imageRequestPricing() {
    if (this.pricing === 'missing') return undefined;
    return { priceImages: images => {
      if (this.pricing === 'unsupported-format') throw Object.assign(new Error('IMAGE_FORMAT_UNSUPPORTED'), { code: 'IMAGE_FORMAT_UNSUPPORTED' });
      return images.map(() => ({ visualTokens: this.pricing === 'zero' ? 0 : 64, text: '' }));
    } };
  }
  async *stream(request) {
    this.requests.push(request);
    await this.readImages(request);
    const input = JSON.parse(request.messages.find(message => message.role === 'user').content[0].text);
    const output = !input.caseId ? {
      artifactHash: input.artifact.hash, requirementHash: input.requirementHash,
      findings: input.requirements.map(requirement => ({ requirementId: requirement.id, verdict: 'passed', artifactQuote: input.artifact.text, explanation: 'The explicit textual rubric is covered.' })),
    } : {
      artifactHash: input.artifactHash, requirementHash: input.requirementHash, caseId: input.caseId,
      findings: input.requirementIds.map(requirementId => ({ requirementId, verdict: this.mode === 'conflict' && this.requests.length > 1 ? 'failed' : 'passed', artifactQuote: input.artifact.text,
        imageRefs: input.images.map(image => ({ imageId: image.id, hash: image.hash })), explanation: 'The bounded visible relationship is explained.' })),
    };
    if (this.mode === 'wrong-artifact') output.artifactHash = '0'.repeat(64);
    if (this.mode === 'wrong-image') output.findings[0].imageRefs[0].hash = '0'.repeat(64);
    if (this.mode === 'wrong-quote') output.findings[0].artifactQuote = 'not in the artifact';
    if (this.mode === 'extra-field') output.findings[0].override = 'passed';
    if (this.mode === 'missing-finding') output.findings = [];
    const text = JSON.stringify(output);
    yield { type: 'text-delta', index: 0, text };
    if (this.mode !== 'unknown-usage') yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } };
    yield { type: 'finish', reason: { kind: this.mode === 'incomplete' ? 'max-tokens' : 'stop' } };
  }
}

async function registerCandidate(ctx, provider, adapter, image = true, capacity = 65536) {
  adapter.attachments = ctx.get('attachments');
  ctx.llm.registerAdapter([provider], adapter);
  const dispose = ctx.router.registerOwned({
    provider, connectionId: `${provider}-connection`, accountId: `${provider}-account`, billingPath: 't15-controlled', ownership: 'router-owned',
    source: 't15-controlled-provider', sourceKey: `${provider}:v1`, configRevision: 1, configured: true, authorizationStatus: 'configured',
    models: [{ model: 'image', name: 'T15 image fixture', maxContextTokens: capacity, capability: { text: capability(true), image: capability(image), tools: capability(false) } }],
  });
  const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider);
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  return { candidate, dispose };
}

async function imageTask(ctx, sessionId, text, data = png, requestId = randomUUID()) {
  await ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }, ...(Array.isArray(data) ? data : [data]).map(data => ({ type: 'image', mediaType: 'image/png', data }))] }, new AbortController().signal);
  await ctx.agents.get(sessionId).whenIdle();
  return (await ctx.router.snapshot()).tasks.at(-1);
}

async function fixture(text, run, { beforeRouter, routerPlugin } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'router-t15-'));
  const ctx = await startNative(home, { images: true, beforeRouter, routerPlugin });
  const main = new ImageArtifactProvider(text);
  const registration = await registerCandidate(ctx, 't15-image-main', main);
  try {
    await ctx.router.setFixedModel(registration.candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, '准备接收图像。');
    main.requests.length = 0;
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 16384 } });
    await run({ ctx, sessionId, main, candidate: registration.candidate, home });
  } finally {
    registration.dispose();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

async function waitFor(ctx, predicate) {
  const deadline = Date.now() + 3000;
  let last;
  while (Date.now() < deadline) {
    const snapshot = await ctx.router.snapshot();
    last = snapshot.tasks.at(-1);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`The image Task did not reach its public boundary: ${JSON.stringify({ lifecycle: last?.lifecycle, artifact: last?.acceptance?.artifact?.hash, phase: last?.acceptance?.phase, calls: last?.calls.map(({ purpose, status, failureCode }) => ({ purpose, status, failureCode })) })}`);
}

test('a complete image Task preserves the admitted image and records a bound recognition reference separately from the answer check', async () => {
  const artifact = '图像1识别「像素颜色」答案为「黑色」。';
  await fixture(artifact, async ({ ctx, sessionId, main }) => {
    const prompt = '识别图像的像素颜色。\n仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。';
    const task = await imageTask(ctx, sessionId, prompt);
    const user = ctx.sessions.get(sessionId).snapshotEvents().find(event => event.type === 'user/message' && event.data.id === task.inputs[0].messageId);
    const image = user.data.content.find(block => block.type === 'image');
    assert.deepEqual(main.requests[0].messages.find(message => message.role === 'user' && message.content.some(block => block.type === 'image')).content, user.data.content);
    assert.equal(task.acceptance.artifact.text, artifact);
    assert.deepEqual(task.acceptance.image.images[0].attachment, image.attachment);
    assert.equal(task.acceptance.image.images[0].hash, image.attachment.attachmentId.slice('sha256:'.length));
    assert.equal(main.imageReads[0].hash, 'e68bb6828d842a6c845223b2966aef7c28134491c003f940020e17ee8b06391d');
    assert.deepEqual(main.imageReads[0].attachment, image.attachment);
    assert.equal(task.acceptance.requirements[0].origin.messageId, task.inputs[0].messageId);
    assert.equal(task.acceptance.requirements[0].origin.seq, user.seq);
    assert.deepEqual(task.acceptance.evidence.map(item => [item.aspect, item.verdict]), [['image-binding', 'passed'], ['reference-answer', 'passed'], ['answer-match', 'passed']]);
    assert.equal(task.acceptance.coverage.covered, 1);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].usage.totalTokens, 24);
    assert.equal(task.ledger.tokens.total, 24);
    assert.equal(task.calls[0].selection.provider, 't15-image-main');
    assert.ok(task.timeline.some(event => event.kind === 'acceptance-published' && event.verdict === 'passed'));
    assert.equal(task.acceptance.artifact.hash, createHash('sha256').update(artifact).digest('hex'));
  });
});

test('a complete image Task checks finite localization and explanation answers against their explicit references', async () => {
  const artifact = '图像1定位「像素位置」答案为「左上角」。\n图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。';
  await fixture(artifact, async ({ ctx, sessionId }) => {
    const task = await imageTask(ctx, sessionId, '请给出有限定位和解释答案。\n仅检查以下图像要求：\n图像1定位「像素位置」的参考答案为「左上角」。\n图像1解释「像素布局」的参考答案为「单个像素覆盖整幅图像」。');
    assert.deepEqual(task.acceptance.requirements.map(item => item.operation), ['localization', 'explanation']);
    assert.deepEqual(task.acceptance.evidence.filter(item => item.aspect === 'answer-match').map(item => item.verdict), ['passed', 'passed']);
    assert.equal(task.acceptance.coverage.covered, 2);
    assert.equal(task.acceptance.verdict, 'passed');
    assert.equal(task.calls.length, 1);
  });
});

test('an ambiguous image interpretation remains unconfirmed even when the artifact confidently guesses an identity', async () => {
  await fixture('图像1识别「人物身份」答案为「某位名人」。', async ({ ctx, sessionId }) => {
    const task = await imageTask(ctx, sessionId, '不要把猜测当事实。\n仅检查以下图像要求：\n图像1识别「人物身份」存在歧义。');
    assert.equal(task.acceptance.requirements[0].kind, 'image-ambiguous');
    assert.equal(task.acceptance.requirements[0].imageId, task.acceptance.image.images[0].id);
    assert.equal(task.acceptance.evidence.find(item => item.aspect === 'answer-match').reason, 'IMAGE_REFERENCE_AMBIGUOUS');
    assert.equal(task.acceptance.coverage.covered, 0);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(task.calls.length, 1);
  });
});

test('conflicting declared image references remain unconfirmed instead of choosing one reference as the truth', async () => {
  await fixture('图像1识别「像素颜色」答案为「黑色」。', async ({ ctx, sessionId }) => {
    const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。\n图像1识别「像素颜色」的参考答案为「白色」。');
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.deepEqual(task.acceptance.evidence.filter(item => item.aspect === 'answer-match').map(item => [item.verdict, item.reason]), [['unconfirmed', 'IMAGE_REFERENCE_CONFLICT'], ['unconfirmed', 'IMAGE_REFERENCE_CONFLICT']]);
    assert.equal(task.acceptance.coverage.covered, 0);
    assert.equal(task.calls.length, 1);
  });
});

test('a necessary anonymous multimodal review checks a bound explanation and settles its usage in the same image Task', async () => {
  await fixture('图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。', async ({ ctx, sessionId, main }) => {
    const reviewer = new ImageReviewProvider();
    const registration = await registerCandidate(ctx, 't15-image-review', reviewer);
    try {
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。');
      assert.equal(task.acceptance.requirements[0].kind, 'image-rubric');
      assert.equal(task.acceptance.verdict, 'passed', JSON.stringify(task.acceptance.reviews));
      assert.equal(task.acceptance.evidence.find(item => item.aspect === 'answer-match').source.kind, 'image-review');
      assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review']);
      assert.equal(task.ledger.tokens.total, 124);
      const user = reviewer.requests[0].messages.find(message => message.role === 'user');
      assert.deepEqual(user.content.filter(block => block.type === 'image'), main.requests[0].messages.find(message => message.role === 'user' && message.content.some(block => block.type === 'image')).content.filter(block => block.type === 'image'));
      assert.deepEqual(reviewer.imageReads, main.imageReads);
      const payload = JSON.parse(user.content[0].text);
      assert.equal(payload.artifactHash, task.acceptance.artifact.hash);
      assert.equal(payload.requirementHash, task.acceptance.requirementHash);
      assert.equal(payload.images[0].hash, task.acceptance.image.images[0].hash);
      assert.equal(JSON.stringify(payload).includes('t15-image-main'), false);
      assert.equal(JSON.stringify(payload).includes('billingPath'), false);
      assert.equal(task.acceptance.reviews[0].imageForecast.source, 'provider-image-request-pricing');
    } finally { registration.dispose(); }
  });
});

test('two conflicting high risk image reviews remain unconfirmed and share the original Task ledger', async () => {
  await fixture('图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。', async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider('conflict');
    const registration = await registerCandidate(ctx, 't15-image-conflict-review', reviewer);
    try {
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的高风险评审标准为「解释必须限于可见布局」。');
      assert.equal(task.acceptance.requirements[0].risk, 'high');
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.acceptance.evidence.find(item => item.aspect === 'answer-match').reason, 'REVIEW_CONFLICT');
      assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review', 'review']);
      assert.equal(task.ledger.tokens.total, 224);
      assert.equal(task.acceptance.reviews.length, 2);
    } finally { registration.dispose(); }
  });
});

test('an image contract above the finite requirement limit is visibly unconfirmed without truncating the user input', async () => {
  const requirements = Array.from({ length: 33 }, (_value, index) => `图像1识别「字段${index}」的参考答案为「黑色」。`);
  const artifact = Array.from({ length: 33 }, (_value, index) => `图像1识别「字段${index}」答案为「黑色」。`).join('\n');
  await fixture(artifact, async ({ ctx, sessionId, main }) => {
    const prompt = `仅检查以下图像要求：\n${requirements.join('\n')}`;
    const task = await imageTask(ctx, sessionId, prompt);
    assert.equal(task.acceptance.verdict, 'unconfirmed');
    assert.equal(task.acceptance.evidence.at(-1).reason, 'IMAGE_REQUIREMENT_LIMIT_EXCEEDED');
    assert.ok(main.requests[0].messages.some(message => message.content.some(block => block.type === 'text' && block.text === prompt)));
    assert.equal(task.calls.length, 1);
  });
});

test('rubric, research and image requirements retain their distinct evidence while sharing the two review Task limit', async () => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('The pixel covers the whole image.'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const source = `http://127.0.0.1:${server.address().port}/pixel`;
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === new URL(source).origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  const artifact = `The pixel covers the whole image.\n研究来源：论点「The pixel covers the whole image」引用来源「${source}」中的引文「The pixel covers the whole image」。\n图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。`;
  try {
    await fixture(artifact, async ({ ctx, sessionId }) => {
      const reviewer = new ImageReviewProvider();
      const registration = await registerCandidate(ctx, 't15-mixed-review', reviewer);
      try {
        await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
        const task = await imageTask(ctx, sessionId, '仅检查以下明确要求：\n高风险评审标准：「正文明确说明像素布局」。\n仅检查以下研究要求：\n论点「The pixel covers the whole image」必须有来源。\n仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。');
        assert.deepEqual(task.acceptance.domains, ['research', 'image']);
        assert.equal(task.acceptance.requirements.length, 3);
        assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'review', 'review']);
        assert.equal(task.acceptance.evidence.find(item => item.aspect === 'claim-support').reason, 'REVIEW_ATTEMPT_LIMIT');
        assert.equal(task.acceptance.evidence.find(item => item.aspect === 'answer-match').reason, 'REVIEW_ATTEMPT_LIMIT');
        assert.equal(task.acceptance.verdict, 'unconfirmed');
        assert.equal(task.ledger.tokens.total, 224);
      } finally { registration.dispose(); }
    }, { beforeRouter: ctx => ctx.provide('routerResearchSourceEvidence', resolver) });
  } finally { server.close(); await once(server, 'close'); }
});

test('a reviewer that loses its image metadata during budget wait cannot receive a text-only substitution after budget extension', async () => {
  await fixture('图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。', async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider();
    const registration = await registerCandidate(ctx, 't15-budget-review', reviewer);
    try {
      await ctx.router.setBudgetDefaults({ tokens: 100, durationMs: null, money: [] });
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const completion = imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。').catch(error => ({ error }));
      const waiting = (await waitFor(ctx, snapshot => snapshot.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
      reviewer.modalities = ['text'];
      await ctx.router.extendTaskBudget(waiting.id, { tokens: 20000 });
      const task = await completion;
      assert.equal(task.id, waiting.id);
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.acceptance.reviews[0].reason, 'REVIEW_IMAGE_CAPABILITY_UNSUPPORTED');
      assert.equal(reviewer.requests.length, 0);
      assert.equal(task.calls.at(-1).dispatchStarted, false);
      assert.equal(task.calls.at(-1).reservation.state, 'released');
      assert.equal(task.ledger.tokens.total, 24);
    } finally { registration.dispose(); }
  });
});

test('a real image steer during review budget wait retains both input bindings and superseded evidence in the same Task', async () => {
  const first = '图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。';
  await fixture(first, async ({ ctx, sessionId, main }) => {
    const reviewer = new ImageReviewProvider();
    const registration = await registerCandidate(ctx, 't15-steer-review', reviewer);
    try {
      await ctx.router.setBudgetDefaults({ tokens: 100, durationMs: null, money: [] });
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const completion = imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。').catch(error => ({ error }));
      const waiting = (await waitFor(ctx, snapshot => snapshot.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
      main.text = `${first}\n图像2识别「像素颜色」答案为「黑色」。`;
      await ctx.sessionController.prompt({ sessionId, requestId: 't15-new-image-steer', mode: 'steer', content: [{ type: 'text', text: '继续原要求并检查新图像。\n仅检查以下图像要求：\n图像2识别「像素颜色」的参考答案为「黑色」。' }, { type: 'image', mediaType: 'image/png', data: png }] }, new AbortController().signal);
      await ctx.router.extendTaskBudget(waiting.id, { tokens: 20000 });
      const task = await completion;
      assert.equal(task.id, waiting.id);
      assert.equal(task.inputs.length, 2);
      assert.equal(task.acceptance.image.images.length, 2);
      assert.notEqual(task.acceptance.image.images[0].id, task.acceptance.image.images[1].id);
      assert.equal(task.acceptance.image.images[1].origin.requestId, 't15-new-image-steer');
      assert.equal(task.acceptance.verdict, 'passed');
      const reviews = task.calls.filter(call => call.purpose === 'review');
      assert.equal(reviews[0].dispatchStarted, false);
      assert.equal(reviews[0].reservation.state, 'released');
      assert.equal(reviewer.requests.length, 1);
      assert.equal(task.ledger.tokens.total, 148);
      const old = task.acceptance.history.find(record => record.artifact?.text === first);
      assert(old);
      assert.deepEqual(old.image.images[0].attachment, task.acceptance.image.images[0].attachment);
      assert.equal(old.evidence.find(item => item.aspect === 'image-binding').imageHash, task.acceptance.image.images[0].hash);
      assert.equal(old.requirements[0].imageId, task.acceptance.image.images[0].id);
    } finally { registration.dispose(); }
  });
});

for (const scenario of [
  { name: 'text-only candidate', image: false, reason: 'REVIEW_IMAGE_CAPABILITY_UNSUPPORTED' },
  { name: 'unknown candidate image capability', image: null, reason: 'REVIEW_IMAGE_CAPABILITY_UNKNOWN' },
  { name: 'text-only exact adapter metadata', modalities: ['text'], reason: 'REVIEW_IMAGE_CAPABILITY_UNSUPPORTED' },
  { name: 'unknown exact adapter metadata', modalities: null, reason: 'REVIEW_IMAGE_CAPABILITY_UNKNOWN' },
  { name: 'missing provider image pricing', pricing: 'missing', reason: 'REVIEW_IMAGE_FORECAST_UNKNOWN' },
  { name: 'unretained image pricing', pricing: 'zero', reason: 'REVIEW_IMAGE_FORECAST_INVALID' },
  { name: 'unsupported provider image format', pricing: 'unsupported-format', reason: 'IMAGE_FORMAT_UNSUPPORTED' },
  { name: 'insufficient reviewer capacity', capacity: 512, reason: 'REVIEW_CONTEXT_CAPACITY_EXCEEDED' },
  { name: 'unknown reviewer capacity', capacity: null, reason: 'REVIEW_CONTEXT_CAPACITY_UNKNOWN' },
  { name: 'insufficient input forecast', forecast: 256, reason: 'REVIEW_INPUT_FORECAST_EXCEEDED' },
  { name: 'unreadable admitted attachment', removeAttachment: true, reason: 'REVIEW_IMAGE_ATTACHMENT_UNAVAILABLE' },
]) test(`image review refuses ${scenario.name} before reservation and preserves the completed artifact`, async () => {
  const artifact = '图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。';
  await fixture(artifact, async ({ ctx, sessionId, main }) => {
    const reviewer = new ImageReviewProvider('pass', { ...(Object.hasOwn(scenario, 'modalities') ? { modalities: scenario.modalities } : {}), pricing: scenario.pricing });
    const registration = await registerCandidate(ctx, 't15-review-preflight', reviewer, Object.hasOwn(scenario, 'image') ? scenario.image : true, Object.hasOwn(scenario, 'capacity') ? scenario.capacity : 65536);
    try {
      if (scenario.removeAttachment) main.beforeFinish = async request => {
        const block = request.messages.flatMap(message => message.content).find(block => block.type === 'image');
        await rm(main.attachments.imageHostPath(block.attachment));
      };
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: scenario.forecast ?? 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。');
      assert.equal(task.acceptance.artifact.text, artifact);
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.acceptance.reviews[0].reason, scenario.reason);
      assert.equal(task.calls.length, 1);
      assert.equal(reviewer.requests.length, 0);
      assert.equal(task.ledger.tokens.total, 24);
    } finally { registration.dispose(); }
  });
});

for (const mode of ['wrong-artifact', 'wrong-image', 'wrong-quote', 'extra-field', 'missing-finding', 'incomplete']) test(`a ${mode} image review cannot publish success and consumes at most the two Task review attempts`, async () => {
  await fixture('图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。', async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider(mode);
    const registration = await registerCandidate(ctx, 't15-invalid-review', reviewer);
    try {
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。');
      assert.equal(task.acceptance.verdict, 'unconfirmed');
      assert.equal(task.acceptance.reviews.every(record => !record.valid), true);
      assert.equal(task.calls.filter(call => call.purpose === 'review').length, 2);
      assert.equal(reviewer.requests.length, 2);
      assert.equal(task.ledger.tokens.total, 224);
    } finally { registration.dispose(); }
  });
});

for (const supported of [false, null]) test(`a complete image Task dispatches zero requests to a fixed ${supported === false ? 'text-only' : 'unknown-image'} candidate`, async () => {
  await fixture('图像1识别「像素颜色」答案为「黑色」。', async ({ ctx, sessionId, main }) => {
    const incompatible = new ImageArtifactProvider('must not run');
    const registration = await registerCandidate(ctx, 't15-incompatible-execution', incompatible, supported);
    try {
      await ctx.router.setFixedModel(registration.candidate.candidateId);
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。');
      assert.equal(task.pauseReason, 'NO_COMPATIBLE_IMAGE_CANDIDATE');
      assert.equal(task.calls.length, 0);
      assert.equal(incompatible.requests.length, 0);
      assert.equal(main.requests.length, 0);
      assert.equal(task.acceptance.verdict, 'unconfirmed');
    } finally { registration.dispose(); }
  });
});

test('high risk multimodal reviews reverse the anonymous image and requirement presentation while preserving the exact two input bindings', async () => {
  const artifact = '图像1解释「第一张布局」答案为「单个像素覆盖整幅图像」。\n图像2解释「第二张布局」答案为「单个像素覆盖整幅图像」。';
  await fixture(artifact, async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider();
    const registration = await registerCandidate(ctx, 't15-order-review', reviewer);
    try {
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「第一张布局」的高风险评审标准为「解释必须限于可见布局」。\n图像2解释「第二张布局」的高风险评审标准为「解释必须限于可见布局」。', [png, png]);
      assert.equal(task.acceptance.verdict, 'passed');
      const inputs = reviewer.requests.map(request => JSON.parse(request.messages.find(message => message.role === 'user').content[0].text));
      assert.deepEqual(inputs[1].images.map(image => image.id), inputs[0].images.map(image => image.id).reverse());
      assert.deepEqual(inputs[1].requirements.map(requirement => requirement.id), inputs[0].requirements.map(requirement => requirement.id).reverse());
      assert.equal(task.acceptance.image.images.length, 2);
      assert.notEqual(task.acceptance.image.images[0].id, task.acceptance.image.images[1].id);
      assert.equal(reviewer.requests.every(request => request.messages.find(message => message.role === 'user').content.filter(block => block.type === 'image').length === 2), true);
      assert.equal(reviewer.imageReads.length, 4);
      assert.equal(reviewer.imageReads.every(image => image.hash === task.acceptance.image.images[0].hash), true);
      assert.equal(task.ledger.tokens.total, 224);
    } finally { registration.dispose(); }
  });
});

test('the built Host and native Renderer display bound image evidence through the existing snapshot RPC', async () => {
  const builtHost = await import('../lib/index.js');
  await fixture('图像1识别「像素颜色」答案为「黑色」。', async ({ ctx, sessionId }) => {
    await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。');
    const mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      assert(descriptor);
      return { ok: true, value: await ctx.router[descriptor.method](...descriptor.parameters.map(item => payload.args[item.name])) };
    });
    try {
      const click = async label => act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
      await click('刷新任务记录');
      await click('任务记录');
      const rendered = JSON.stringify(mounted.page.toJSON());
      assert.match(rendered, /图像1 · 识别：像素颜色/u);
      assert.match(rendered, /参考答案：黑色 · 参考来源：用户声明/u);
      assert.match(rendered, /答案核对：通过/u);
      assert.match(rendered, /图像输入：image\/webp · 1×1/u);
      assert.equal(rendered.includes(png), false);
      assert.equal(descriptors.some(item => /image|vision|verdict|score/iu.test(item.method)), false);
      assert.equal(mounted.errors.length, 0);
    } finally { await mounted.dispose(); }
  }, { routerPlugin: builtHost });
});

for (const action of ['extend', 'stop', 'revoke']) test(`an image review budget wait ${action} keeps the original Task and completed image artifact`, async () => {
  const artifact = '图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。';
  await fixture(artifact, async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider();
    const registration = await registerCandidate(ctx, 't15-budget-action', reviewer);
    try {
      await ctx.router.setBudgetDefaults({ tokens: 100, durationMs: null, money: [] });
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const completion = imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。').catch(error => ({ error }));
      const waiting = (await waitFor(ctx, snapshot => snapshot.tasks.at(-1)?.calls.some(call => call.purpose === 'review' && call.status === 'waiting'))).tasks.at(-1);
      assert.equal(reviewer.requests.length, 0);
      if (action === 'stop') await ctx.router.stopTask(waiting.id);
      else {
        if (action === 'revoke') await ctx.router.setModelEnabled(registration.candidate.candidateId, false);
        await ctx.router.extendTaskBudget(waiting.id, { tokens: 20000 });
      }
      const task = await completion;
      assert.equal(task.id, waiting.id);
      assert.equal(task.acceptance.artifact.text, artifact);
      assert.deepEqual(task.acceptance.image.images, waiting.acceptance.image.images);
      if (action === 'extend') {
        assert.equal(task.acceptance.verdict, 'passed');
        assert.equal(task.ledger.tokens.total, 124);
        assert.equal(reviewer.requests.length, 1);
      } else {
        assert.equal(task.acceptance.verdict, 'unconfirmed');
        assert.equal(task.calls.at(-1).dispatchStarted, false);
        assert.equal(task.calls.at(-1).reservation.state, 'released');
        assert.equal(reviewer.requests.length, 0);
        assert.equal(task.ledger.tokens.total, 24);
      }
    } finally { registration.dispose(); }
  });
});

test('unknown multimodal review usage stays unknown in the Task ledger even when a bounded rubric is supported', async () => {
  await fixture('图像1解释「像素布局」答案为「单个像素覆盖整幅图像」。', async ({ ctx, sessionId }) => {
    const reviewer = new ImageReviewProvider('unknown-usage');
    const registration = await registerCandidate(ctx, 't15-unknown-usage', reviewer);
    try {
      await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: true, candidateId: registration.candidate.candidateId, allowCrossModel: true, maxTokens: 256, forecastTokens: 16384 } });
      const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1解释「像素布局」的评审标准为「解释必须限于可见布局」。');
      assert.equal(task.acceptance.verdict, 'passed');
      assert.equal(task.ledger.tokens.total, null);
      assert.equal(task.ledger.knownTokens.total, 24);
      assert.equal(task.ledger.unknownTokenCalls.total, 1);
      assert.equal(task.ledger.actualSpend.status, 'unknown');
    } finally { registration.dispose(); }
  });
});

for (const scenario of [
  { name: 'unambiguous wrong reference answer', artifact: '图像1识别「像素颜色」答案为「白色」。', verdict: 'failed', reason: 'IMAGE_REFERENCE_MISMATCH' },
  { name: 'duplicate contradictory answers', artifact: '图像1识别「像素颜色」答案为「黑色」。图像1识别「像素颜色」答案为「白色」。', verdict: 'unconfirmed', reason: 'IMAGE_ANSWER_CONFLICT' },
  { name: 'incomplete response', artifact: '图像1识别「像素颜色」答案为「黑色」。', verdict: 'unconfirmed', reason: 'ARTIFACT_INCOMPLETE', incomplete: true },
]) test(`an image Task preserves the ${scenario.name} result without inventing successful coverage`, async () => {
  await fixture(scenario.artifact, async ({ ctx, sessionId, main }) => {
    if (scenario.incomplete) main.finish = 'max-tokens';
    const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。');
    assert.equal(task.acceptance.verdict, scenario.verdict);
    assert.equal(task.acceptance.evidence.find(item => item.aspect === 'answer-match').reason, scenario.reason);
    assert.equal(task.acceptance.coverage.covered, scenario.verdict === 'failed' ? 1 : 0);
    assert.equal(task.calls.length, 1);
  });
});

test('completed image evidence and original legacy acceptance persist through a real Host restart', async () => {
  await fixture('图像1识别「像素颜色」答案为「黑色」。', async ({ ctx, sessionId, home }) => {
    const task = await imageTask(ctx, sessionId, '仅检查以下图像要求：\n图像1识别「像素颜色」的参考答案为「黑色」。');
    const legacy = (await ctx.router.snapshot()).tasks[0];
    await ctx.router.flush();
    await ctx.fiber.dispose();
    const restarted = await startNative(home, { images: true });
    try {
      const snapshot = await restarted.router.snapshot();
      assert.deepEqual(snapshot.tasks.find(item => item.id === task.id).acceptance, task.acceptance);
      assert.deepEqual(snapshot.tasks.find(item => item.id === task.id).ledger, task.ledger);
      assert.deepEqual(snapshot.tasks.find(item => item.id === legacy.id).acceptance, legacy.acceptance);
      const stored = await restarted.get('attachments').readImage(task.acceptance.image.images[0].attachment);
      assert.equal(createHash('sha256').update(stored.data).digest('hex'), task.acceptance.image.images[0].hash);
    } finally { await restarted.fiber.dispose(); }
  });
});
