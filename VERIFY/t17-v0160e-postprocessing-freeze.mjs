import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { preserveFrozenLabels } from './t17-label-preservation.mjs';
import { verifyRestartStateScope } from './t17-restart-state-scope-e-repair.mjs';
const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const notes = join(directory, 'implement-spec-go-20261009');
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const label = process.argv[2], phase = process.argv[3];
assert(/^t17-v016\d[a-z]$/.test(label));
assert(['failed-controlled','failed-restart','validation-complete-pending-independent-final-review'].includes(phase));
const target = join(directory, label + '-' + (phase.startsWith('failed') ? phase : 'validation') + '-frozen.json');
try { await access(target); throw new Error('Frozen label capture already exists'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const paths = new Set((await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.startsWith(label + '-') && !entry.name.endsWith('-frozen.json'))
  .map(entry => join(directory, entry.name)));
for (const path of [join(notes, 't17-restart-state-scope-e-repair.mjs'), join(notes, 't17-v0160e-postprocessing-freeze.mjs'), join(directory, 't17-v0160e-postprocessing-repair.json')]) paths.add(path);
const priorLabels = await preserveFrozenLabels();
for (const name of priorLabels.manifests) paths.add(join(directory, name));
if (!phase.startsWith('failed')) {
  for (const entry of await readdir(notes, { withFileTypes: true })) {
    if (entry.isFile() && (/^t17-(?!v016).*\.log$/.test(entry.name)
      || /^t17-source-(standards|spec)-r\d+\.md$/.test(entry.name)
      || /^t17-(?:finish|root-finish)-.*(?:result.*\.md|receipt-hashes.*\.json)$/.test(entry.name)
      || /^t17-merger-.*\.(?:ps1|json|log|md)$/.test(entry.name)
      || /^t17-review-[a-f0-9]+\.tar$/.test(entry.name))) paths.add(join(notes, entry.name));
  }
  for (const name of ['t17-finish-receipt-hashes.json', 't17-finish-combined-receipt-hashes.json',
    't17-root-finish-receipt-hashes.json']) {
    const path = join(notes, name), manifest = JSON.parse(await readFile(path, 'utf8'));
    paths.add(path);
    for (const entry of manifest.files) {
      assert(!entry.file.includes('/') && !entry.file.includes('\\') && !entry.file.includes('..'));
      const path = join(notes, entry.file), bytes = await readFile(path);
      assert.equal(bytes.length, entry.bytes);
      assert.equal(hash(bytes), entry.sha256.toUpperCase());
      paths.add(path);
    }
  }
}
for (const suffix of ['controlled-execution-sources.json','restart-execution-sources.json']) {
  const path = join(directory, label + '-' + suffix);
  try {
    const sources = JSON.parse(await readFile(path, 'utf8'));
    for (const copied of sources.copied) {
      assert.equal(hash(await readFile(copied.executed)), copied.sha256);
      paths.add(copied.executed);
    }
    for (const dependency of sources.dependencies) {
      const bytes = await readFile(dependency.captured);
      assert.equal(bytes.length, dependency.bytes);
      assert.equal(hash(bytes), dependency.sha256);
      if (!phase.startsWith('failed')) assert.equal(hash(await readFile(dependency.path)), dependency.sha256,
        'A dependency used by the actual validation changed after its capture');
      paths.add(dependency.captured);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const path of [join(directory, label + '-controlled-home/t17-controlled-counts.json'),
  join(directory, label + '-fixture-bundle/lib/index.js'),
  join(directory, label + '-controlled-home/router/desktop/state.json')]) {
  try { await access(path); paths.add(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const files = [];
for (const path of [...paths].sort()) {
  const bytes = await readFile(path);
  files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
}
assert(files.length > 0);
if (!phase.startsWith('failed')) {
  const manifest = JSON.parse(await readFile(join(directory, label + '-package-identity.json'), 'utf8'));
  assert.equal(hash(await readFile(manifest.path)), manifest.sha256);
  for (const entry of manifest.files) {
    const bytes = await readFile(join(directory, label + '-controlled-home/profiles/desktop/node_modules/@irishwei/dsh-router', entry.file));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
  }
  const sealed = JSON.parse(await readFile(join(directory, label + '-state-pre-restart.json'), 'utf8'));
  if (label === 't17-v0160e') {
    const scope = await verifyRestartStateScope(label);
    const saved = JSON.parse(await readFile(join(directory, label + '-restart-state-scope.json'), 'utf8'));
    assert.equal(JSON.stringify(scope), JSON.stringify(saved), 'The independent saved post-restart scope receipt must match the actual stopped state');
  } else {
    assert.deepEqual(await readFile(sealed.originalStatePath), await readFile(sealed.sealedStatePath),
      'The isolated read-only restart changed Router state bytes');
  }
  const reports = ['t17-source-standards-final.md','t17-source-spec-final.md',
    't17-merged-build.log','t17-merged-suite.log','t17-merged-check.log','t17-merged-diffcheck.log'];
  for (const name of reports) {
    const path = join(notes, name), bytes = await readFile(path);
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
}
await writeFile(target, JSON.stringify({ label, phase, files, realModelRequests: 0,
  priorLabels,
  note: 'Hashes preserve raw owned log bytes without exporting private bootstrap contents.' }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ labelFrozen: true, label, phase, files: files.length, realModelRequests: 0 }));
