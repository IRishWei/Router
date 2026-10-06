// A real native adapter in a subprocess; only local disk faults/process exit are controlled.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';
const home = process.env.ROUTER_TEST_HOME;
const mode = process.env.ROUTER_TEST_MODE;
const failed = Promise.withResolvers();
let adapterEntries = 0, intentWritten = false, selectionInjected = false;
const path = join(home, 'router', 'test', 'state.json');
const watchdog = setTimeout(() => process.exit(2), 5000);
const ctx = await startNative(home, { files: {
  async writeFile(file, data, options) {
    const task = JSON.parse(data).tasks.at(-1), call = task?.calls.at(-1);
    if (mode === 'blocked-clear-crash' && call?.dispatchIntent === 'possible' && !selectionInjected) {
      selectionInjected = true;
      await ctx.sessionController.selectModel({ sessionId: task.sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    }
    if ((mode === 'write-failure' && (call?.dispatchStarted || call?.dispatchIntent === 'possible')) || (mode === 'adapter-crash' && call?.dispatchStarted) || (mode === 'blocked-clear-crash' && call?.dispatchIntent === 'blocked')) {
      failed.resolve(); throw Object.assign(new Error('Controlled dispatch marker EIO'), { code: 'EIO' });
    }
    intentWritten = mode === 'intent-crash' && call?.dispatchIntent === 'possible' && !call.dispatchStarted;
    return writeFile(file, data, options);
  },
  async rename(...args) {
    await rename(...args);
    if (intentWritten) {
      console.log(JSON.stringify({ adapterEntries, durable: JSON.parse(await readFile(path, 'utf8')).tasks.at(-1).calls.at(-1) }));
      process.exit(0);
    }
  },
} });
class DispatchFixture extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'dispatch', name: 'Local dispatch fixture' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'Local dispatch fixture', contextWindow: 32768, maxTokens: 1024 }; }
  async *stream() {
    adapterEntries++;
    if (mode === 'adapter-crash') {
      await failed.promise;
      console.log(JSON.stringify({ adapterEntries, durable: JSON.parse(await readFile(path, 'utf8')).tasks.at(-1).calls.at(-1) }));
      process.exit(0);
    }
    yield { type: 'text-delta', index: 0, text: 'LOCAL_DISPATCH' };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
ctx.llm.registerAdapter(['native-dispatch'], new DispatchFixture());
await ctx.router.setAutomatic(false);
const { sessionId } = await ctx.sessionController.create({ cwd: home });
await ctx.sessionController.selectModel({ sessionId, provider: 'native-dispatch', model: 'dispatch' });
const task = await submit(ctx, sessionId, 'Local dispatch durability task');
console.log(JSON.stringify({ adapterEntries, task }));
if (mode === 'blocked-clear-crash') process.exit(0);
await ctx.fiber.dispose();
clearTimeout(watchdog);
