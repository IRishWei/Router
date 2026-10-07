import { execFile } from 'node:child_process';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const DOH_URL = new URL('https://dns.google/resolve');
const DOH_ADDRESS = Object.freeze({ address: '8.8.8.8', family: 4 });
const DOH_MAX_BYTES = 16_384;
const POWERSHELL_PROXY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$uri = [Uri]$request.url
$policy = [System.Net.WebRequest]::GetSystemWebProxy()
if ($policy.IsBypassed($uri)) {
  @{ kind = 'direct' } | ConvertTo-Json -Compress
} else {
  $proxy = $policy.GetProxy($uri)
  if ($null -eq $proxy -or $proxy.AbsoluteUri -eq $uri.AbsoluteUri) {
    @{ kind = 'direct' } | ConvertTo-Json -Compress
  } else {
    @{ kind = 'proxy'; url = $proxy.AbsoluteUri } | ConvertTo-Json -Compress
  }
}
`;

const codedError = code => Object.assign(new Error(code), { code });

const boundedOperation = (start, { deadline, signal }) => new Promise((resolve, reject) => {
  let settled = false;
  let timer;
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    handler(value);
  };
  const abort = () => finish(reject, codedError('CANCELED'));
  if (signal?.aborted) return abort();
  const remaining = deadline - Date.now();
  if (remaining <= 0) return finish(reject, codedError('SOURCE_TIMEOUT'));
  timer = setTimeout(() => finish(reject, codedError('SOURCE_TIMEOUT')), remaining);
  timer.unref?.();
  signal?.addEventListener('abort', abort, { once: true });
  try { Promise.resolve(start()).then(value => finish(resolve, value), error => finish(reject, error)); }
  catch (error) { finish(reject, error); }
});

const publicIpv4 = address => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 0 && c === 2)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
};

const ipv6Value = address => {
  const [headText, tailText] = address.toLowerCase().split('::');
  const expand = part => part ? part.split(':').flatMap(piece => {
    if (!piece.includes('.')) return [piece];
    const octets = piece.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return ['invalid'];
    return [((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
  }) : [];
  const head = expand(headText);
  const tail = expand(tailText);
  if (head.includes('invalid') || tail.includes('invalid')) return null;
  const omitted = address.includes('::') ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(0, omitted)).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
};

const publicIpv6 = address => {
  const value = ipv6Value(address);
  if (value === null) return false;
  const prefix = (bits, expected) => value >> BigInt(128 - bits) === expected;
  return prefix(3, 1n) && !prefix(32, 0x20010db8n);
};

export const publicSourceAddress = address => isIP(address) === 4 ? publicIpv4(address) : isIP(address) === 6 ? publicIpv6(address) : false;

const remainingTime = deadline => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw codedError('SOURCE_TIMEOUT');
  return remaining;
};

const normalizeFailure = (error, signal, fallback) => {
  if (signal?.aborted) return codedError('CANCELED');
  if (error?.code === 'SOURCE_TIMEOUT' || error?.code === 'CANCELED' || error?.code === 'SOURCE_TOTAL_BYTES_EXCEEDED') return error;
  return codedError(fallback);
};

const parseProxy = value => {
  if (!value || value.kind === 'direct') return { kind: 'direct' };
  if (value.kind !== 'proxy' || !(typeof value.url === 'string' || value.url instanceof URL)) throw codedError('SOURCE_PROXY_UNAVAILABLE');
  let url;
  try { url = new URL(value.url.href ?? value.url); } catch { throw codedError('SOURCE_PROXY_UNAVAILABLE'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw codedError('SOURCE_PROXY_UNAVAILABLE');
  return { kind: 'proxy', url };
};

export const discoverWindowsProxy = (url, { deadline, signal, platform = process.platform } = {}) => {
  if (platform !== 'win32') return Promise.resolve({ kind: 'direct' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      handler(value);
    };
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_PROXY_SCRIPT], {
      windowsHide: true,
      timeout: remainingTime(deadline),
      maxBuffer: 16_384,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return finish(reject, normalizeFailure(error, signal, error.killed ? 'SOURCE_TIMEOUT' : 'SOURCE_PROXY_UNAVAILABLE'));
      try { finish(resolve, parseProxy(JSON.parse(stdout.trim()))); }
      catch (parseError) { finish(reject, normalizeFailure(parseError, signal, 'SOURCE_PROXY_UNAVAILABLE')); }
    });
    const abort = () => {
      child.kill();
      finish(reject, codedError('CANCELED'));
    };
    child.stdin.once('error', error => finish(reject, normalizeFailure(error, signal, 'SOURCE_PROXY_UNAVAILABLE')));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else child.stdin.end(JSON.stringify({ url: url.href }));
  });
};

const formatAuthority = (address, port) => `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;

