const fields = { input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens', reasoning: 'reasoningTokens', total: 'totalTokens' };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const emptyBudget = () => ({ tokens: null, durationMs: null, money: [] });
export function tokensOf(usage) {
  const tokens = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, count(usage?.[field])]));
  // A missing provider total is not reconstructed when reasoning overlap is unknown.
  if (tokens.total === null && tokens.reasoning === 0 && ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => tokens[key] !== null)) tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return tokens;
}
export function costOf(tokens, quote) {
  if (!quote) return { amount: null, knownSubtotal: null, reason: 'PRICE_UNKNOWN', billingConfirmation: 'unconfirmed' };
  const missing = [];
  const parts = {};
  if (quote.reasoning === 'unknown' && tokens.reasoning !== 0) missing.push('reasoning-overlap');
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (tokens[key] === null || (tokens[key] > 0 && quote.perMillion[key] === undefined)) { missing.push(key); parts[key] = null; }
    else parts[key] = tokens[key] * (quote.perMillion[key] ?? 0) / 1_000_000;
  }
  if (quote.reasoning === 'separate') {
    if (tokens.reasoning === null || (tokens.reasoning > 0 && quote.perMillion.reasoning === undefined)) { missing.push('reasoning'); parts.reasoning = null; }
    else parts.reasoning = tokens.reasoning * (quote.perMillion.reasoning ?? 0) / 1_000_000;
  }
  const knownSubtotal = Object.values(parts).reduce((sum, amount) => sum + (amount ?? 0), 0);
  return { currency: quote.currency, kind: quote.kind, amount: missing.length ? null : Number(knownSubtotal.toPrecision(15)), knownSubtotal, parts, missing, reasoning: quote.reasoning, billingConfirmation: 'unconfirmed' };
}
export function budgetCheck(task, proposed) {
  const ledger = ledgerOf({ ...task, calls: task.calls.filter(call => !call.reservation || ['settled', 'released'].includes(call.reservation.state)) });
  const limits = task.budget.limits;
  const blocked = [], unenforceable = [];
  const others = task.calls.filter(call => call !== proposed && call.reservation?.state === 'reserved');
  const forecast = proposed.reservation;
  if (limits.tokens !== null) {
    const reserved = others.reduce((sum, call) => sum + (call.reservation.tokens.total ?? 0), 0);
    if (ledger.knownTokens.total + reserved + (forecast.tokens.total ?? 0) > limits.tokens) blocked.push('tokens');
    if (forecast.tokens.total === null || ledger.unknownTokenCalls.total || others.some(call => call.reservation.tokens.total === null)) unenforceable.push('tokens: unknown usage or forecast; only known consumption is enforceable');
  }
  if (limits.durationMs !== null) {
    if (ledger.elapsedMs > limits.durationMs) blocked.push('durationMs');
    unenforceable.push('durationMs: next call duration unknown; only elapsed time can be checked');
  }
  for (const limit of limits.money) {
    const actual = ledger.money.find(item => item.currency === limit.currency && item.kind === limit.kind);
    const expected = forecast.money;
    const matches = expected.currency === limit.currency && expected.kind === limit.kind;
    const reserved = others.filter(call => call.reservation.money.currency === limit.currency && call.reservation.money.kind === limit.kind).reduce((sum, call) => sum + (call.reservation.money.amount ?? 0), 0);
    if ((actual?.knownSubtotal ?? 0) + reserved + (matches ? expected.amount ?? 0 : 0) > limit.amount) blocked.push(`money:${limit.currency}:${limit.kind}`);
    if (!matches || expected.amount === null || actual?.unknownCalls || ledger.unknownPriceCalls) unenforceable.push(`money:${limit.currency}:${limit.kind}: unknown usage, missing price or different currency; amount forecast cannot be enforced`);
  }
  return { blocked, unenforceable };
}
export function reserveRecord(usage, quote) {
  const tokens = tokensOf(usage);
  return { state: 'reserved', tokens, money: costOf(tokens, quote), durationMs: null, source: usage ? 'declared-call-forecast' : 'unknown', confidence: usage ? 'declared' : 'unknown' };
}
export function ledgerOf(task, now = Date.now()) {
  const calls = task.calls.filter(call => call.dispatchStarted || call.usage || (call.dispatchStarted === undefined && call.settlementSeq !== undefined));
  const known = Object.fromEntries(Object.keys(fields).map(key => [key, 0]));
  const unknown = Object.fromEntries(Object.keys(fields).map(key => [key, 0]));
  const money = new Map();
  let unknownPrices = 0;
  for (const call of calls) {
    const tokens = tokensOf(call.usage);
    for (const key of Object.keys(fields)) if (tokens[key] === null) unknown[key]++; else known[key] += tokens[key];
    const cost = costOf(tokens, call.priceQuote);
    if (!cost.currency) { unknownPrices++; continue; }
    const key = `${cost.currency}:${cost.kind}`;
    const total = money.get(key) ?? { currency: cost.currency, kind: cost.kind, amount: 0, knownSubtotal: 0, unknownCalls: 0, billingConfirmation: 'unconfirmed' };
    total.knownSubtotal += cost.knownSubtotal ?? 0;
    if (cost.amount === null) total.unknownCalls++; else total.amount += cost.amount;
    money.set(key, total);
  }
  const amounts = [...money.values()].map(item => ({ ...item, amount: item.unknownCalls ? null : Number(item.amount.toPrecision(15)), knownSubtotal: Number(item.knownSubtotal.toPrecision(15)) }));
  return { tokens: Object.fromEntries(Object.keys(fields).map(key => [key, unknown[key] ? null : known[key]])), knownTokens: known, unknownTokenCalls: unknown, money: amounts, unknownPriceCalls: unknownPrices, elapsedMs: Math.max(0, (task.endedAt ? Date.parse(task.endedAt) : now) - Date.parse(task.startedAt)), callCount: calls.length };
}
