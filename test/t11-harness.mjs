import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import { startNative, submit } from './t02-harness.mjs';
import { lifecycleServer, registrationFor, stateFor } from './t10-harness.mjs';
import { chatGptSessionKey } from '../src/chatgpt-sessions.mjs';

export const REFERENCE_USAGE = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 1050 };

export async function referenceFixture({ model = 'gpt-6.1-sol', usage = REFERENCE_USAGE, toolRoundTrip = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'router-t11-native-'));
  let responseCount = 0;
  const remote = await lifecycleServer({ onResponse: () => {
    if (++responseCount > (toolRoundTrip ? 2 : 1)) throw new Error('T11 synthetic response limit reached');
    if (toolRoundTrip && responseCount === 1) {
      const item = { type: 'function_call', id: 'fc-reference', call_id: 'call-reference', namespace: 'functions', name: 'reference_echo', arguments: '{}', status: 'completed' };
      return { events: [
        { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
        { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: '{}' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp-reference-tool', status: 'completed', output: [item], usage } },
      ] };
    }
    return { events: [{ type: 'response.completed', response: {
    id: 'resp-reference', status: 'completed', output: [{ type: 'message', id: 'msg-reference', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'REFERENCE_OK' }] }],
    ...(usage === null ? {} : { usage }),
  } }] };
  } });
  const record = remote.grant({ hostId: `urn:uuid:${randomUUID()}`, models: [{ slug: model, displayName: 'GPT-6.1 Sol' }] });
  const registration = registrationFor(record);
  const directory = join(home, 'router', 'test');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'state.json'), JSON.stringify({ schemaVersion: 1, config: { automatic: true, version: 1 }, tasks: [], chatGpt: stateFor(record) }));
  let seed = true;
  const fixture = { home, remote, record, registration, ctx: null, candidate: null,
    async start() {
      fixture.ctx = await startNative(home, { sessionControllerAsPlugin: true, beforeRouter: async current => {
        await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
        if (seed) { await current.credentials.modifyRecord(chatGptSessionKey(registration), () => record); seed = false; }
        await current.plugin(AuthorizationService);
        current.provide('routerChatGptTransport', { ...remote.transport, request(url, options) {
          if (new URL(url).origin !== remote.origin) throw new Error('T11 fixture refuses non-local requests');
          return remote.transport.request(url, options);
        } });
        current.provide('routerChatGptEndpoints', remote.endpoints);
      } });
      fixture.candidate = (await fixture.ctx.router.snapshot()).models.find(item => item.source === 'openai-chatgpt-oauth' && item.available);
      return fixture.ctx;
    },
    async task() { const { sessionId } = await fixture.ctx.sessionController.create({ cwd: home }); return submit(fixture.ctx, sessionId, 'Reply REFERENCE_OK'); },
    async restart() { await fixture.ctx.fiber.dispose(); fixture.ctx = null; return fixture.start(); },
    async close() { if (fixture.ctx) await fixture.ctx.fiber.dispose(); await remote.close(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); },
  };
  try {
    await fixture.start();
    await fixture.ctx.router.setModelEnabled(fixture.candidate.candidateId, true);
    await fixture.ctx.router.setFixedModel(fixture.candidate.candidateId);
    await fixture.ctx.router.setBudgetDefaults({ tokens: 65_536, durationMs: 5_000, money: [] });
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
