import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react-test-renderer';
import { descriptors } from '../src/protocol.mjs';
import { prepare, submitTask, waitForSnapshot } from './t18-harness.mjs';
import { mountSettings } from './client-harness.mjs';

test('real Renderer and strict public RPC opt into recovery, resolve one live Task and stop another without a terminal resume button', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-client-'));
  let ctx, mounted, running;
  try {
    const fixture = await prepare(home, { policy: { enabled: false, automatic: false } }); ctx = fixture.ctx;
    const carrier = async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      const args = descriptor.parameters.map(item => item.codec.create().parse(payload.args[item.name]));
      const value = await ctx.router[descriptor.method](...args);
      return { ok: true, value: descriptor.result.create().parse(JSON.parse(JSON.stringify(value))) };
    };
    const encoded = await carrier('', 'router/snapshot', { args: {} });
    assert.equal(encoded.value.config.recovery.enabled, false);
    mounted = await mountSettings(encoded.value, carrier);
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    await click('路由与预算');
    assert.equal(page.root.findByProps({ 'aria-label': '启用故障恢复' }).props.checked, false);
    assert.equal(page.root.findByProps({ 'aria-label': '自动执行安全恢复' }).props.checked, false);
    await act(async () => { page.root.findByProps({ 'aria-label': '启用故障恢复' }).props.onChange({ target: { checked: true } }); });
    await click('保存恢复设置');
    assert.equal((await ctx.router.snapshot()).config.recovery.enabled, true, JSON.stringify(mounted.calls));
    fixture.main.failures = [{ code: 'CONNECTION', facts: { status: 503 } }];
    running = submitTask(ctx, fixture.sessionId);
    const live = await waitForSnapshot(ctx, state => state.tasks.find(task => task.recovery?.state === 'waiting-user'));
    await click('刷新任务记录');
    await click(`重试当前模型 ${live.id}`);
    const completed = await running;
    assert.equal(completed.id, live.id); assert.equal(completed.lifecycle, 'completed');
    assert.equal(fixture.main.requests.length, 2);
    const resolve = mounted.calls.find(call => call.endpoint === 'router/resolveTaskRecovery');
    assert.deepEqual(resolve.payload.args.request, { taskId: live.id, recoveryId: live.recovery.id, expectedRevision: live.recovery.revision, action: 'retry-current' });
    await click('任务记录'); await click('刷新任务记录');
    assert.equal(page.root.findAllByType('button').some(button => button.children.includes(`重试当前模型 ${completed.id}`)), false);
    assert.match(JSON.stringify(page.toJSON()), /CONNECTION.*503/);
    fixture.main.failures = [{ code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    const waiting = await waitForSnapshot(ctx, state => state.tasks.find(task => task.recovery?.state === 'waiting-user'));
    await click('刷新任务记录'); await click(`停止恢复 ${waiting.id}`);
    assert.equal((await running).lifecycle, 'paused');
    await click('刷新任务记录');
    assert.match(JSON.stringify(page.toJSON()), /新任务.*不会复活旧任务/);
    assert.equal(mounted.errors.length, 0);
    assert.equal(mounted.diagnostics.length, 0);
  } finally {
    if (ctx) { for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle)) await ctx.router.stopTask(task.id); await running; }
    await mounted?.dispose(); await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
