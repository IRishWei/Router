import assert from 'node:assert/strict';
import test from 'node:test';
import { CompatibleResponsesAdapter, compatibleEndpoint, discoverCompatibleModels } from '../src/compatible-responses.mjs';
import { completed } from './go-harness.mjs';
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import { createSourceNetworkTransport } from '../src/source-network.mjs';

const collect = async stream => { const parts = []; for await (const part of stream) parts.push(part); return parts; };
const options = () => ({ provider: 'compatible-test', model: 'gpt-6-luna', sessionId: 'stable-session', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }], maxTokens: 32 });
const fixture = (response = { statusCode: 200, headers: { 'content-type': 'text/event-stream' }, body: [completed('OK')] }) => {
  const requests = []; const adapter = new CompatibleResponsesAdapter({ provider: 'compatible-test', endpoint: 'https://opencode.ai/zen/go/v1', model: 'gpt-6-luna', tools: true, getCredential: () => ({ key: 'controlled-compatible-key', generation: 'first' }), transport: { async request(url, request) { requests.push({ url, request }); return response; } } }); return { adapter, requests };
};
test('compatible owns destination, session, model and cap; rejects unsupported requests before transport', async () => {
  const f = fixture(); const parts = await collect(f.adapter.stream(options()));
  assert.equal(f.requests[0].url, 'https://opencode.ai/zen/go/v1/responses'); assert.equal(f.requests[0].request.headers['x-opencode-session'], 'stable-session'); assert.equal(JSON.parse(f.requests[0].request.body).max_output_tokens, 32); assert.equal(parts.at(-1).reason.kind, 'stop');
  for (const patch of [{ sessionId: undefined }, { model: 'not-selected' }, { maxTokens: 1025 }, { temperature: 0 }, { messages: [{ role: 'user', content: [{ type: 'image', image: 'unsupported' }] }] }]) await assert.rejects(collect(f.adapter.stream({ ...options(), ...patch })));
  assert.equal(f.requests.length, 1);
  for (const endpoint of ['http://remote.example/v1', 'https://name:key@example.org/v1', 'https://example.org/v1?key=secret', 'https://example.org/v1/responses', 'https://api.openai.com/v1', 'https://api.openai.com./v1', 'https://auth.openai.com./', 'https://chatgpt.com']) assert.throws(() => compatibleEndpoint(endpoint));
});
test('compatible catalog uses production transport byte and deadline contracts against an owned local server', async () => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'local-model' }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const real = createSourceNetworkTransport({ lookup, directOnly: true });
  try {
    const models = await discoverCompatibleModels({ endpoint: origin + '/v1', key: 'controlled-local-key', transport: { request(url, options) { assert.equal(new URL(url).origin, origin); return real.request(url, { ...options, authorizeAddress: target => target.address === '127.0.0.1' && target.url.origin === origin }); } } });
    assert.deepEqual(models, ['local-model']); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('compatible streaming rejects redirects, wrong media and reflected error bodies without retry', async () => {
  for (const response of [{ statusCode: 302, headers: { location: 'https://other.example' }, body: [] }, { statusCode: 401, headers: {}, body: ['controlled-compatible-key'] }, { statusCode: 200, headers: { 'content-type': 'application/json' }, body: ['controlled-compatible-key'] }]) {
    const f = fixture(response); await assert.rejects(collect(f.adapter.stream(options())), error => !error.message.includes('controlled-compatible-key')); assert.equal(f.requests.length, 1);
  }
});
test('compatible catalog is bounded, does not certify models and rejects reflected credential IDs', async () => {
  for (const data of [{ data: [{ id: 'model-one' }, { id: 'model-one' }] }, { data: [{ id: 'controlled-catalog-key' }] }, { object: 'unexpected' }]) {
    const result = discoverCompatibleModels({ endpoint: 'https://example.org/v1', key: 'controlled-catalog-key', transport: { request: async () => ({ statusCode: 200, body: [Buffer.from(JSON.stringify(data))] }) } });
    if (data.data?.[0].id === 'model-one') assert.deepEqual(await result, ['model-one']); else await assert.rejects(result, error => !error.message.includes('controlled-catalog-key'));
  }
});
