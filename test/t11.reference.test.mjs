import assert from 'node:assert/strict';
import test from 'node:test';
import { subscriptionReference } from '../src/subscription-reference.mjs';
import { costOf, ledgerOf, tokensOf } from '../src/ledger.mjs';
import { quoteSchema } from '../src/protocol.mjs';
import { ConnectionRegistry } from '../src/connections.mjs';
import { chatGptOwnedSource } from '../src/chatgpt-router.mjs';

const candidate = { model: 'gpt-6.1-sol', billingPath: 'chatgpt-subscription', ownership: 'router-owned', source: 'openai-chatgpt-oauth' };
const reference = () => subscriptionReference(candidate);
const usage = { inputTokens: 700, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 50, reasoningTokens: 30, totalTokens: 1050 };

test('only an exact public model ID on the official subscription source receives a versioned reference', () => {
  const mapped = reference();
  assert.equal(quoteSchema().safeParse(mapped.quote).success, true);
  assert.equal(mapped.quote.kind, 'subscription-reference');
  assert.equal(mapped.quote.source, 'https://developers.openai.com/api/docs/pricing');
  assert.equal(mapped.subscription.mapping.date, '2026-10-09');
  assert.equal(mapped.subscription.mapping.confidence, 'exact');
  assert.equal(mapped.subscription.mapping.apiModel, 'gpt-6.1-sol');
  for (const model of ['sol-latest', 'gpt-6.1-sol-fast', 'GPT-6.1-SOL', 'gpt-6.1-sol ', 'gpt-6.1-sol-2026-10-09']) {
    const unknown = subscriptionReference({ ...candidate, model, name: 'GPT-6.1 Sol' });
    assert.equal(unknown.quote, null);
    assert.equal(unknown.subscription.mapping.confidence, 'unknown');
  }
  assert.equal(subscriptionReference({ ...candidate, source: 'community-provider' }).quote, null);
  assert.equal(subscriptionReference({ ...candidate, source: 'community-provider' }).subscription.usageFormat, 'unknown');
  assert.equal(subscriptionReference({ ...candidate, billingPath: 'api' }), null);
  mapped.quote.perMillion.input = 999;
  assert.equal(reference().quote.perMillion.input, 2);
});