const createTunnel = (proxy, target, { deadline, signal, servername, secure, tlsOptions }) => new Promise((resolve, reject) => {
  const proxyTransport = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
  const authority = formatAuthority(target.address, target.port);
  let settled = false;
  let tunnel;
  let timer;
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    handler(value);
  };
  const abort = () => {
    request.destroy(codedError('CANCELED'));
    tunnel?.destroy();
  };
  const request = proxyTransport({
    hostname: proxy.hostname,
    port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
    method: 'CONNECT',
    path: authority,
    headers: { host: authority },
    signal,
  });
  timer = setTimeout(() => {
    request.destroy(codedError('SOURCE_TIMEOUT'));
    tunnel?.destroy();
    finish(reject, codedError('SOURCE_TIMEOUT'));
  }, remainingTime(deadline));
  timer.unref?.();
  request.once('connect', (response, socket, head) => {
    if (response.statusCode !== 200 || head.length) {
      socket.destroy();
      return finish(reject, codedError('SOURCE_PROXY_UNAVAILABLE'));
    }
    if (!secure) return finish(resolve, socket);
    tunnel = tlsConnect({ socket, servername, rejectUnauthorized: true, ...tlsOptions });
    tunnel.once('secureConnect', () => finish(resolve, tunnel));
    tunnel.once('error', error => finish(reject, error));
  });
  request.once('error', error => finish(reject, normalizeFailure(error, signal, 'SOURCE_PROXY_UNAVAILABLE')));
  signal?.addEventListener('abort', abort, { once: true });
  request.end();
});

const readResponse = (url, route, { deadline, signal, maxBytes, transferBudget, accept, userAgent, overflowCode, tlsOptions }) => new Promise(resolve => {
  let timeoutMs;
  try { timeoutMs = remainingTime(deadline); }
  catch (error) { resolve({ error }); return; }
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const Agent = url.protocol === 'https:' ? HttpsAgent : HttpAgent;
  const agent = new Agent({ keepAlive: false });
  if (route.kind === 'direct') {
    agent.createConnection = (options, callback) => Agent.prototype.createConnection.call(agent, {
      ...options,
      lookup: (_hostname, lookupOptions, done) => {
        const pinned = { address: route.address.address, family: route.address.family };
        if (lookupOptions && typeof lookupOptions === 'object' && lookupOptions.all === true) done(null, [pinned]);
        else done(null, pinned.address, pinned.family);
      },
    }, callback);
  } else {
    agent.createConnection = (_options, callback) => {
      createTunnel(route.proxy, {
        address: route.address.address,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      }, { deadline, signal, servername: url.hostname, secure: url.protocol === 'https:', tlsOptions }).then(socket => callback(null, socket), callback);
    };
  }
  let settled = false;
  const startingTransferredBytes = transferBudget.used;
  const finish = value => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener('abort', abort);
    agent.destroy();
    resolve(value);
  };
  const request = transport(url, {
    method: 'GET',
    agent,
    headers: { accept, 'user-agent': userAgent },
    signal,
  }, response => {
    const chunks = [];
    let bytes = 0;
    response.on('data', chunk => {
      bytes += chunk.length;
      const withinTotal = transferBudget.consume(chunk.length);
      if (!withinTotal || bytes > maxBytes) {
        const code = startingTransferredBytes > 0 || (!withinTotal && bytes <= maxBytes) ? 'SOURCE_TOTAL_BYTES_EXCEEDED' : overflowCode;
        finish({ error: codedError(code) });
        response.destroy();
        request.destroy();
      } else chunks.push(chunk);
    });
    response.once('error', error => finish({ error: normalizeFailure(error, signal, 'SOURCE_UNAVAILABLE') }));
    response.once('end', () => finish({ response, body: Buffer.concat(chunks).toString('utf8') }));
  });
  const abort = () => request.destroy(codedError('CANCELED'));
  request.setTimeout(timeoutMs, () => request.destroy(codedError('SOURCE_TIMEOUT')));
  request.once('error', error => finish({ error: normalizeFailure(error, signal, route.kind === 'proxy' ? 'SOURCE_PROXY_UNAVAILABLE' : 'SOURCE_UNAVAILABLE') }));
  signal?.addEventListener('abort', abort, { once: true });
  request.end();
});

