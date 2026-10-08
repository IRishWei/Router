import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react-test-renderer';
import { referenceFixture, REFERENCE_USAGE } from './t11-harness.mjs';
import { mountSettings } from './client-harness.mjs';

test('full subscription Task freezes exact pricing and real returned partitions; restart and Renderer preserve the explanation', async () => {
  const f = await referenceFixture();
  let mounted;
  try {
    const defaultBefore = f.ctx.agentDefaultModel.currentSelection();
    const task = await f.task();
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.result, 'REFERENCE_OK');
    assert.equal(task.calls.length, 1);
    const call = task.calls[0];
    assert.deepEqual(call.usage, { inputTokens: 700, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 100, reasoningTokens: 30, totalTokens: 1050 });
    assert.equal(call.cost.amount, 0.00217);
    assert.deepEqual(call.usageAccounting, { aggregateInputTokens: 1000, source: 'openai-responses-usage', inputPartitions: 'complete' });
    assert.equal(call.priceQuote.kind, 'subscription-reference');
    assert.equal(call.quoteVersion, 'openai-standard-text:2026-10-09:gpt-6.1-sol');
    assert.equal(call.subscription.mapping.confidence, 'exact');
    assert.equal(task.ledger.money[0].amount, 0.00217);
    assert.equal(task.ledger.actualSpend.amount, null);
    assert.equal(task.ledger.subscriptionQuota[0].remainingRatio, null);
    assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(), defaultBefore);
    await assert.rejects(f.ctx.router.setPriceQuote(f.candidate.candidateId, { ...call.priceQuote, kind: 'api-calculated' }), /reviewed official model mapping/u);
    await f.restart();
    const snapshot = await f.ctx.router.snapshot();
    const restored = snapshot.tasks.find(item => item.id === task.id);
    assert.deepEqual(restored.calls[0].priceQuote, call.priceQuote);
    assert.deepEqual(restored.calls[0].subscription, call.subscription);
    assert.equal(restored.ledger.money[0].amount, 0.00217);
    mounted = await mountSettings(snapshot);
    await act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes('任务记录')).props.onClick(); });
    const tree = JSON.stringify(mounted.page.toJSON());
    for (const pattern of [/订阅参考价值/u, /0.00217/u, /精确同名/u, /2026-10-09/u, /Standard API/u, /推理已包含于输出/u, /实际账单支出：未知/u, /套餐额度占比：未知/u, /未用于稀缺性排序/u, /不能据此证明现金节省/u]) assert.match(tree, pattern);
    assert.equal(mounted.errors.length, 0);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
    assert.equal(f.remote.requests.some(item => !['/models', '/responses'].includes(item.path)), false);
  } finally { if (mounted) await mounted.dispose(); await f.close(); }
});

test('full alias Task remains unpriced and ignores an unrelated zero cash cap without claiming free usage', async () => {
  const f = await referenceFixture({ model: 'sol-latest' });
  let mounted;
  try {
    await f.ctx.router.setBudgetDefaults({ tokens: 65_536, durationMs: null, money: [{ currency: 'USD', kind: 'api-calculated', amount: 0 }] });
    const task = await f.task();
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.calls[0].priceQuote, null);
    assert.equal(task.calls[0].subscription.mapping.apiModel, null);
    assert.equal(task.calls[0].cost.amount, null);
    assert.equal(task.ledger.money[0].kind, 'subscription-reference');
    assert.equal(task.ledger.money[0].amount, null);
    assert.equal(task.ledger.money[0].knownSubtotal, null);
    assert.equal(task.ledger.unknownPriceCalls, 1);
    assert.equal(task.budget.unenforceableLimits.some(item => item.resource === 'money' && item.kind === 'api-calculated'), true);
    mounted = await mountSettings(await f.ctx.router.snapshot());
    await act(async () => { await mounted.page.root.findAllByType('button').find(item => item.children.includes('任务记录')).props.onClick(); });
    const tree = JSON.stringify(mounted.page.toJSON());
    assert.match(tree, /尚未确认此模型或别名对应的 API 价格映射/u);
    assert.match(tree, /订阅参考价值：USD 未知/u);
    assert.doesNotMatch(tree, /订阅参考价值：USD 0(?:["（ ·])/u);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
  } finally { if (mounted) await mounted.dispose(); await f.close(); }
});

test('an unpriced full tool Task still waits on its explicit consumed-token limit and resumes the same Task', async () => {
  const f = await referenceFixture({ model: 'sol-latest', toolRoundTrip: true });
  let run;
  try {
    f.ctx.tools.register({ name: 'reference_echo', description: 'Controlled reference evidence', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'REFERENCE_TOOL_OK'; } });
    f.ctx.systemPrompt.tools(() => ({ schemas: f.ctx.tools.schemas() }));
    await f.ctx.router.setBudgetDefaults({ tokens: 1000, durationMs: 5_000, money: [{ currency: 'USD', kind: 'subscription-reference', amount: 0 }] });
    run = f.task();
    let waiting;
    const until = Date.now() + 3000;
    do {
      waiting = (await f.ctx.router.snapshot()).tasks.at(-1);
      if (waiting?.lifecycle === 'waiting-budget') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    } while (Date.now() < until);
    assert.equal(waiting?.lifecycle, 'waiting-budget');
    assert.equal(waiting.ledger.tokens.total, 1050);
    assert.equal(waiting.ledger.money[0].amount, null);
    assert.equal(waiting.budget.waiting.blockedBy.some(item => item.resource === 'tokens'), true);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
    await f.ctx.router.extendTaskBudget(waiting.id, { tokens: 1500 });
    const done = await run;
    assert.equal(done.id, waiting.id);
    assert.equal(done.lifecycle, 'completed');
    assert.equal(done.result, 'REFERENCE_OK');
    assert.equal(done.calls.length, 2);
    assert.equal(done.ledger.tokens.total, 2100);
    assert.equal(done.ledger.money[0].amount, null);
    assert.equal(done.ledger.actualSpend.amount, null);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 2);
  } finally {
    if (run) { const task = (await f.ctx.router.snapshot()).tasks.at(-1); if (task?.lifecycle === 'waiting-budget') await f.ctx.router.stopTask(task.id); await run.catch(() => {}); }
    await f.close();
  }
});

