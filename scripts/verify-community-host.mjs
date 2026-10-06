import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// This uses the installed Desktop's public HTTP carrier and Plugin Manager RPC.
// The owned launch token and browser cookie remain in memory and are never output.
const [logPath, tarball, evidencePath] = process.argv.slice(2);
try {
  assert(logPath && tarball && evidencePath, 'Three verification paths are required');
  const log = await readFile(logPath, 'utf8');
  const urls = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s"<>]+/g) || [];
  assert(urls.length > 0, 'Owned localhost endpoint missing');
  const launch = new URL(urls.at(-1));
  assert.equal(launch.hostname, '127.0.0.1');
  assert.equal(launch.pathname, '/');
  const origin = launch.origin;
  const response = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert([301, 302, 303, 307, 308].includes(response.status), 'Launch exchange must redirect');
  const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert(cookie, 'Browser session cookie missing');
  async function rpc(method, args = {}) {
    const rpcId = randomUUID();
    const endpoint = `pluginManager/${method}`;
    const reply = await fetch(`${origin}/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie, Origin: origin },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      signal: AbortSignal.timeout(60000),
    });
    assert(reply.ok, `Public ${endpoint} did not return HTTP success`);
    const envelope = await reply.json();
    assert.equal(envelope.type, 'server-response');
    assert.equal(envelope.rpcId, rpcId);
    assert(envelope.result?.ok, `Public ${endpoint} failed`);
    return envelope.result.value;
  }
  const bundles = await rpc('listBundles');
  const plugins = await rpc('listPlugins');
  const exemptions = await rpc('listVersionExemptions');
  assert(!bundles.some(item => item.name === 'oh-my-dsh'), 'Refused candidate remains in bundle inventory');
  assert(!plugins.some(item => item.moduleName === 'oh-my-dsh'), 'Refused candidate remains in plugin inventory');
  assert.deepEqual(exemptions.exemptions, {}, 'Fresh profile must not grant exemptions');
  // The actual settings backend gives a structured refusal independent of CLI text.
  const result = await rpc('installBundle', { spec: tarball });
  assert.equal(result.application, 'failed');
  assert.equal(result.changed, false);
  assert.equal(result.error?.code, 'incompatible-version');
  const incompatible = result.error.incompatible;
  assert(incompatible?.length > 0, 'Structured incompatibility evidence missing');
  // The manager can report the same package from more than one validation pass.
  for (const issue of incompatible) {
    assert.equal(issue.name, 'oh-my-dsh');
    assert.equal(issue.version, '0.1.0');
    assert.equal(issue.runtimeVersion, '0.2.0-rc.2');
    assert.equal(Object.keys(issue.peers).length, 12);
    assert(Object.values(issue.peers).every(range => range === '^0.1.0-rc.6'), 'Unexpected peer requirements');
  }
  const after = await rpc('listBundles');
  assert(!after.some(item => item.name === 'oh-my-dsh'), 'Rejected backend install activated candidate');
  const evidence = {
    transport: 'Installed Desktop public Connection HTTP RPC',
    noCandidateBundle: true, noCandidatePlugin: true, exemptions: exemptions.exemptions,
    install: { application: result.application, changed: result.changed, error: { code: result.error.code, incompatible } },
    noCandidateBundleAfterRetry: true, modelCalls: 0,
  };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  // Fetch errors can contain request URLs. Do not expose arbitrary diagnostics.
  console.error(error instanceof assert.AssertionError ? `Community Host assertion failed: ${error.message}` : 'Community Host verification failed; inspect the local code and private logs.');
  process.exitCode = 1;
}
