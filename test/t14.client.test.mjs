import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { mountSettings } from './client-harness.mjs';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';
import { createHttpSourceEvidenceResolver } from '../src/research-acceptance.mjs';

class ResearchArtifact extends LlmAdapter {
  #text;
  constructor(text) { super(); this.#text = text; }
  async *stream() {
    yield { type: 'text-delta', index: 0, text: this.#text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('the real Renderer shows safe research access and support evidence without adding a fetch RPC', async () => {
  const secret = 'query-secret-must-not-render';
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('claimed quote appears on a page whose broader relevance remains unconfirmed.');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sourceUrl = `${origin}/fact?token=${secret}`;
  const home = await mkdtemp(join(tmpdir(), 'router-t14-client-'));
  const resolver = createHttpSourceEvidenceResolver({ authorizeUrl: ({ url }) => url.origin === origin, authorizeAddress: ({ address }) => address === '127.0.0.1' });
  let ctx;
  let mounted;
  let dispose;
  try {
    ctx = await startNative(home, { beforeRouter: current => current.provide('routerResearchSourceEvidence', resolver) });
    ctx.llm.registerAdapter(['t14-client-artifact'], new ResearchArtifact(`Claim A.\n研究来源：论点「Claim A」引用来源「${sourceUrl}」中的引文「claimed quote」。`));
    dispose = ctx.router.registerOwned({
      provider: 't14-client-artifact', connectionId: 't14-client-connection', accountId: 't14-client-account', billingPath: 'controlled-test', ownership: 'router-owned', source: 't14-client-test', sourceKey: 't14-client:v1', configRevision: 1, configured: true, authorizationStatus: 'configured',
      models: [{ model: 'artifact', name: 'T14 client artifact', maxContextTokens: 8192, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } } }],
    });
    const candidate = (await ctx.router.refreshConnections()).models.find(item => item.identity.provider === 't14-client-artifact');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    await ctx.router.setAcceptancePolicy({ enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, '仅检查以下研究要求：\n论点「Claim A」必须有来源。');

    mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      assert(descriptor, `Unexpected public RPC ${endpoint}`);
      return { ok: true, value: await ctx.router[descriptor.method](...descriptor.parameters.map(item => payload.args[item.name])) };
    });
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('刷新任务记录');
    await click('任务记录');
    const rendered = JSON.stringify(page.toJSON());
    assert.match(rendered, /研究论点：Claim A/u);
    assert.match(rendered, /来源访问：通过/u);
    assert.match(rendered, /论点支持：未确认/u);
    assert.match(rendered, new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/fact`, 'u'));
    const sourceRow = page.root.findAllByType('p').find(item => item.children.join('').startsWith('来源地址：'));
    assert(sourceRow);
    assert.doesNotMatch(sourceRow.children.join(''), /[?&]token=/u);
    assert.equal(descriptors.some(item => /fetch|source|research/iu.test(item.method)), false);
    assert.equal(mounted.errors.length, 0);
  } finally {
    if (mounted) await mounted.dispose();
    dispose?.();
    if (ctx) await ctx.fiber.dispose();
    server.close(); await once(server, 'close');
    await rm(home, { recursive: true, force: true });
  }
});
