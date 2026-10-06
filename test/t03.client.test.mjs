import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';
import { startNative, submit } from './t02-harness.mjs';
import { descriptors } from '../src/protocol.mjs';

test('the real settings facade saves budgets, extends one waiting task, displays its ledger and stops the next task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t03-client-'));
  const ctx = await startNative(home);
  let mounted, run;
  try {
    await ctx.router.setPriceQuote('router-controlled', 'controlled', { source: 'Local client test only', date: '2026-10-07', currency: 'USD', kind: 'fixture-reference', confidence: 'declared', perMillion: { input: 2, output: 6, cacheRead: 1, cacheWrite: 3 }, reasoning: 'included-in-output' });
    mounted = await mountSettings(await ctx.router.snapshot(), async (_path, endpoint, payload) => {
      const descriptor = descriptors.find(item => `${item.namespace}/${item.method}` === endpoint);
      const value = await ctx.router[descriptor.method](...descriptor.parameters.map(item => payload.args[item.name]));
      return { ok: true, value: JSON.parse(JSON.stringify(value)) };
    });
    const page = mounted.page;
    const click = async label => act(async () => { await page.root.findAllByType('button').find(item => item.children.includes(label)).props.onClick(); });
    const fill = async (label, value) => act(async () => { await page.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }); });
    await click('路由与预算');
    await fill('每任务 token 上限', '10');
    await click('保存新任务预算');
    assert.equal((await ctx.router.snapshot()).config.budget.tokens, 10);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply CLIENT_BUDGET');
    const until = Date.now() + 3000;
    while ((await ctx.router.snapshot()).tasks.at(-1)?.lifecycle !== 'waiting-budget' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    const id = (await ctx.router.snapshot()).tasks.at(-1).id;
    await click('刷新任务记录');
    assert.match(JSON.stringify(page.toJSON()), /预算等待/);
    await fill(`增加 token ${id}`, '2');
    await click(`扩展任务预算 ${id}`);
    assert.equal((await run).id, id);
    await click('任务记录'); await click('刷新任务记录');
    const tree = JSON.stringify(page.toJSON());
    assert.match(tree, /CLIENT_BUDGET/);
    assert.match(tree, /token：12/);
    assert.match(tree, /USD/);
    assert.match(tree, /0.00004/);
    assert.match(tree, /2026-10-07/);
    assert.match(tree, /账单未确认/);
    await click('路由与预算'); await fill('每任务 token 上限', '0'); await click('保存新任务预算');
    run = submit(ctx, sessionId, 'Reply CLIENT_STOP');
    while ((await ctx.router.snapshot()).tasks.at(-1)?.lifecycle !== 'waiting-budget') await new Promise(resolve => setTimeout(resolve, 5));
    const stopId = (await ctx.router.snapshot()).tasks.at(-1).id;
    await click('刷新任务记录'); await click(`停止任务 ${stopId}`);
    assert.equal((await run).pauseReason, 'BUDGET_STOPPED');
    await ctx.router.setPriceQuote('router-controlled', 'controlled', null);
    await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [{ currency: 'USD', kind: 'api-calculated', amount: 0 }] });
    const unknown = await submit(ctx, sessionId, 'Reply UNKNOWN_MONEY');
    assert.equal(unknown.ledger.unknownPriceCalls, 1);
    await click('任务记录'); await click('刷新任务记录');
    assert.match(JSON.stringify(page.toJSON()), /缺少价格，费用未知/);
    assert.match(JSON.stringify(page.toJSON()), /无法完整执行金额上限/);
    assert.equal(mounted.errors.length, 0);
  } finally {
    if (run) { ctx.agents.get((await ctx.router.snapshot()).tasks.at(-1)?.sessionId)?.cancel({ kind: 'user' }); await run.catch(() => {}); }
    if (mounted) await mounted.dispose();
    await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true });
  }
});
