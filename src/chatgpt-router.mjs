import { createChatGptResponsesAdapter } from './chatgpt-responses.mjs';

const CAPABILITY_SOURCE = 'openai-chatgpt-responses-preview';

function requiredString(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

/** Project only official route-level facts; model-specific capacity remains unknown. */
export function chatGptOwnedSource(spec) {
  if (!Array.isArray(spec?.models) || !spec.models.length) throw new TypeError('ChatGPT catalog is unavailable');
  return {
    provider: requiredString(spec.provider, 'provider'),
    connectionId: requiredString(spec.connectionId, 'connectionId'),
    accountId: requiredString(spec.accountId, 'accountId'),
    billingPath: 'chatgpt-subscription',
    ownership: 'router-owned',
    source: 'openai-chatgpt-oauth',
    sourceKey: `openai-chatgpt-oauth:${spec.accountId}`,
    configRevision: spec.configRevision,
    configured: true,
    authorizationStatus: 'authorized',
    supportScope: CAPABILITY_SOURCE,
    models: spec.models.map(model => ({
      model: requiredString(model.slug, 'models[].slug'),
      name: requiredString(model.display_name ?? model.displayName, 'models[].display_name'),
      maxContextTokens: null,
      capability: {
        text: { supported: true, confidence: 'declared', source: CAPABILITY_SOURCE },
        tools: { supported: true, confidence: 'declared', source: CAPABILITY_SOURCE },
        image: { supported: null, confidence: 'unknown', source: 'openai-chatgpt-model-catalog' },
      },
    })),
  };
}

function providerPlugin(spec) {
  return {
    inject: ['llm'],
    apply(ctx) {
      const adapter = createChatGptResponsesAdapter({
        ...spec,
        transport: (url, options) => spec.transport.request(url, options),
      });
      ctx.llm.registerAdapter([spec.provider], adapter);
    },
  };
}

function registryPlugin(source) {
  return {
    inject: ['router'],
    apply(ctx) {
      const unregister = ctx.router.registerOwned(source);
      ctx.effect(() => unregister, `router: ChatGPT owned registry ${source.provider}`);
    },
  };
}

/** Mount provider and owned registry in sibling fibers with one disposal boundary. */
export async function mountChatGptRouterConnection(ctx, spec) {
  const catalog = await spec.getCatalog({ provider: spec.provider, accountId: spec.accountId });
  const source = chatGptOwnedSource({ ...spec, models: catalog.models });
  const providerFiber = await ctx.plugin(providerPlugin(spec));
  let registryFiber;
  try { registryFiber = await ctx.plugin(registryPlugin(source)); }
  catch (error) { await providerFiber.dispose(); throw error; }
  let disposal;
  return Object.freeze({
    source,
    async disconnect() {
      disposal ??= Promise.allSettled([registryFiber.dispose(), providerFiber.dispose()]).then(results => {
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      });
      return disposal;
    },
  });
}