test('partial cache usage preserves its proven subtotal and blocks the next tool request at an explicit money limit', async () => {
  const f = await referenceFixture({ usage: { ...REFERENCE_USAGE, input_tokens_details: { cached_tokens: 200 } }, toolRoundTrip: true });
  let run;
  try {
    f.ctx.tools.register({ name: 'reference_echo', description: 'Controlled reference evidence', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'REFERENCE_TOOL_OK'; } });
    f.ctx.systemPrompt.tools(() => ({ schemas: f.ctx.tools.schemas() }));
    await f.ctx.router.setBudgetDefaults({ tokens: 65_536, durationMs: 5_000, money: [{ currency: 'USD', kind: 'subscription-reference', amount: 0 }] });
    run = f.task();
    let waiting; const until = Date.now() + 3000;
    do { waiting = (await f.ctx.router.snapshot()).tasks.at(-1); if (waiting?.lifecycle === 'waiting-budget') break; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < until);
    assert.equal(waiting?.lifecycle, 'waiting-budget');
    assert.equal(waiting.calls[0].cost.amount, null);
    assert.equal(waiting.calls[0].cost.knownSubtotal, 0.00052);
    assert.equal(waiting.ledger.money[0].amount, null);
    assert.equal(waiting.ledger.money[0].knownSubtotal, 0.00052);
    assert.equal(waiting.budget.waiting.blockedBy.some(item => item.resource === 'money' && item.kind === 'subscription-reference'), true);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
    await f.ctx.router.extendTaskBudget(waiting.id, { money: [{ currency: 'USD', kind: 'subscription-reference', amount: 0.01 }] });
    const done = await run;
    assert.equal(done.id, waiting.id); assert.equal(done.lifecycle, 'completed');
    assert.equal(done.ledger.money[0].amount, null); assert.equal(done.ledger.money[0].knownSubtotal, 0.00104);
    assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 2);
  } finally { if (run) { const task = (await f.ctx.router.snapshot()).tasks.at(-1); if (task?.lifecycle === 'waiting-budget') await f.ctx.router.stopTask(task.id); await run.catch(() => {}); } await f.close(); }
});

for (const [name, usage, expectedReason] of [
  ['missing cache write', { ...REFERENCE_USAGE, input_tokens_details: { cached_tokens: 200 } }, 'USAGE_INCOMPLETE'],
  ['missing all usage', null, 'USAGE_INCOMPLETE'],
  ['inconsistent reasoning', { ...REFERENCE_USAGE, output_tokens_details: { reasoning_tokens: 51 } }, 'USAGE_INCONSISTENT'],
]) {
  test(`full Task ${name} preserves unknown reference and explicit quota state`, async () => {
    const f = await referenceFixture({ usage });
    try {
      const task = await f.task();
      assert.equal(task.lifecycle, 'completed');
      assert.equal(task.calls[0].cost.amount, null);
      assert.equal(task.calls[0].cost.reason, expectedReason);
      assert.equal(task.ledger.money[0].amount, null);
      assert.equal(task.ledger.money[0].knownSubtotal, name === 'missing cache write' ? 0.00052 : null);
      assert.equal(task.ledger.subscriptionQuota[0].status, 'unknown');
      assert.equal(task.ledger.subscriptionQuota[0].scarcityApplied, false);
      if (name === 'missing cache write') {
        assert.equal(task.calls[0].usage.inputTokens, undefined);
        assert.equal(task.calls[0].usageAccounting.aggregateInputTokens, 1000);
        assert.equal(task.calls[0].usageAccounting.inputPartitions, 'incomplete');
        assert.equal(task.ledger.tokens.input, null);
        assert.equal(task.ledger.tokens.cacheWrite, null);
        assert.equal(task.ledger.tokens.total, 1050);
      }
      assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
    } finally { await f.close(); }
  });
}
