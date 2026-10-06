function candidateIdFor(entry, models) {
  if (entry.candidateId) return entry.candidateId;
  const model = models.find(item => item.model === entry.model
    && (!entry.connectionId || item.connectionId === entry.connectionId)
    && (!entry.accountId || item.accountId === entry.accountId)
    && (!entry.billingPath || item.billingPath === entry.billingPath)
    && (!entry.provider || item.provider === entry.provider));
  return model?.candidateId ?? entry.model;
}

export async function restoreRouterConfig(rpc, before) {
  const models = before.models ?? [];
  const pool = before.config.pool ?? [];
  const priorCandidateIds = new Set();
  for (const entry of pool) {
    const candidateId = candidateIdFor(entry, models);
    priorCandidateIds.add(candidateId);
    await rpc('router/setModelEnabled', { candidateId, enabled: entry.enabled });
  }
  for (const model of models) {
    if (priorCandidateIds.has(model.candidateId)) continue;
    const current = (await rpc('router/snapshot')).models.find(item => item.candidateId === model.candidateId);
    if (current?.inPool) await rpc('router/removeModel', { candidateId: model.candidateId });
  }
  const fixed = before.config.fixedCandidateId ?? before.config.fixedModel ?? null;
  if (fixed === null || models.some(model => model.candidateId === fixed && model.enabled && model.available)) {
    await rpc('router/setFixedModel', { candidateId: fixed });
  }
  await rpc('router/setAutomatic', { automatic: before.config.automatic });
}
