import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

test('the real renderer configures the routing objective and shows reasons, exclusions and assessment use', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t12-client-'));
  let ctx, mounted;
  try {
    ctx = await startNative(home);
    await ctx.router.setModelEnabled('controlled-tools', false);
    await submit(ctx, (await ctx.sessionController.create({ cwd: home })).sessionId, 'Reply ROUTING_VISIBLE');
    mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      const value = await ctx.router[descriptor.method](...descriptor.parameters.map(item => payload.args[item.name]));
      return { ok: true, value: JSON.parse(JSON.stringify(value)) };
    });
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('路由与预算');
    await act(async () => { await page.root.findByProps({ 'aria-label': '路由目标' }).props.onChange({ target: { value: 'quality' } }); });
    await act(async () => { await page.root.findByProps({ 'aria-label': '允许有界语义判断' }).props.onChange({ target: { checked: true } }); });
    const beforePreview = await ctx.router.snapshot();
    const beforePreviewCalls = beforePreview.tasks.reduce((sum, task) => sum + task.calls.length, 0);
    await click('查看校准预算');
    const afterPreview = await ctx.router.snapshot();
    assert.equal(afterPreview.config.routingObjective, 'quality');
    assert.equal(afterPreview.config.semanticAssessment, true);
    assert.equal(afterPreview.calibrationPreview.status, 'authorization-required');
    assert.equal(afterPreview.tasks.length, beforePreview.tasks.length);
    assert.equal(afterPreview.tasks.reduce((sum, task) => sum + task.calls.length, 0), beforePreviewCalls);
    assert.match(JSON.stringify(page.toJSON()), /尚未授权，未发送校准调用/);
    await click('任务记录');
    const tree = JSON.stringify(page.toJSON());
    assert.match(tree, /起始路由/);
    assert.match(tree, /SINGLE_ELIGIBLE_CANDIDATE/);
    assert.match(tree, /排除 controlled-tools/);
    assert.match(tree, /CANDIDATE_NOT_AUTHORIZED/);
    assert.equal(mounted.errors.length, 0);
  } finally {
    if (mounted) await mounted.dispose();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
