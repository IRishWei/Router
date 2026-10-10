// Execution is gated on actual final source and installed independent reviews.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { verifyFrozenT18Labels } from './t18-label-preservation.mjs';

const root = 'E:/GPT/Router项目';
const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const notes = join(directory, 'implement-spec-go-20261009');
const label = process.argv[2];
assert(/^t18-v017\d[a-z]$/.test(label));
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const loadPath = async path => JSON.parse(await readFile(path, 'utf8'));
const sourceGate = await loadPath(join(notes, 't18-final-reviewed-source.json'));
const installedGate = await loadPath(join(notes, 't18-final-installed-reviews.json'));
assert(sourceGate.standards.passed && sourceGate.spec.passed && sourceGate.merger.passed);
assert(installedGate.standards.passed && installedGate.spec.passed);
assert.equal(installedGate.label, label);
assert.equal(installedGate.source, sourceGate.source);
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), sourceGate.source);
assert.equal(git(['branch', '--show-current']), 'codex/dsh-router-v1');
assert.equal(git(['status', '--porcelain']), '');
const preservation = await verifyFrozenT18Labels();
const frozenPath = join(directory, label + '-validation-frozen.json');
const frozen = await loadPath(frozenPath);
assert.equal(frozen.phase, 'validation-complete-pending-independent-final-review');
const summary = await loadPath(join(directory, label + '-desktop-summary.json'));
assert.equal(summary.reviewedSourceSha, sourceGate.source);
assert.equal(summary.version, sourceGate.version);
assert.equal(summary.realModelRequests, 0);
assert.equal(summary.restart.newStreams, 0);
assert(summary.restart.fullTasksCallsLedgersUnchanged && summary.restart.configUnchanged && summary.restart.fixtureCounterUnchanged);
assert(summary.restart.stateScope.allStoredFieldsOutsideCurrentRegistryUnchanged);
assert(summary.restart.stateScope.completeCounterBytesUnchanged);
assert(summary.restart.stateScope.currentRegistryRefreshMatchesPredeclaredFields);
assert(summary.controlledStop.stopped && summary.restartStop.stopped);
assert(summary.Renderer.passed && summary.Renderer.liveRecovery.passed);
const selections = new Map();
const select = (path, name = basename(path)) => {
  assert(/^t18-[A-Za-z0-9._-]+$/.test(name));
  if (selections.has(name)) assert.equal(selections.get(name), path);
  else selections.set(name, path);
};
for (const gate of [sourceGate, installedGate]) {
  for (const axis of ['standards', 'spec']) {
    const receipt = gate[axis].report, bytes = await readFile(receipt.path);
    assert.equal(bytes.length, receipt.bytes); assert.equal(hash(bytes), receipt.sha256);
    select(receipt.path);
  }
}
for (const receipt of sourceGate.merger.receipts) {
  const bytes = await readFile(receipt.path);
  assert.equal(bytes.length, receipt.bytes); assert.equal(hash(bytes), receipt.sha256);
  select(receipt.path);
}
for (const suffix of ['package-identity.json', 'desktop-summary.json', 'public-proof.json', 'renderer-evidence.json',
  'live-renderer-evidence.json', 'restart-evidence.json', 'restart-state-scope.json', 'state-pre-restart.json',
  'validation-frozen.json', 'reviewed-contract.md', 'controlled-execution-sources.json', 'restart-execution-sources.json',
  'offline-cli-receipt.json', 'controlled-rpc-run.log', 'controlled-renderer-run.log', 'restart-rpc-run.log', 'restart-renderer-run.log']) {
  select(join(directory, label + '-' + suffix));
}
for (const record of preservation.records) {
  select(join(directory, record.manifest));
  if (record.phase.startsWith('failed')) {
    const prior = await loadPath(join(directory, record.manifest));
    for (const suffix of ['controlled-rpc-run.log', 'controlled-stopped.json', 'controlled-execution-sources.json',
      'offline-cli-receipt.json', 'reviewed-contract.md', 'package-identity.json']) {
      select(join(directory, prior.label + '-' + suffix));
    }
    select(join(notes, prior.label + '-validation-plan.json'));
    const capture = await loadPath(join(directory, prior.label + '-controlled-execution-sources.json'));
    for (const entry of capture.copied) select(entry.executed);
    for (const entry of capture.dependencies) select(entry.captured);
  }
}
for (const stage of ['controlled', 'restart']) {
  const capture = await loadPath(join(directory, label + '-' + stage + '-execution-sources.json'));
  for (const entry of capture.copied) select(entry.executed);
  for (const entry of capture.dependencies) select(entry.captured);
}
select(join(directory, label + '-fixture-bundle/lib/index.js'), label + '-installed-fixture.js');
select(join(notes, label + '-validation-plan.json'));
select(join(notes, 't18-final-reviewed-source.json'));
select(join(notes, 't18-final-installed-reviews.json'));
for (const entry of await readdir(notes, { withFileTypes: true })) {
  if (entry.isFile() && /^t18-(?:slice|source|r[0-9]+-fix|merged|merger|review|desktop-validation-adjustment|counter-lock|v017\d[a-z]-readonly-diagnosis).*\.(?:log|md|json|diff|patch|mjs|ps1)$/.test(entry.name)) {
    select(join(notes, entry.name));
  }
}
const copies = [];
for (const [name, sourcePath] of [...selections.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const bytes = await readFile(sourcePath), archivePath = 'VERIFY/' + name, destination = join(root, archivePath);
  try { await access(destination); assert.deepEqual(await readFile(destination), bytes); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(destination, bytes, { flag: 'wx' }); }
  assert.equal(hash(await readFile(destination)), hash(bytes));
  copies.push({ sourcePath, archivePath, bytes: bytes.length, sha256: hash(bytes) });
}
const index = {
  ticket: 'https://github.com/IRishWei/Router/issues/19', version: sourceGate.version, label,
  reviewedSourceSha: sourceGate.source, phase: 'installed-independent-review-complete',
  sourceReviews: { standards: sourceGate.standards, spec: sourceGate.spec },
  installedReviews: { standards: installedGate.standards, spec: installedGate.spec },
  immutableValidationPhase: frozen.phase, frozenT18FileEntriesVerified: preservation.frozenT18FileEntries,
  package: summary.package, Tasks: summary.Tasks, Calls: summary.Calls,
  actualControlledStreams: summary.actualControlledStreams, knownPresetTokens: summary.knownPresetTokens,
  unknownUsageCalls: summary.unknownUsageCalls, productionModelRequests: 0, archiveFiles: copies,
  note: 'Exact byte copies retain every prior failed and pending-review phase. This separate index records completed independent review. Owner secrets and bootstrap log bodies are excluded. Installed restart covers terminal Tasks; live pending restart is source-fixture evidence. Registry refresh and raw whole-state equality retain the predeclared scope and actual result.',
};
const target = join(root, 'VERIFY/t18-final-review-archive.json'), bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
try { await access(target); assert.deepEqual(await readFile(target), bytes); }
catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(target, bytes, { flag: 'wx' }); }
console.log(JSON.stringify({ archivedFiles: copies.length + 1, frozenT18FileEntriesVerified: preservation.frozenT18FileEntries,
  archiveIndex: target, archiveIndexSha256: hash(bytes), reviewedSourceSha: sourceGate.source, productionModelRequests: 0 }));
