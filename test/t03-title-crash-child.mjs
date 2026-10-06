import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { startNative, submit } from './t02-harness.mjs';
const home = process.env.ROUTER_TEST_HOME, mode = process.env.ROUTER_TEST_MODE;
const nativeEnded = Promise.withResolvers(), titleEnded = Promise.withResolvers();
const ctx = await startNative(home);
ctx.provide('logger', { warn() {}, info() {}, error() {} });
await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 5000 });
async function crash() { await ctx.router.flush(); console.log(JSON.stringify((await ctx.router.snapshot()).tasks.at(-1))); process.exit(0); }
ctx.on('session/event', (_session, event) => {
  if (event.type === 'turn/end') nativeEnded.resolve();
  if (event.type === 'session/title' && event.data.source.kind === 'provider') titleEnded.resolve();
});
class TitleCrash extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'crash', name: 'Local crash fixture' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'Local crash fixture', contextWindow: 32768, maxTokens: 1024 }; }
  async *stream(options) {
    if (mode === 'main-crash' && options.purpose !== 'session-title') { await titleEnded.promise; await crash(); }
    if (mode === 'aux-crash' && options.purpose === 'session-title') { await nativeEnded.promise; await crash(); }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'LOCAL_TITLE' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'LOCAL_TITLE' } };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
ctx.llm.registerAdapter(['local-title-crash'], new TitleCrash());
await ctx.router.setAutomatic(false);
if (mode === 'budget-crash') await ctx.router.setBudgetDefaults({ tokens: 12, durationMs: null, money: [] });
const { sessionId } = await ctx.sessionController.create({ cwd: home });
if (mode !== 'budget-crash') await ctx.sessionController.selectModel({ sessionId, provider: 'local-title-crash', model: 'crash' });
void submit(ctx, sessionId, 'Reply MAIN');
if (mode === 'budget-crash') {
  await nativeEnded.promise;
  while (!(await ctx.router.snapshot()).tasks.at(-1)?.calls.some(call => call.purpose === 'auxiliary' && call.status === 'waiting')) await new Promise(resolve => setTimeout(resolve, 5));
  await crash();
}
setTimeout(() => process.exit(2), 5000);
