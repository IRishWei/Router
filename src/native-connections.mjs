const unknownCapability = () => ({ supported: null, confidence: 'unknown', source: 'host-public-contract' });

function safeSettings(ctx) {
  const settings = ctx.get('settings');
  if (!settings?.describe) return new Map();
  try {
    const described = settings.describe({ redactSecrets: true });
    const namespaces = Array.isArray(described) ? described : described?.namespaces;
    return new Map((namespaces ?? []).map(item => [item.ns, { revision: item.revision ?? null }]));
  } catch { return new Map(); }
}

/** Discover only metadata exposed by the public LLM/settings contracts. */
export async function discoverNativeConnections(ctx, ownedRoutes, signal) {
  signal?.throwIfAborted();
  const providers = ctx.llm.listProviders();
  const active = new Map(providers.map(provider => [provider.id, provider]));
  const directory = new Map(ctx.llm.listConfigurableProviders().map(entry => [entry.provider, entry]));
  const settings = safeSettings(ctx);
  const connections = [];
  const unsupported = [];
  for (const [provider, entry] of directory) {
    if (ownedRoutes.has(provider)) continue;
    if (!active.has(provider)) {
      unsupported.push({ provider, displayName: entry.displayName, source: 'native-configurable-directory', reason: 'PROVIDER_NOT_REGISTERED', settingsNs: entry.settingsNs, settingsPath: [...entry.settingsPath] });
    }
  }
  for (const providerInfo of providers) {
    signal?.throwIfAborted();
    if (ownedRoutes.has(providerInfo.id)) continue;
    const entry = directory.get(providerInfo.id);
    const settingsRevision = entry ? settings.get(entry.settingsNs)?.revision ?? null : null;
    const sourceKey = JSON.stringify([providerInfo.id, entry?.settingsNs ?? null, entry?.settingsPath ?? null, settingsRevision]);
    let models;
    try { models = await ctx.llm.listModels(providerInfo.id); }
    catch (error) {
      unsupported.push({ provider: providerInfo.id, displayName: providerInfo.name, source: 'native-provider', reason: 'MODEL_CATALOG_UNAVAILABLE', detail: typeof error?.code === 'string' ? error.code : 'UNKNOWN' });
      continue;
    }
    const candidates = [];
    for (const model of models) {
      signal?.throwIfAborted();
      let exact = null;
      try { exact = await ctx.llm.resolveModelInfo(providerInfo.id, model.id, signal); }
      catch { /* Catalog discovery remains valid; exact capabilities stay unknown. */ }
      const modalities = exact?.inputModalities ?? model.inputModalities;
      const declared = Array.isArray(modalities);
      const capability = {
        text: declared ? { supported: modalities.includes('text'), confidence: 'declared', source: 'provider-model-metadata' } : unknownCapability(),
        image: declared ? { supported: modalities.includes('image'), confidence: 'declared', source: 'provider-model-metadata' } : unknownCapability(),
        tools: unknownCapability(),
      };
      candidates.push({ model: model.id, name: model.name, capability, maxContextTokens: exact?.context?.contextWindow ?? null });
    }
    connections.push({
      provider: providerInfo.id,
      name: providerInfo.name,
      ownership: 'native-reference',
      source: entry ? 'native-configurable-provider' : 'native-provider',
      sourceKey,
      settingsNs: entry?.settingsNs ?? null,
      settingsPath: entry ? [...entry.settingsPath] : null,
      settingsRevision,
      configured: null,
      available: true,
      models: candidates,
    });
  }
  return { connections, unsupported };
}
