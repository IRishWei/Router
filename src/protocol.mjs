import { z } from 'zod';

// Strict JSON at the public RPC seam; task records may gain fields in later tickets.
const result = { mode: 'strict', typeSymbol: '@irishwei/dsh-router#Snapshot', create: () => z.object({ schemaVersion: z.literal(1), config: z.object({ automatic: z.boolean(), version: z.number().int().positive() }), tasks: z.array(z.json()), storageError: z.string().nullable(), models: z.array(z.json()) }) };
export const descriptors = ['snapshot', 'setAutomatic'].map(method => ({
  id: `@irishwei/dsh-router#router/${method}`, service: 'router', namespace: 'router', method,
  invocation: { kind: 'direct' },
  parameters: method === 'setAutomatic' ? [{ name: 'automatic', wire: 'automatic', source: 'json', codec: { mode: 'strict', typeSymbol: 'boolean', create: () => z.boolean() } }] : [],
  result,
}));
export const TYPERT = { package: '@irishwei/dsh-router', face: 'host', schemas: [], invocations: descriptors, model: { services: [], events: [], objects: [] } };
export const TYPERT_REMOTE = { package: '@irishwei/dsh-router', descriptors };
