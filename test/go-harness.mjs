import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import { startNative } from './t02-harness.mjs';

export function completed(text = 'OK', output, usage = { input_tokens: 9, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 12 }) {
  return Buffer.from(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'response-controlled', status: 'completed', output: output ?? [{ type: 'message', id: 'message-controlled', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], usage } })}\n\n`);
}
export async function goHost(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const entry = { headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }; requests.push(entry);
    if (handler) return handler(entry, response, requests);
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(completed(requests.length === 1 ? 'OPENCODE_GO_CONNECTION_OK' : 'Go connection'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = { kind: 'controlled-test', url: `http://127.0.0.1:${server.address().port}/responses` };
  const home = await mkdtemp(join(tmpdir(), 'router-go-'));
  const transport = { async request(url, options) {
    const response = await fetch(url, { method: options.method, body: options.body, headers: options.headers, signal: options.signal, redirect: 'manual' });
    return { statusCode: response.status, headers: response.headers, body: response.body, close: () => response.body.cancel().catch(() => {}) };
  } };
  let ctx;
  const start = async () => {
    ctx = await startNative(home, { sessionControllerAsPlugin: true, beforeRouter: async current => {
      await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
      current.provide('routerGoEndpoint', endpoint); current.provide('routerGoTransport', transport);
    } });
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} });
    return ctx;
  };
  await start();
  const snapshot = await ctx.router.openCodeGoSaveCredential({ apiKey: 'controlled-go-host-key' });
  await ctx.router.openCodeGoConnect();
  const candidate = (await ctx.router.snapshot()).models.find(item => item.source === 'opencode-go');
  return { home, get ctx() { return ctx; }, requests, candidate, snapshot, async restart() { await ctx.fiber.dispose(); return start(); }, async close() { await ctx?.fiber.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } };
}
