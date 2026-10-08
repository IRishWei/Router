import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createChatGptResponsesAdapter } from '../src/chatgpt-responses.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';

const run = promisify(execFile);
const OPENSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';

const sse = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

async function certificate(directory) {
  const keyPath = join(directory, 'origin.key.pem');
  const certPath = join(directory, 'origin.cert.pem');
  await run(OPENSSL, [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=api.openai.com', '-addext', 'subjectAltName=DNS:api.openai.com',
  ], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
  return { key: await readFile(keyPath), cert: await readFile(certPath) };
}

test('production CONNECT transport preserves HTTPS SSE and surfaces a controlled HTTP 200 non-SSE response', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'router-t09-proxy-responses-'));
  const tls = await certificate(directory);
  const requests = [];
  let mode = 'sse';
  const origin = createHttpsServer(tls, async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({ method: request.method, url: request.url, body: JSON.parse(Buffer.concat(body).toString('utf8')) });
    if (mode === 'non-sse') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'controlled-non-sse' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'controlled-request-id' });
    response.end(sse({
      type: 'response.completed',
      response: {
        id: 'resp-proxy', status: 'completed',
        output: [{ type: 'message', id: 'msg-proxy', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PROXY_SSE_OK' }] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      },
    }));
  });
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  origin.on('connection', track);
  const connects = [];
  const proxy = createHttpServer((_request, response) => response.writeHead(405).end());
  proxy.on('connection', track);
  proxy.on('connect', (request, client, head) => {
    connects.push(request.url);
    const separator = request.url.lastIndexOf(':');
    const host = request.url.slice(0, separator);
    const port = Number(request.url.slice(separator + 1));
    const upstream = connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once('error', () => client.destroy());
    client.once('error', () => upstream.destroy());
  });
  let originPort;
  let proxyPort;
  try {
    originPort = await listen(origin);
    proxyPort = await listen(proxy);
    const network = createSourceNetworkTransport({
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      discoverProxy: async () => ({ kind: 'proxy', url: `http://127.0.0.1:${proxyPort}/` }),
      tlsOptions: { ca: tls.cert },
    });
    const adapter = createChatGptResponsesAdapter({
      provider: 'router-chatgpt-controlled', accountId: 'account-controlled',
      responsesURL: `https://api.openai.com:${originPort}/v1/responses`,
      getAuthorizedCredential: async () => ({
        access_token: 'controlled-token', client_id: 'client-controlled', subject: 'subject-controlled',
        scopes: ['openid', 'chatgpt.tokens.use.direct'],
      }),
      getCatalog: async () => ({
        identity: { client_id: 'client-controlled', subject: 'subject-controlled' },
        models: [{ slug: 'gpt-controlled', display_name: 'GPT Controlled' }],
      }),
      transport: (url, options) => network.request(url, {
        ...options,
        authorizeAddress: ({ address }) => address === '127.0.0.1',
      }),
    });
    const request = {
      provider: 'router-chatgpt-controlled', model: 'gpt-controlled',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'controlled request' }] })],
    };

    const chunks = await collect(adapter.stream(request));
    assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.text, 'PROXY_SSE_OK');
    assert.equal(chunks.at(-1).reason.kind, 'stop');
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.stream, true);

    mode = 'non-sse';
    await assert.rejects(collect(adapter.stream(request)), error => {
      assert.equal(error.failure.code, 'INVALID_RESPONSE');
      assert.equal(error.failure.status, 200);
      assert.equal(error.failure.requestId, undefined);
      assert.match(error.message, /did not return an event stream/u);
      return true;
    });
    assert.deepEqual(connects, [`127.0.0.1:${originPort}`, `127.0.0.1:${originPort}`]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled([close(proxy), close(origin)]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
