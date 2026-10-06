import { z } from 'zod';

// Strict JSON at the public RPC seam; task records may gain fields in later tickets.
const result = { mode: 'strict', typeSymbol: '@irishwei/dsh-router#Snapshot', create: () => z.object({ schemaVersion: z.literal(1), config: z.object({ automatic: z.boolean(), version: z.number().int().positive(), fixedModel: z.string().nullable().optional(), pool: z.array(z.json()).optional() }), application: z.json().optional(), tasks: z.array(z.json()), storageError: z.string().nullable(), models: z.array(z.json()) }) };
const parameter = (name, create) => ({ name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: `@irishwei/dsh-router#${name}`, create } });
const parameters = {
  snapshot: [],
  setAutomatic: [parameter('automatic', () => z.boolean())],
  setModelEnabled: [parameter('model', () => z.string()), parameter('enabled', () => z.boolean())],
  removeModel: [parameter('model', () => z.string())],
  setFixedModel: [parameter('model', () => z.string().nullable())],
};
export const descriptors = Object.keys(parameters).map(method => ({
  id: `@irishwei/dsh-router#router/${method}`, service: 'router', namespace: 'router', method,
  invocation: { kind: 'direct' },
  parameters: parameters[method],
  result,
}));
export const TYPERT = { package: '@irishwei/dsh-router', face: 'host', schemas: [], invocations: descriptors, model: { services: [], events: [], objects: [] } };
export const TYPERT_REMOTE = { package: '@irishwei/dsh-router', descriptors };
