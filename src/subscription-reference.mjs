const DATE = '2026-10-09';
const PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';
const MODEL_SOURCE = 'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference';
const QUOTA_SOURCE = 'https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery';

// Reviewed Standard API text-token reference, USD per million; never a plan bill.
// Exact public IDs only. Display names, suffixes and aliases are not mappings.
const RATES = new Map([
  ['gpt-6-astra', [10, 1, 12.5, 50, 20, 2, 25, 75]],
  ['gpt-6.1-sol', [2, 0.1, 2.5, 10, 4, 0.2, 5, 15]],
  ['gpt-6-luna', [0.1, 0.01, 0.125, 0.5, 0.2, 0.02, 0.25, 0.75]],
  ['gpt-6-sol', [2, 0.2, 2.5, 10, 4, 0.4, 5, 15]],
  ['gpt-5.6-sol', [4, 0.4, 5, 20, 8, 0.8, 10, 30]],
  ['gpt-5.6-terra', [2, 0.2, 2.5, 12, 4, 0.4, 5, 18]],
  ['gpt-5.6-luna', [0.2, 0.02, 0.25, 1.2, 0.4, 0.04, 0.5, 1.8]],
]);
const ratesOf = ([input, cacheRead, cacheWrite, output]) => ({ input, cacheRead, cacheWrite, output });
export const isChatGptSubscription = candidate => candidate?.billingPath === 'chatgpt-subscription';

export function unknownSubscriptionQuota() {
  return { status: 'unknown', reason: 'NO_PUBLIC_QUOTA_CONTRACT', remainingRatio: null, resetAt: null, source: QUOTA_SOURCE, scarcityApplied: false };
}

/** Pure, versioned reference projection. No credentials, quota probes or inference. */
export function subscriptionReference(candidate) {
  if (!isChatGptSubscription(candidate)) return null;
  const trustedRoute = candidate.ownership === 'router-owned' && candidate.source === 'openai-chatgpt-oauth';
  const rates = trustedRoute ? RATES.get(candidate.model) : null;
  const mapping = { catalogModel: candidate.model, apiModel: rates ? candidate.model : null, confidence: rates ? 'exact' : 'unknown', source: MODEL_SOURCE, date: DATE };
  const subscription = { referenceStatus: rates ? 'mapped' : 'unknown', reason: rates ? 'EXACT_PUBLIC_MODEL_ID' : 'MODEL_MAPPING_UNKNOWN', usageFormat: trustedRoute ? 'openai-responses' : 'unknown', mapping, quota: unknownSubscriptionQuota() };
  if (!rates) return { subscription, quote: null, quoteVersion: null };
  return {
    subscription,
    quoteVersion: `openai-standard-text:${DATE}:${candidate.model}`,
    quote: {
      source: PRICING_SOURCE, date: DATE, currency: 'USD', kind: 'subscription-reference', confidence: 'known',
      referenceBasis: 'openai-standard-text-tokens',
      perMillion: ratesOf(rates), reasoning: 'included-in-output',
      // Official 272K input boundary, decimal tokens. Cache reads/writes count
      // toward the full prompt; output reasoning is already in outputTokens.
      contextPricing: { shortMaxInputTokens: 272_000, longPerMillion: ratesOf(rates.slice(4)) },
    },
  };
}