test('legacy manual prices cannot turn an unknown ChatGPT alias into a known price or replace the frozen API reference', () => {
  const config = { pool: [], prices: [] };
  const registry = new ConnectionRegistry({ llm: { listProviders: () => [{ id: 'official-chatgpt' }] } }, {}, () => config);
  registry.registerOwned(chatGptOwnedSource({ provider: 'official-chatgpt', accountId: 'account-test', connectionId: 'connection-test', configRevision: 1, models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol' }, { slug: 'sol-latest', display_name: 'Sol' }] }));
  for (const entry of registry.snapshot().candidates) config.prices.push({ candidateId: entry.candidateId, ...entry.identity, quoteVersion: 'legacy-manual', quote: { ...reference().quote, kind: 'api-calculated', perMillion: { input: 0, output: 0 } } });
  for (const entry of registry.snapshot().candidates) {
    const capture = registry.capture(entry.candidateId);
    if (entry.model === 'sol-latest') {
      assert.equal(entry.quote, null);
      assert.equal(capture.quote, null);
      assert.equal(capture.subscription.referenceStatus, 'unknown');
    } else {
      assert.equal(entry.quote.kind, 'subscription-reference');
      assert.equal(capture.quote.perMillion.input, 2);
      assert.notEqual(capture.quoteVersion, 'legacy-manual');
    }
  }
});

test('cache input is disjoint and included output reasoning is never charged twice', () => {
  const cost = costOf(tokensOf(usage), reference().quote);
  assert.equal(cost.amount, 0.00217);
  assert.deepEqual(cost.parts, { input: 0.0014, output: 0.0005, cacheRead: 0.00002, cacheWrite: 0.00025 });
  assert.equal(cost.basis.promptTokens, 1000);
  assert.equal(cost.basis.contextBand, 'short');
  assert.equal(cost.billingConfirmation, 'unconfirmed');
  assert.equal(costOf(tokensOf({ ...usage, reasoningTokens: undefined }), reference().quote).amount, cost.amount);
});

test('context pricing uses the whole prompt including cache at and above the official boundary', () => {
  const at = { inputTokens: 100_000, cacheReadTokens: 100_000, cacheWriteTokens: 72_000, outputTokens: 10, reasoningTokens: 5, totalTokens: 272_010 };
  const above = { ...at, cacheWriteTokens: 72_001, totalTokens: 272_011 };
  assert.equal(costOf(tokensOf(at), reference().quote).amount, 0.3901);
  const cost = costOf(tokensOf(above), reference().quote);
  assert.equal(cost.basis.contextBand, 'long');
  assert.equal(cost.basis.promptTokens, 272_001);
  assert.equal(cost.amount, 0.780155);
});

test('missing partitions retain proven output/cache lower bounds while contradictions stay unknown', () => {
  for (const [partial, subtotal] of [[{ ...usage, cacheWriteTokens: undefined }, 0.00052], [{ ...usage, inputTokens: undefined }, 0.00077]]) {
    const cost = costOf(tokensOf(partial), reference().quote);
    assert.equal(cost.amount, null);
    assert.equal(cost.knownSubtotal, subtotal);
    assert.equal(cost.parts.input, null);
    assert.equal(cost.reason, 'USAGE_INCOMPLETE');
    assert.equal(cost.basis.contextBand, 'unknown');
  }
  const partial = costOf(tokensOf({ ...usage, inputTokens: undefined, cacheWriteTokens: undefined }), reference().quote, { source: 'openai-responses-usage', aggregateInputTokens: 1000 });
  assert.equal(partial.basis.contextBand, 'short');
  assert.equal(partial.basis.promptTokens, 1000);
  assert.equal(partial.amount, null);
  assert.equal(partial.knownSubtotal, 0.00052);
  assert.equal(costOf(tokensOf(null), reference().quote).knownSubtotal, null);
  for (const invalid of [{ ...usage, reasoningTokens: 51 }, { ...usage, totalTokens: 1051 }]) {
    const cost = costOf(tokensOf(invalid), reference().quote);
    assert.equal(cost.amount, null);
    assert.equal(cost.knownSubtotal, null);
    assert.equal(cost.reason, 'USAGE_INCONSISTENT');
  }
});

test('one unmapped subscription call keeps a mixed Task reference total unknown and bills separate', () => {
  const call = { dispatchStarted: true, usage, selection: { ...candidate, accountId: 'account-test' }, priceQuote: reference().quote, subscription: reference().subscription };
  const task = { startedAt: new Date().toISOString(), calls: [call, { ...call, priceQuote: null, selection: { ...call.selection, model: 'sol-latest' }, subscription: subscriptionReference({ ...candidate, model: 'sol-latest' }).subscription }] };
  const ledger = ledgerOf(task);
  assert.deepEqual(ledger.money.map(({ currency, kind, amount, knownSubtotal, unknownCalls }) => ({ currency, kind, amount, knownSubtotal, unknownCalls })), [{ currency: 'USD', kind: 'subscription-reference', amount: null, knownSubtotal: 0.00217, unknownCalls: 1 }]);
  assert.equal(ledger.unknownPriceCalls, 1);
  assert.equal(ledger.actualSpend.amount, null);
  assert.equal(ledger.actualSpend.status, 'unknown');
  assert.equal(ledger.subscriptionQuota.length, 1);
  assert.deepEqual(ledger.subscriptionQuota[0], { accountId: 'account-test', ...reference().subscription.quota });
  assert.equal(ledger.subscriptionQuota[0].remainingRatio, null);
  assert.equal(ledger.subscriptionQuota[0].scarcityApplied, false);
});

test('API calculated cost and subscription reference value stay in separate monetary groups', () => {
  const call = { dispatchStarted: true, usage, selection: { ...candidate, accountId: 'account-test' }, priceQuote: reference().quote, subscription: reference().subscription };
  const ledger = ledgerOf({ startedAt: new Date().toISOString(), calls: [call, { ...call, subscription: undefined, selection: { ...call.selection, billingPath: 'api' }, priceQuote: { ...call.priceQuote, kind: 'api-calculated' } }] });
  assert.deepEqual(ledger.money.map(item => [item.kind, item.amount]), [['subscription-reference', 0.00217], ['api-calculated', 0.00217]]);
  assert.equal(ledger.actualSpend.amount, null);
  assert.equal(ledger.subscriptionQuota.length, 1);
});
