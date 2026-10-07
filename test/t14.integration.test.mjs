import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { AcceptanceCoordinator } from '../src/acceptance.mjs';
import { createHttpSourceEvidenceResolver, createResearchAcceptance } from '../src/research-acceptance.mjs';
import { validateResearchContribution } from '../src/research-contribution.mjs';
import { startNative, submit } from './t02-harness.mjs';

class ArtifactFixture extends LlmAdapter {
  #text;
  constructor(text) { super(); this.#text = text; }
  async *stream() {
    yield { type: 'text-delta', index: 0, text: this.#text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
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
  const ctx = await startNative(home);
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
  const acceptance = new AcceptanceCoordinator(ctx);
  try {
    const candidate = (await ctx.router.snapshot()).candidateSnapshot.candidates.find(item => item.identity.provider === provider);
    assert(candidate);
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const prompt = '请回答研究问题。\n仅检查以下研究要求：\n论点「Mars has two moons」必须有来源。';
    const task = await submit(ctx, sessionId, prompt);
    const hostAcceptance = acceptance.getResult(task.id);
    assert.equal(hostAcceptance.artifact.text, artifactText);
    assert.equal(hostAcceptance.artifact.sessionId, sessionId);
    assert.equal(hostAcceptance.artifact.turn, task.turn);
    const userEvent = ctx.sessions.get(sessionId).snapshotEvents().find(event => event.type === 'user/message' && event.data.id === task.inputs[0].messageId);
    assert(userEvent);

    const resolveSourceEvidence = createHttpSourceEvidenceResolver({
      authorizeUrl: ({ url }) => url.origin === new URL(sourceUrl).origin,
      authorizeAddress: ({ address }) => address === '127.0.0.1',
    });
    const contribution = await createResearchAcceptance({ resolveSourceEvidence }).contribute({
      task,
      inputs: [{ messageId: task.inputs[0].messageId, requestId: task.inputs[0].requestId, seq: userEvent.seq, text: prompt }],
      artifact: hostAcceptance.artifact,
      signal: new AbortController().signal,
    });
    const validated = validateResearchContribution(contribution, { taskId: task.id, artifact: hostAcceptance.artifact });
    assert.equal(validated.sourceSnapshots[0].access, 'available');
    assert.equal(validated.evidence.find(item => item.aspect === 'source-access').verdict, 'passed');
    assert.equal(validated.evidence.find(item => item.aspect === 'claim-support').verdict, 'unconfirmed');
    assert.equal(validated.reviewCases.length, 1);
    assert.equal(task.calls.length, 1);
    assert.equal(ctx.router.exactTask(sessionId, task.turn).acceptance.research, undefined);
    assert.equal(Object.isFrozen(validated.reviewCases[0].anonymousPayload), true);
  } finally {
    unregister();
    await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true });
  }
});
