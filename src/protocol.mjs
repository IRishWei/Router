import { z } from 'zod';

// Strict JSON at the public RPC seam; task records may gain fields in later tickets.
const rate = () => z.number().nonnegative().finite().max(Number.MAX_SAFE_INTEGER);
export const quoteSchema = () => z.object({ source: z.string().min(1).max(500), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value); }, 'A real calendar date is required'), currency: z.string().regex(/^[A-Z]{3}$/), kind: z.enum(['api-calculated', 'subscription-reference', 'fixture-reference']), confidence: z.enum(['known', 'declared']), perMillion: z.object({ input: rate(), output: rate(), cacheRead: rate().optional(), cacheWrite: rate().optional(), reasoning: rate().optional() }).strict(), reasoning: z.enum(['included-in-output', 'separate', 'unknown']) }).strict();
const moneyLimit = () => z.object({ currency: z.string().regex(/^[A-Z]{3}$/), kind: z.enum(['api-calculated', 'subscription-reference', 'fixture-reference']), amount: rate() }).strict();
export const budgetSchema = () => z.object({ tokens: z.number().int().nonnegative().safe().nullable(), durationMs: z.number().int().nonnegative().safe().nullable(), money: z.array(moneyLimit()).max(20) }).strict();
export const extensionSchema = () => z.object({ tokens: z.number().int().positive().safe().optional(), durationMs: z.number().int().positive().safe().optional(), money: z.array(moneyLimit()).max(20).optional() }).strict().refine(value => value.tokens || value.durationMs || value.money?.some(item => item.amount > 0), 'A positive extension is required');
export const acceptancePolicySchema = () => z.object({
  enabled: z.boolean(),
  review: z.object({
    enabled: z.boolean(),
    candidateId: z.string().min(1).max(200).nullable(),
    allowCrossModel: z.boolean(),
    maxTokens: z.number().int().positive().safe().max(4096),
    forecastTokens: z.number().int().positive().safe().max(65536),
  }).strict(),
}).strict().refine(value => value.review.forecastTokens >= value.review.maxTokens, { message: 'Review forecast must cover its output cap', path: ['review', 'forecastTokens'] });
const result = { mode: 'strict', typeSymbol: '@irishwei/dsh-router#Snapshot', create: () => z.object({ schemaVersion: z.literal(1), config: z.object({ automatic: z.boolean(), version: z.number().int().positive(), routingObjective: z.enum(['balanced', 'cost', 'tokens', 'speed', 'quality']).default('balanced'), semanticAssessment: z.boolean().default(false), acceptance: acceptancePolicySchema().optional(), fixedModel: z.string().nullable().optional(), fixedCandidateId: z.string().nullable().optional(), pool: z.array(z.json()).optional(), prices: z.array(z.json()).optional(), budget: z.json().optional() }), application: z.json().optional(), semanticAssessmentRequest: z.object({ status: z.literal('armed'), requestedAt: z.string() }).strict().nullable().optional(), calibrationPreview: z.json().optional(), candidateSnapshot: z.json().optional(), unsupportedProviders: z.array(z.json()).optional(), tasks: z.array(z.json()), blockedRequests: z.array(z.json()).optional(), storageError: z.string().nullable(), models: z.array(z.json()) }) };
const parameter = (name, create) => ({ name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: `@irishwei/dsh-router#${name}`, create } });
const parameters = {
  snapshot: [],
  refreshConnections: [],
  setAutomatic: [parameter('automatic', () => z.boolean())],
  setRoutingObjective: [parameter('objective', () => z.enum(['balanced', 'cost', 'tokens', 'speed', 'quality']))],
  setSemanticAssessment: [parameter('enabled', () => z.boolean())],
  setAcceptancePolicy: [parameter('policy', () => acceptancePolicySchema())],
  requestSemanticAssessment: [],
  previewCalibrationBudget: [],
  setModelEnabled: [parameter('candidateId', () => z.string()), parameter('enabled', () => z.boolean())],
  removeModel: [parameter('candidateId', () => z.string())],
  setFixedModel: [parameter('candidateId', () => z.string().nullable())],
  setPriceQuote: [parameter('candidateId', () => z.string().min(1).max(200)), parameter('quote', () => quoteSchema().nullable())],
  setBudgetDefaults: [parameter('budget', () => budgetSchema())],
  extendTaskBudget: [parameter('taskId', () => z.string()), parameter('extension', () => extensionSchema())],
  stopTask: [parameter('taskId', () => z.string())],
};
export const descriptors = Object.keys(parameters).map(method => ({
  id: `@irishwei/dsh-router#router/${method}`, service: 'router', namespace: 'router', method,
  invocation: { kind: 'direct' },
  parameters: parameters[method],
  result,
}));
export const TYPERT = { package: '@irishwei/dsh-router', face: 'host', schemas: [], invocations: descriptors, model: { services: [], events: [], objects: [] } };
export const TYPERT_REMOTE = { package: '@irishwei/dsh-router', descriptors };
