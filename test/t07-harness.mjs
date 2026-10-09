import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import { startNative } from './t02-harness.mjs';
import { completed } from './go-harness.mjs';

export async function compatibleHost(handler, { tools = true } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const entry = { path: request.url, method: request.method, headers: request.headers, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null }; requests.push(entry);
    if (handler) return handler(entry, response, requests);
    if (entry.path === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-compatible' }] })); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(completed('COMPATIBLE_CONNECTION_OK'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const home = await mkdtemp(join(tmpdir(), 'router-compatible-')); let ctx;
  const transport = { async request(url, options) { if (new URL(url).hostname !== '127.0.0.1') throw new Error('Only local fixture requests'); const response = await fetch(url, { method: options.method, headers: options.headers, body: options.body, signal: options.signal, redirect: 'manual' }); return { statusCode: response.status, headers: response.headers, body: response.body, close: () => response.body?.cancel().catch(() => {}) }; } };
  const start = async () => {
    ctx = await startNative(home, { sessionControllerAsPlugin: true, beforeRouter: async current => { await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false }); current.provide('routerCompatibleTransport', transport); } });
    if (!ctx.get('logger')) ctx.provide('logger', { warn() {}, info() {}, error() {} }); return ctx;
  };
  await start();
  await ctx.router.compatibleAdd({ name: 'Controlled compatible', endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-compatible', tools, apiKey: 'controlled-compatible-private-key' });
  const id = (await ctx.router.snapshot()).compatible.entries[0].id;
  await ctx.router.compatibleConnect({ id });
  const candidate = (await ctx.router.snapshot()).models.find(item => item.source === 'openai-compatible');
  return { home, id, requests, candidate, get ctx() { return ctx; }, async restart() { await ctx.fiber.dispose(); return start(); }, async close() { await ctx?.fiber.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } };
}