const resolveWithDoh = async ({ hostname, proxy, deadline, signal, transferBudget, tlsOptions }) => {
  const url = new URL(DOH_URL);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  const outcome = await readResponse(url, { kind: 'proxy', proxy, address: DOH_ADDRESS }, {
    deadline,
    signal,
    maxBytes: Math.min(DOH_MAX_BYTES, transferBudget.remaining),
    transferBudget,
    accept: 'application/dns-json, application/json',
    userAgent: 'dsh-router-source-evidence/1',
    overflowCode: 'SOURCE_DNS_UNAVAILABLE',
    tlsOptions,
  });
  if (outcome.error) throw outcome.error;
  const contentType = String(outcome.response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (outcome.response.statusCode !== 200 || !['application/dns-json', 'application/json'].includes(contentType)) throw codedError('SOURCE_DNS_UNAVAILABLE');
  let payload;
  try { payload = JSON.parse(outcome.body); } catch { throw codedError('SOURCE_DNS_UNAVAILABLE'); }
  if (payload?.Status !== 0 || !Array.isArray(payload.Answer)) throw codedError('SOURCE_DNS_UNAVAILABLE');
  return payload.Answer.filter(answer => answer?.type === 1 && typeof answer.data === 'string').map(answer => ({ address: answer.data, family: 4 }));
};

export function createSourceNetworkReader({ lookup, discoverProxy, resolveProxyAddresses, platform = process.platform, tlsOptions = {}, directOnly = false } = {}) {
  if (typeof lookup !== 'function') throw new TypeError('lookup is required');
  const explicitProxyDiscovery = typeof discoverProxy === 'function';
  const proxyDiscovery = discoverProxy ?? ((url, context) => discoverWindowsProxy(url, { ...context, platform }));
  const proxyResolver = resolveProxyAddresses ?? resolveWithDoh;
  return async (url, { authorizeAddress, deadline, signal, maxBytes, transferBudget }) => {
    if (isIP(url.hostname) && !(authorizeAddress ? authorizeAddress({ url: new URL(url), address: url.hostname, family: isIP(url.hostname) }) === true : publicSourceAddress(url.hostname))) {
      return { error: codedError('SOURCE_ADDRESS_NOT_AUTHORIZED') };
    }
    let policy;
    try {
      policy = directOnly || authorizeAddress && !explicitProxyDiscovery
        ? { kind: 'direct' }
        : parseProxy(await boundedOperation(() => proxyDiscovery(new URL(url), { deadline, signal }), { deadline, signal }));
    } catch (error) {
      return { error: normalizeFailure(error, signal, 'SOURCE_PROXY_UNAVAILABLE') };
    }

    let nativeAddresses;
    try { nativeAddresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await boundedOperation(() => lookup(url.hostname, { all: true, verbatim: true }), { deadline, signal }); }
    catch (error) {
      if (policy.kind === 'direct') return { error: normalizeFailure(error, signal, 'SOURCE_DNS_UNAVAILABLE') };
      nativeAddresses = [];
    }
    const authorized = address => (authorizeAddress ? authorizeAddress({ url: new URL(url), address: address.address, family: address.family }) === true : publicSourceAddress(address.address));
    let address = nativeAddresses.find(authorized);
    if (!address && policy.kind === 'proxy') {
      try {
        const resolved = await boundedOperation(() => proxyResolver({ hostname: url.hostname, proxy: policy.url, deadline, signal, transferBudget, tlsOptions }), { deadline, signal });
        address = Array.isArray(resolved) ? resolved.find(authorized) : null;
      } catch (error) {
        return { error: normalizeFailure(error, signal, 'SOURCE_DNS_UNAVAILABLE') };
      }
    }
    if (!address) return { error: codedError('SOURCE_ADDRESS_NOT_AUTHORIZED') };
    return readResponse(url, policy.kind === 'proxy' ? { kind: 'proxy', proxy: policy.url, address } : { kind: 'direct', address }, {
      deadline,
      signal,
      maxBytes,
      transferBudget,
      accept: 'text/plain, text/html, application/json',
      userAgent: 'dsh-router-source-evidence/1',
      overflowCode: 'SOURCE_TOO_LARGE',
      tlsOptions,
    });
  };
}
