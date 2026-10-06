import { LlmAdapter } from '@deepseek-ai/dsh-llm';

export const PROVIDER = 'router-t08-native-companion';
export const MODEL = 'controlled-native';
export const inject = ['llm'];

class CompanionAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Router T08 · 外部受控原生 provider' }; }
  async listModels(provider) { return [{ provider, id: MODEL, name: 'Controlled native companion', inputModalities: ['text'] }]; }
  async resolveModel(provider, id) {
    if (id !== MODEL) throw new Error('Unknown companion model');
    return { provider, id, name: 'Controlled native companion', context: { contextWindow: 16384 }, inputModalities: ['text'] };
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    const user = options.messages.findLast(message => message.role === 'user');
    const prompt = user?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
    const text = prompt.match(/^Reply\s+(.+)$/m)?.[1] ?? 'NATIVE_COMPANION_OK';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 8 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export function apply(ctx) {
  ctx.llm.registerAdapter([PROVIDER], new CompanionAdapter());
  ctx.llm.registerConfigurableProviders([{ provider: PROVIDER, displayName: 'Router T08 native companion', settingsNs: 'router-t08-companion', settingsPath: [] }]);
}
