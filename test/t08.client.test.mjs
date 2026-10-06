import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act } from 'react-test-renderer';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { mountSettings } from './client-harness.mjs';
import { startNative } from './t02-harness.mjs';

class VisibleCompanion extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Visible companion' }; }
  async listModels(provider) { return [{ provider, id: 'visible', name: 'Visible native model' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'Visible native model' }; }
  async *stream() { throw new Error('The renderer test must not dispatch a model'); }
}

test('the real renderer refreshes host candidates and enables a native reference by candidateId', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-client-'));
  let ctx, mounted;
  try {
    ctx = await startNative(home, { beforeRouter(host) {
      host.llm.registerAdapter(['visible-companion'], new VisibleCompanion());
      host.llm.registerConfigurableProviders([
        { provider: 'visible-companion', displayName: 'Visible companion', settingsNs: 'visible', settingsPath: ['primary'] },
        { provider: 'dormant-community', displayName: 'Dormant community provider', settingsNs: 'dormant', settingsPath: [] },
      ]);
    } });
    mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const method = endpoint.split('/')[1];
      const args = payload.args;
      const value = method === 'snapshot' ? await ctx.router.snapshot()
        : method === 'refreshConnections' ? await ctx.router.refreshConnections()
          : method === 'setModelEnabled' ? await ctx.router.setModelEnabled(args.candidateId, args.enabled)
            : (() => { throw new Error(`Unexpected method ${method}`); })();
      return { ok: true, value: structuredClone(value) };
    });
    const click = async label => act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('刷新宿主连接');
    const rendered = JSON.stringify(mounted.page.toJSON());
    assert.match(rendered, /Visible native model/);
    assert.match(rendered, /宿主原生引用/);
    assert.match(rendered, /账号 未知/);
    assert.match(rendered, /目录可见不代表推理已验证/);
    assert.match(rendered, /Dormant community provider：暂不支持/);
    await click('加入模型池 Visible native model');
    const candidate = (await ctx.router.snapshot()).models.find(model => model.provider === 'visible-companion');
    assert.equal(candidate.enabled, true);
    assert.equal(candidate.inPool, true);
    assert.equal(mounted.errors.length, 0);
  } finally {
    if (mounted) await mounted.dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
