import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreRouterConfig } from '../scripts/native-companion-config.mjs';

test('native companion verification restores the exact prior pool order', async () => {
  const state = {
    automatic: true,
    fixedCandidateId: 'companion',
    pool: [
      { candidateId: 'tools', enabled: true },
      { candidateId: 'controlled', enabled: true },
      { candidateId: 'companion', enabled: true },
    ],
  };
  const models = [
    { candidateId: 'controlled', enabled: true, available: true },
    { candidateId: 'tools', enabled: true, available: true },
    { candidateId: 'companion', enabled: false, available: false },
  ];
  const rpc = async (method, args) => {
    if (method === 'router/snapshot') {
      return { models: models.map(model => ({ ...model, inPool: state.pool.some(entry => entry.candidateId === model.candidateId) })) };
    }
    if (method === 'router/setModelEnabled') {
      state.pool = state.pool.filter(entry => entry.candidateId !== args.candidateId);
      state.pool.push({ candidateId: args.candidateId, enabled: args.enabled });
      return;
    }
    if (method === 'router/removeModel') {
      state.pool = state.pool.filter(entry => entry.candidateId !== args.candidateId);
      return;
    }
    if (method === 'router/setFixedModel') {
      state.fixedCandidateId = args.candidateId;
      return;
    }
    if (method === 'router/setAutomatic') {
      state.automatic = args.automatic;
      return;
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  await restoreRouterConfig(rpc, {
    config: {
      automatic: false,
      fixedCandidateId: 'tools',
      pool: [
        { candidateId: 'controlled', enabled: false },
        { candidateId: 'tools', enabled: true },
      ],
    },
    models,
  });

  assert.deepEqual(state.pool, [
    { candidateId: 'controlled', enabled: false },
    { candidateId: 'tools', enabled: true },
  ]);
  assert.equal(state.fixedCandidateId, 'tools');
  assert.equal(state.automatic, false);
});
