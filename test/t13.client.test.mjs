import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

test('the real Renderer configures bounded acceptance and shows persisted evidence', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t13-client-'));
  let ctx;
  let mounted;
  try {
    ctx = await startNative(home);
    mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      assert(descriptor, `Unexpected public RPC ${endpoint}`);
      const value = await ctx.router[descriptor.method](...descriptor.parameters.map(item => payload.args[item.name]));
      return { ok: true, value: JSON.parse(JSON.stringify(value)) };
    });
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('路由与预算');
    await act(async () => { page.root.findByProps({ 'aria-label': '启用明确要求验收' }).props.onChange({ target: { checked: true } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '评审输出 token 上限' }).props.onChange({ target: { value: '192' } }); });
    await act(async () => { page.root.findByProps({ 'aria-label': '评审预留 token' }).props.onChange({ target: { value: '256' } }); });
    await click('保存验收设置');
    const policy = (await ctx.router.snapshot()).config.acceptance;
    assert.deepEqual(policy, { enabled: true, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 192, forecastTokens: 256 } });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply VISIBLE\n仅检查以下明确要求：\n正文必须包含「VISIBLE」。');
    await click('刷新任务记录');
    await click('任务记录');
    const rendered = JSON.stringify(page.toJSON());
    assert.match(rendered, /验收：通过/);
    assert.match(rendered, /覆盖 1\/1/);
    assert.match(rendered, /deterministic-rule/);
    assert.match(rendered, /不代表整体质量保证/);
    assert.equal(mounted.errors.length, 0);
    const publicMethods = new Set(descriptors.map(item => item.method));
    for (const hostOnly of ['exactTask', 'publishAcceptance', 'captureCandidate', 'reserveCall', 'streamReservedCall']) assert.equal(publicMethods.has(hostOnly), false);
  } finally {
    if (mounted) await mounted.dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
