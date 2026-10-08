import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import test from 'node:test';
import { createSourceNetworkTransport } from '../src/source-network.mjs';

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: path => `http://127.0.0.1:${address.port}${path}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

const loopback = ({ address }) => address === '127.0.0.1';

test('the bound transport sends a bounded POST and exposes the response as an abortable byte stream', async () => {
  const requests = [];
  const endpoint = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'request-controlled' });
    response.write('data: first\n\n');
    response.end('data: second\n\n');
  });
  try {
    const transport = createSourceNetworkTransport({ lookup, directOnly: true });
    const result = await transport.request(new URL(endpoint.url('/v1/responses')), {
      method: 'POST',
      headers: { authorization: 'Bearer controlled-token', 'content-type': 'application/json' },
      body: Buffer.from('{"stream":true}'),
      deadline: Date.now() + 2_000,
      maxUploadBytes: 1_024,
      maxResponseBytes: 4_096,
      authorizeAddress: loopback,
    });
    const received = [];
    for await (const chunk of result.body) received.push(chunk);
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['x-request-id'], 'request-controlled');
    assert.equal(Buffer.concat(received).toString('utf8'), 'data: first\n\ndata: second\n\n');
    assert.deepEqual(requests, [{
      method: 'POST',
      headers: {
        authorization: 'Bearer controlled-token',
        'content-type': 'application/json',
        host: new URL(endpoint.url('/')).host,
        connection: 'close',
        'content-length': '15',
      },
      body: '{"stream":true}',
    }]);
  } finally {
    await endpoint.close();
  }
});

test('the bound transport stops a live response on the original abort signal', async () => {
  let closed;
  const connectionClosed = new Promise(resolve => { closed = resolve; });
  const endpoint = await listen(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: open\n\n');
    const timer = setInterval(() => response.write(': keepalive\n\n'), 20);
    response.once('close', () => { clearInterval(timer); closed(); });
  });
  const controller = new AbortController();
  try {
    const transport = createSourceNetworkTransport({ lookup, directOnly: true });
    const result = await transport.request(new URL(endpoint.url('/stream')), {
      method: 'POST', body: Buffer.alloc(0), headers: {}, signal: controller.signal,
      deadline: Date.now() + 2_000, maxUploadBytes: 16, maxResponseBytes: 4_096, authorizeAddress: loopback,
    });
    const iterator = result.body[Symbol.asyncIterator]();
    assert.match(Buffer.from((await iterator.next()).value).toString('utf8'), /data: open/u);
    controller.abort(new Error('controlled cancellation'));
    await assert.rejects(iterator.next(), error => error.code === 'CANCELED');
    await Promise.race([connectionClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('response stayed open')), 250))]);
  } finally {
    controller.abort();
    await endpoint.close();
  }
});

test('the bound transport rejects oversized uploads before opening a socket', async () => {
  let requests = 0;
  const endpoint = await listen((_request, response) => { requests += 1; response.end(); });
  try {
    const transport = createSourceNetworkTransport({ lookup, directOnly: true });
    await assert.rejects(transport.request(new URL(endpoint.url('/upload')), {
      method: 'POST', headers: {}, body: Buffer.alloc(17), deadline: Date.now() + 1_000,
      maxUploadBytes: 16, maxResponseBytes: 16, authorizeAddress: loopback,
    }), error => error.code === 'SOURCE_UPLOAD_TOO_LARGE');
    assert.equal(requests, 0);
  } finally {
    await endpoint.close();
  }
});
