import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { startNative } from './t02-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'lib');
const relativeImports = /(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/gu;

test('the built Host has a closed relative import graph and its package entrypoint loads', async () => {
  const files = (await readdir(lib)).filter(file => file.endsWith('.js'));
  for (const file of files) {
    const source = await readFile(join(lib, file), 'utf8');
    for (const match of source.matchAll(relativeImports)) {
      const dependency = resolve(lib, match[1]);
      await assert.doesNotReject(access(dependency), `${file} imports missing build output ${match[1]}`);
    }
  }

  const host = await import(`${pathToFileURL(join(lib, 'index.js')).href}?closure-test=${Date.now()}`);
  assert.equal(typeof host.apply, 'function');
  assert.equal(typeof host.RouterService, 'function');

  const home = await mkdtemp(join(tmpdir(), 'router-t05-built-host-'));
  let ctx;
  try {
    ctx = await startNative(home, { routerPlugin: host });
    const snapshot = await ctx.router.snapshot();
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.storageError, null);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
