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
export const coordinationPolicySchema = () => z.object({
  enabled: z.boolean(),
  candidateId: z.string().min(1).max(200).nullable(),
  allowCrossModel: z.boolean(),
  allowFixedModel: z.boolean(),
  maxTokens: z.number().int().positive().safe().max(4096),
  maxAdviceChars: z.number().int().positive().safe().max(16384),
  forecastTokens: z.number().int().positive().safe().max(65536),
}).strict().refine(value => value.forecastTokens >= value.maxTokens, { message: 'Consultation forecast must cover its output cap', path: ['forecastTokens'] });
const result = { mode: 'strict', typeSymbol: '@irishwei/dsh-router#Snapshot', create: () => z.object({ schemaVersion: z.literal(1), config: z.object({ automatic: z.boolean(), version: z.number().int().positive(), routingObjective: z.enum(['balanced', 'cost', 'tokens', 'speed', 'quality']).default('balanced'), semanticAssessment: z.boolean().default(false), acceptance: acceptancePolicySchema().optional(), coordination: coordinationPolicySchema().optional(), fixedModel: z.string().nullable().optional(), fixedCandidateId: z.string().nullable().optional(), pool: z.array(z.json()).optional(), prices: z.array(z.json()).optional(), budget: z.json().optional() }), application: z.json().optional(), semanticAssessmentRequest: z.object({ status: z.literal('armed'), requestedAt: z.string() }).strict().nullable().optional(), calibrationPreview: z.json().optional(), candidateSnapshot: z.json().optional(), unsupportedProviders: z.array(z.json()).optional(), deepSeek: z.json().optional(), chatGpt: z.json().optional(), tasks: z.array(z.json()), blockedRequests: z.array(z.json()).optional(), storageError: z.string().nullable(), models: z.array(z.json()) }) };
const authorizationStartResult = { mode: 'strict', typeSymbol: '@irishwei/dsh-router#ChatGptAuthorizationStart', create: () => z.object({ attemptId: z.string().uuid(), authorizationURL: z.string().url().max(16_384) }).strict() };
const parameter = (name, create) => ({ name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: `@irishwei/dsh-router#${name}`, create } });
const parameters = {
  snapshot: [],
  refreshConnections: [],
  setAutomatic: [parameter('automatic', () => z.boolean())],
  setRoutingObjective: [parameter('objective', () => z.enum(['balanced', 'cost', 'tokens', 'speed', 'quality']))],
  setSemanticAssessment: [parameter('enabled', () => z.boolean())],
  setAcceptancePolicy: [parameter('policy', () => acceptancePolicySchema())],
  setCoordinationPolicy: [parameter('policy', () => coordinationPolicySchema())],
  requestSemanticAssessment: [],
  previewCalibrationBudget: [],
  setModelEnabled: [parameter('candidateId', () => z.string()), parameter('enabled', () => z.boolean())],
  removeModel: [parameter('candidateId', () => z.string())],
  setFixedModel: [parameter('candidateId', () => z.string().nullable())],
  setPriceQuote: [parameter('candidateId', () => z.string().min(1).max(200)), parameter('quote', () => quoteSchema().nullable())],
  setBudgetDefaults: [parameter('budget', () => budgetSchema())],
  extendTaskBudget: [parameter('taskId', () => z.string()), parameter('extension', () => extensionSchema())],
  stopTask: [parameter('taskId', () => z.string())],
  deepSeekSaveCredential: [parameter('request', () => z.object({ apiKey: z.string().min(1).max(4096) }).strict())],
  deepSeekDiscoverCatalog: [],
  deepSeekConnect: [parameter('request', () => z.object({ accountId: z.string().min(1).max(500) }).strict())],
  deepSeekDisconnect: [parameter('request', () => z.object({ connectionId: z.string().min(1).max(500), deleteCredential: z.boolean() }).strict())],
  deepSeekRunDetection: [parameter('request', () => z.object({ candidateId: z.string().min(1).max(500), budget: z.object({ tokens: z.number().int().positive().safe().max(4096), durationMs: z.number().int().positive().safe().max(60_000) }).strict() }).strict())],
  chatGptStartAuthorization: [],
  chatGptCancelAuthorization: [],
  chatGptConnect: [],
  chatGptDisconnect: [parameter('request', () => z.object({ deleteCredential: z.boolean() }).strict())],
  chatGptRunDetection: [parameter('request', () => z.object({ candidateId: z.string().min(1).max(500), budget: z.object({ tokens: z.number().int().positive().safe().max(65_536), durationMs: z.number().int().positive().safe().max(120_000) }).strict() }).strict())],
};
export const descriptors = Object.keys(parameters).map(method => ({
  id: `@irishwei/dsh-router#router/${method}`, service: 'router', namespace: 'router', method,
  invocation: { kind: 'direct' },
  parameters: parameters[method],
  result: method === 'chatGptStartAuthorization' ? authorizationStartResult : result,
}));
export const TYPERT = { package: '@irishwei/dsh-router', face: 'host', schemas: [], invocations: descriptors, model: { services: [], events: [], objects: [] } };
export const TYPERT_REMOTE = { package: '@irishwei/dsh-router', descriptors };
