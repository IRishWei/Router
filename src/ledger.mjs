import { isChatGptSubscription, unknownSubscriptionQuota } from './subscription-reference.mjs';

const fields = { input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens', reasoning: 'reasoningTokens', total: 'totalTokens' };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const emptyBudget = () => ({ tokens: null, durationMs: null, money: [] });
export const possiblyDispatched = call => Boolean(call.dispatchStarted || call.dispatchIntent === 'possible' || call.dispatchUncertain);
/** Upgrade 0.3.0 string records at the storage boundary; current contracts are objects. */
export function normalizeBudgetConstraint(value, warning = false) {
  if (value && typeof value === 'object') return value;
  const resource = typeof value === 'string' && value.startsWith('tokens') ? 'tokens' : typeof value === 'string' && value.startsWith('durationMs') ? 'durationMs' : 'unknown';
  const money = typeof value === 'string' ? /^money:([A-Z]{3}):(api-calculated|subscription-reference|fixture-reference)(?::|$)/.exec(value) : null;
  const target = money ? { resource: 'money', currency: money[1], kind: money[2] } : { resource };
  return { ...target, reason: warning ? target.resource === 'tokens' ? 'UNKNOWN_USAGE_OR_FORECAST' : target.resource === 'durationMs' ? 'UNKNOWN_NEXT_CALL_DURATION' : target.resource === 'money' ? 'UNKNOWN_PRICE_USAGE_OR_CURRENCY' : 'LEGACY_UNKNOWN' : target.resource === 'durationMs' ? 'ELAPSED_LIMIT_EXCEEDED' : 'EXPECTED_LIMIT_EXCEEDED' };
}
export function tokensOf(usage) {
  const tokens = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, count(usage?.[field])]));
  // A missing provider total is not reconstructed when reasoning overlap is unknown.
  if (tokens.total === null && tokens.reasoning === 0 && ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => tokens[key] !== null)) tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return tokens;
}
export function costOf(tokens, quote, accounting = null) {
  if (!quote) return { amount: null, knownSubtotal: null, reason: 'PRICE_UNKNOWN', billingConfirmation: 'unconfirmed' };
  const missing = [];
  const parts = {};
  let rates = quote.perMillion;
  let basis;
  let incompleteInput = false;
  if (quote.contextPricing) {
    incompleteInput = ['input', 'cacheRead', 'cacheWrite'].some(key => tokens[key] === null);
    let prompt = incompleteInput ? null : tokens.input + tokens.cacheRead + tokens.cacheWrite;
    const reportedPrompt = accounting?.source === 'openai-responses-usage' ? count(accounting.aggregateInputTokens) : null;
    const promptConflict = prompt !== null && reportedPrompt !== null && prompt !== reportedPrompt;
    prompt = reportedPrompt ?? prompt;
    const inconsistent = promptConflict || (prompt !== null && !Number.isSafeInteger(prompt))
      || (quote.reasoning === 'included-in-output' && tokens.reasoning !== null && tokens.output !== null && tokens.reasoning > tokens.output)
      || (prompt !== null && tokens.output !== null && tokens.total !== null && prompt + tokens.output !== tokens.total);
    const band = prompt === null || inconsistent ? 'unknown' : prompt > quote.contextPricing.shortMaxInputTokens ? 'long' : 'short';
    basis = { profile: quote.referenceBasis ?? 'context-tiered', contextBand: band, promptTokens: inconsistent ? null : prompt, shortMaxInputTokens: quote.contextPricing.shortMaxInputTokens };
    if (inconsistent) return { currency: quote.currency, kind: quote.kind, amount: null, knownSubtotal: null, parts: {}, missing: ['usage-inconsistent'], reason: 'USAGE_INCONSISTENT', reasoning: quote.reasoning, basis, billingConfirmation: 'unconfirmed' };
    if (band === 'long') rates = quote.contextPricing.longPerMillion;
    else if (band === 'unknown') {
      missing.push('context-band');
      // Even when the tier is unknown, independently reported output/cache
      // still prove a lower bound at the minimum applicable published rate.
      rates = Object.fromEntries(Object.keys(quote.perMillion).filter(key => quote.contextPricing.longPerMillion[key] !== undefined).map(key => [key, Math.min(quote.perMillion[key], quote.contextPricing.longPerMillion[key])]));
      basis.subtotalBasis = 'minimum-context-rates';
    }
  }
  if (quote.reasoning === 'unknown' && tokens.reasoning !== 0) missing.push('reasoning-overlap');
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if ((key === 'input' && incompleteInput) || tokens[key] === null || (tokens[key] > 0 && rates[key] === undefined)) { missing.push(key); parts[key] = null; }
    else parts[key] = tokens[key] * (rates[key] ?? 0) / 1_000_000;
  }
  if (quote.reasoning === 'separate') {
    if (tokens.reasoning === null || (tokens.reasoning > 0 && rates.reasoning === undefined)) { missing.push('reasoning'); parts.reasoning = null; }
    else parts.reasoning = tokens.reasoning * (rates.reasoning ?? 0) / 1_000_000;
  }
  const knownParts = Object.values(parts).filter(amount => amount !== null);
  const knownSubtotal = knownParts.length ? Number(knownParts.reduce((sum, amount) => sum + amount, 0).toPrecision(15)) : null;
  return { currency: quote.currency, kind: quote.kind, amount: missing.length ? null : knownSubtotal, knownSubtotal, parts, missing, ...(missing.length ? { reason: 'USAGE_INCOMPLETE' } : {}), reasoning: quote.reasoning, ...(basis ? { basis } : {}), billingConfirmation: 'unconfirmed' };
}
export function budgetCheck(task, proposed) {
  const ledger = ledgerOf({ ...task, calls: task.calls.filter(call => !call.reservation || ['settled', 'released'].includes(call.reservation.state)) });
  const limits = task.budget.limits;
  const blocked = [], unenforceable = [];
  const others = task.calls.filter(call => call !== proposed && call.reservation?.state === 'reserved');
  const forecast = proposed.reservation;
  if (limits.tokens !== null) {
    const reserved = others.reduce((sum, call) => sum + (call.reservation.tokens.total ?? 0), 0);
    if (ledger.knownTokens.total + reserved + (forecast.tokens.total ?? 0) > limits.tokens) blocked.push({ resource: 'tokens', reason: 'EXPECTED_LIMIT_EXCEEDED' });
    if (forecast.tokens.total === null || ledger.unknownTokenCalls.total || others.some(call => call.reservation.tokens.total === null)) unenforceable.push({ resource: 'tokens', reason: 'UNKNOWN_USAGE_OR_FORECAST' });
  }
  if (limits.durationMs !== null) {
    if (ledger.elapsedMs > limits.durationMs) blocked.push({ resource: 'durationMs', reason: 'ELAPSED_LIMIT_EXCEEDED' });
    unenforceable.push({ resource: 'durationMs', reason: 'UNKNOWN_NEXT_CALL_DURATION' });
  }
  for (const limit of limits.money) {
    const actual = ledger.money.find(item => item.currency === limit.currency && item.kind === limit.kind);
    const expected = forecast.money;
    const matches = expected.currency === limit.currency && expected.kind === limit.kind;
    const reserved = others.filter(call => call.reservation.money.currency === limit.currency && call.reservation.money.kind === limit.kind).reduce((sum, call) => sum + (call.reservation.money.amount ?? call.reservation.money.knownSubtotal ?? 0), 0);
    if ((actual?.knownSubtotal ?? 0) + reserved + (matches ? expected.amount ?? expected.knownSubtotal ?? 0 : 0) > limit.amount) blocked.push({ resource: 'money', currency: limit.currency, kind: limit.kind, reason: 'EXPECTED_LIMIT_EXCEEDED' });
    if (!matches || expected.amount === null || actual?.unknownCalls || ledger.unknownPriceCalls || others.some(call => call.reservation.money.currency === limit.currency && call.reservation.money.kind === limit.kind && call.reservation.money.amount === null)) unenforceable.push({ resource: 'money', currency: limit.currency, kind: limit.kind, reason: 'UNKNOWN_PRICE_USAGE_OR_CURRENCY' });
  }
  return { blocked, unenforceable };
}
export function reserveRecord(usage, quote) {
  const tokens = tokensOf(usage);
  return { state: 'reserved', tokens, money: costOf(tokens, quote), durationMs: null, source: usage ? 'declared-call-forecast' : 'unknown', confidence: usage ? 'declared' : 'unknown' };
}
export function ledgerOf(task, now = Date.now()) {
  const calls = task.calls.filter(call => possiblyDispatched(call) || call.usage || (call.dispatchStarted === undefined && call.settlementSeq !== undefined));
  const known = Object.fromEntries(Object.keys(fields).map(key => [key, 0]));
  const unknown = Object.fromEntries(Object.keys(fields).map(key => [key, 0]));
  const money = new Map();
  const subscriptionQuota = new Map();
  let unknownPrices = 0;
  for (const call of calls) {
    if (isChatGptSubscription(call.selection)) subscriptionQuota.set(call.selection.accountId, { accountId: call.selection.accountId, ...(call.subscription?.quota ?? unknownSubscriptionQuota()) });
    const tokens = tokensOf(call.usage);
    for (const key of Object.keys(fields)) if (tokens[key] === null) unknown[key]++; else known[key] += tokens[key];
    let cost = costOf(tokens, call.priceQuote, call.usageAccounting);
    if (!cost.currency) {
      unknownPrices++;
      if (!isChatGptSubscription(call.selection)) continue;
      // USD is the reference policy's comparison currency, not a known price.
      // An unmapped subscription call makes the whole reference total unknown.
      cost = { ...cost, currency: 'USD', kind: 'subscription-reference' };
    }
    const key = `${cost.currency}:${cost.kind}`;
    const total = money.get(key) ?? { currency: cost.currency, kind: cost.kind, amount: 0, knownSubtotal: 0, knownSubtotalCalls: 0, unknownCalls: 0, billingConfirmation: 'unconfirmed' };
    total.knownSubtotal += cost.knownSubtotal ?? 0;
    if (cost.knownSubtotal !== null && cost.knownSubtotal !== undefined) total.knownSubtotalCalls++;
    if (cost.amount === null) total.unknownCalls++; else total.amount += cost.amount;
    money.set(key, total);
  }
  const amounts = [...money.values()].map(item => ({ ...item, amount: item.unknownCalls ? null : Number(item.amount.toPrecision(15)), knownSubtotal: item.knownSubtotalCalls ? Number(item.knownSubtotal.toPrecision(15)) : null }));
  return { tokens: Object.fromEntries(Object.keys(fields).map(key => [key, unknown[key] ? null : known[key]])), knownTokens: known, unknownTokenCalls: unknown, money: amounts, unknownPriceCalls: unknownPrices, actualSpend: { status: 'unknown', amount: null, currency: null, reason: 'NO_CONFIRMED_PROVIDER_BILL' }, subscriptionQuota: [...subscriptionQuota.values()], elapsedMs: Math.max(0, (task.endedAt ? Date.parse(task.endedAt) : now) - Date.parse(task.startedAt)), callCount: calls.length, uncertainDispatchCalls: calls.filter(call => possiblyDispatched(call) && !call.dispatchStarted && !call.usage).length };
}
