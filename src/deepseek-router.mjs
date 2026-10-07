import { mountDeepSeekOwnedProvider } from './deepseek-connections.mjs';

const PUBLIC_AUTHORIZATION = new Set(['unknown', 'configured', 'authorized', 'unauthorized', 'error']);

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function supportFact(capability, source) {
  if (!capability || !['declared', 'unsupported', 'unknown'].includes(capability.status)) {
    throw new TypeError('DeepSeek capability metadata is invalid');
  }
  return {
    supported: capability.status === 'unknown' ? null : capability.status === 'declared',
    confidence: capability.status === 'unknown' ? 'unknown' : 'declared',
    source,
  };
}

/** Project private provider metadata into the single public registerOwned contract. */
export function deepSeekOwnedSource(metadata) {
  if (!metadata || metadata.ownership !== 'router-owned' || !Array.isArray(metadata.catalog?.models)) {
    throw new TypeError('DeepSeek connection metadata is invalid');
  }
  const authorizationStatus = metadata.providerAuthorization?.status;
  if (!PUBLIC_AUTHORIZATION.has(authorizationStatus)) throw new TypeError('DeepSeek authorization metadata is invalid');
  const capabilitySource = requiredString(metadata.catalog.source, 'metadata.catalog.source');
  return {
    provider: requiredString(metadata.provider, 'metadata.provider'),
    connectionId: requiredString(metadata.connectionId, 'metadata.connectionId'),
    accountId: requiredString(metadata.accountId, 'metadata.accountId'),
    billingPath: requiredString(metadata.billingPath, 'metadata.billingPath'),
    ownership: 'router-owned',
    source: requiredString(metadata.source, 'metadata.source'),
    sourceKey: requiredString(metadata.sourceKey, 'metadata.sourceKey'),
    configRevision: metadata.configRevision,
    configured: metadata.credential?.configured ?? null,
    authorizationStatus,
    supportScope: requiredString(metadata.supportScope, 'metadata.supportScope'),
    models: metadata.catalog.models.map(model => ({
      model: requiredString(model.id, 'metadata.catalog.models[].id'),
      name: requiredString(model.name, 'metadata.catalog.models[].name'),
      maxContextTokens: model.contextWindow ?? null,
      capability: {
        text: supportFact(metadata.capabilities.text, capabilitySource),
        image: supportFact(metadata.capabilities.image, capabilitySource),
        tools: supportFact(metadata.capabilities.tools, capabilitySource),
      },
    })),
  };
}

function registryPlugin(source, credentialKey) {
  return {
    inject: ['router', 'credentials'],
    apply(ctx) {
      let active = true;
      const unregister = ctx.router.registerOwned(source);
      const withdraw = () => {
        if (!active) return;
        active = false;
        unregister();
      };
      ctx.on('credentials/record-updated', updated => {
        if (String(updated) === credentialKey) withdraw();
      });
      ctx.effect(() => withdraw, `router: DeepSeek owned registry ${source.provider}`);
    },
  };
}

/** Mount the rc.2 provider and its public Router candidate registration as one lifecycle. */
export async function mountDeepSeekRouterConnection(ctx, spec) {
  const provider = await mountDeepSeekOwnedProvider(ctx, spec);
  const source = deepSeekOwnedSource(provider.metadata);
  let registryFiber;
  try {
    registryFiber = await ctx.plugin(registryPlugin(source, provider.metadata.credentialKey));
  } catch (error) {
    await provider.disconnect({ deleteCredential: false });
    throw error;
  }
  let registryDisposal;
  return Object.freeze({
    metadata: provider.metadata,
    source,
    async disconnect(options) {
      registryDisposal ??= registryFiber.dispose();
      await registryDisposal;
      await provider.disconnect(options);
    },
  });
}
