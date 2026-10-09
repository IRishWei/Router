import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { OpenCodeGoAdapter, GO_RESPONSES_URL, GO_MODEL, goEndpoint } from '../src/opencode-go-adapter.mjs';
import { completed } from './go-harness.mjs';

const collect = async stream => { const result = []; for await (const chunk of stream) result.push(chunk); return result; };
const options = () => ({ provider: 'go-controlled', model: GO_MODEL, sessionId: 'session-one', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }], maxTokens: 32 });
function fixture({ statusCode = 200, body = completed(), failure } = {}) {
  const requests = []; let credential = { key: 'controlled-go-key', generation: 'one' };
  const adapter = new OpenCodeGoAdapter({ provider: 'go-controlled', getCredential: () => credential, transport: { request: async (url, request) => { requests.push({ url, request, json: JSON.parse(request.body) }); if (failure) throw failure; return { statusCode, headers: { 'content-type': 'text/event-stream' }, body: [body] }; } } });
  return { adapter, requests, replace: value => { credential = value; } };
}

test('Go sends its exact endpoint, stable session and output cap without OAuth or Zen fallback', async () => {
  const f = fixture(); const chunks = await collect(f.adapter.stream(options()));
  assert.equal(f.requests.length, 1); const request = f.requests[0];
  assert.equal(request.url, GO_RESPONSES_URL);
  assert.equal(request.request.headers['x-opencode-session'], 'session-one');
  assert(request.request.headers['user-agent'].startsWith(`irishwei-dsh-router/${createRequire(import.meta.url)('../package.json').version} `));
  assert.equal(request.request.headers.authorization, 'Bearer controlled-go-key');
  assert.equal(request.json.max_output_tokens, 32); assert.equal(request.json.model, GO_MODEL);
  assert.equal(request.json.store, false); assert.equal(request.json.stream, true);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  const usage = chunks.find(chunk => chunk.type === 'usage').usage;
  assert.equal(usage.inputTokens, 7); assert.equal(usage.cacheReadTokens, 2); assert.equal(usage.totalTokens, 12);
  await collect(f.adapter.stream({ ...options(), purpose: 'session-title' }));
  assert.equal(f.requests[1].request.headers['x-opencode-session'], 'session-one');
  assert.equal(f.adapter.providerRetryPolicy('go-controlled').maxRetries, 0);
});

test('Go rejects missing sessions, excessive output, sampling overrides and unknown models before dispatch', async () => {
  for (const change of [{ sessionId: undefined }, { sessionId: 'bad\r\nheader' }, { maxTokens: 1025 }, { maxTokens: 0 }, { temperature: 1 }, { model: 'gpt-6-sol' }, { messages: [{ role: 'user', content: [{ type: 'image', data: 'binary' }] }] }]) {
    const f = fixture(); await assert.rejects(collect(f.adapter.stream({ ...options(), ...change }))); assert.equal(f.requests.length, 0);
  }
  for (const url of ['https://opencode.ai/zen/v1/responses', 'https://api.openai.com/v1/responses', 'http://127.0.0.1/x?secret=x', 'http://key@127.0.0.1/x']) assert.throws(() => goEndpoint({ kind: 'controlled-test', url }));
  assert.throws(() => goEndpoint({ kind: 'official', url: GO_RESPONSES_URL }));
});

test('Go preserves errors/partial usage, never retries, and removes upstream secrets from errors', async () => {
  for (const scenario of [{ statusCode: 429 }, { statusCode: 302 }, { body: Buffer.from('data: {"type":"response.output_text.delta","item_id":"x","output_index":0,"content_index":0,"delta":"partial"}\n\n') }, { failure: new Error('controlled-go-key') }]) {
    const f = fixture(scenario);
    await assert.rejects(collect(f.adapter.stream(options())), error => { assert(!JSON.stringify(error).includes('controlled-go-key')); assert(!error.message.includes('controlled-go-key')); return true; });
    assert.equal(f.requests.length, 1);
  }
  const f = fixture({ body: completed('OK', undefined, { input_tokens: 5, output_tokens: 2, total_tokens: 7 }) });
  const usage = (await collect(f.adapter.stream(options()))).find(chunk => chunk.type === 'usage').usage;
  assert.equal(usage.cacheReadTokens, undefined); assert.equal(usage.reasoningTokens, undefined);
});

test('Go revalidates prepared identity and handles function-call history without truncation', async () => {
  const f = fixture(); const prepared = await f.adapter.prepareCall('go-controlled', GO_MODEL);
  f.replace({ key: 'other-controlled-key', generation: 'two' });
  await assert.rejects(collect(prepared.stream(options())), { code: 'AUTHORIZATION_CHANGED' }); assert.equal(f.requests.length, 0);
  const tool = fixture({ body: completed('', [{ type: 'function_call', id: 'item', call_id: 'call-one', name: 'check', arguments: '{}' }]) });
  const chunks = await collect(tool.adapter.stream({ ...options(), tools: [{ name: 'check', description: 'Check', parameters: { type: 'object', properties: {} } }] }));
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls'); assert.equal(tool.requests[0].json.tools[0].type, 'function');
  const next = fixture(); await collect(next.adapter.stream({ ...options(), messages: [options().messages[0], { role: 'assistant', content: [{ type: 'tool-call', id: 'call-one', name: 'check', arguments: '{}' }] }, { role: 'tool', toolCallId: 'call-one', content: [{ type: 'text', text: 'TOOL_OK' }] }] }));
  assert.equal(next.requests[0].json.input[1].call_id, 'call-one'); assert.equal(next.requests[0].json.input[1].namespace, undefined);
  assert.equal(next.requests[0].json.input[2].output[0].text, 'TOOL_OK');
});
