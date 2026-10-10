import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = 'C:/Users/a1500/AppData/Local/Temp/router-implementation';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const clone = value => JSON.parse(JSON.stringify(value));
const identity = row => Object.fromEntries(["connectionId","accountId","billingPath","provider","model"].map(key => { assert.equal(typeof row[key], "string"); return [key, row[key]]; }));
const timestamp = value => {
  assert.equal(typeof value, 'string');
  const result = Date.parse(value);
  assert(Number.isFinite(result));
  return result;
};
export async function verifyRestartStateScope(label) {
  assert.equal(label, 't17-v0160e', 'This revised scope is predeclared only for the new e label');
  const plan = JSON.parse(await readFile(join(directory, label + '-state-pre-restart.json'), 'utf8'));
  assert.equal(plan.stateScopeProtocol, 't17-current-registry-refresh-v1');
  const original = await readFile(plan.sealedStatePath), current = await readFile(plan.originalStatePath);
  assert.equal(original.length, plan.bytes);
  assert.equal(hash(original), plan.sha256, 'The original pre-restart seal must remain exact');
  const before = JSON.parse(original), after = JSON.parse(current);
  const oldRegistry = before.connections, newRegistry = after.connections;
  const oldHistorical = clone(before), newHistorical = clone(after);
  delete oldHistorical.connections; delete newHistorical.connections;
  assert.equal(JSON.stringify(oldHistorical), JSON.stringify(newHistorical),
    'Every stored field outside the current registry must remain byte-equivalent, including full Tasks/config and historical captures');
  assert.equal(oldRegistry.candidates.length, newRegistry.candidates.length);
  const controlled = oldRegistry.candidates.filter(row => row.provider.startsWith('router-t17-controlled-fixture'));
  assert.equal(controlled.length, 14, 'Seven owned and seven native-reference fixture entries must retain their identities');
  const normalized = clone(newRegistry);
  assert.equal(newRegistry.revision, oldRegistry.revision + 28, 'The predeclared two transitions for each of 14 fixture identities must match');
  assert(timestamp(newRegistry.capturedAt) > timestamp(oldRegistry.capturedAt));
  normalized.revision = oldRegistry.revision; normalized.capturedAt = oldRegistry.capturedAt;
  const refreshed = [];
  for (let index = 0; index < oldRegistry.candidates.length; index++) {
    const oldRow = oldRegistry.candidates[index], newRow = newRegistry.candidates[index];
    assert.equal(JSON.stringify(identity(newRow)), JSON.stringify(identity(oldRow)));
    if (!oldRow.provider.startsWith('router-t17-controlled-fixture')) continue;
    assert.equal(newRow.authEpoch, oldRow.authEpoch + 2);
    assert.equal(newRow.connectionConfigRevision, oldRow.connectionConfigRevision + 2);
    normalized.candidates[index].authEpoch = oldRow.authEpoch;
    normalized.candidates[index].connectionConfigRevision = oldRow.connectionConfigRevision;
    if (oldRow.tombstone) {
      assert(newRow.tombstone);
      assert(timestamp(newRow.tombstone.at) > timestamp(oldRow.tombstone.at));
      normalized.candidates[index].tombstone.at = oldRow.tombstone.at;
    }
    refreshed.push({ candidateId: oldRow.candidateId ?? oldRow.id, identity: identity(oldRow),
      previousAuthEpoch: oldRow.authEpoch, currentAuthEpoch: newRow.authEpoch,
      previousConfigRevision: oldRow.connectionConfigRevision, currentConfigRevision: newRow.connectionConfigRevision });
  }
  assert.equal(JSON.stringify(normalized), JSON.stringify(oldRegistry),
    'No other registry field may change: full identity/order/config/status/capabilities/handoff/tombstone reasons remain exact');
  const evidence = JSON.parse(await readFile(join(directory, label + '-desktop-evidence.json'), 'utf8'));
  const counts = await readFile(join(directory, label + '-controlled-home/t17-controlled-counts.json'));
  assert.deepEqual(counts, Buffer.from(JSON.stringify(evidence.counts, null, 2)), 'Complete counter bytes must remain exact');
  const result = { label, stateScopeProtocol: plan.stateScopeProtocol,
    originalStateBytes: original.length, originalStateSha256: hash(original),
    currentStateBytes: current.length, currentStateSha256: hash(current),
    rawRouterStateBytesUnchanged: original.equals(current),
    allStoredFieldsOutsideCurrentRegistryUnchanged: true,
    completeHistoricalTasksConfigAndCapturesUnchanged: true,
    completeCounterBytesUnchanged: true,
    currentRegistryRefreshMatchesPredeclaredFields: true,
    registryRevisionDelta: 28, candidateEpochDelta: 2, refreshed,
    realModelRequests: 0 };
  assert.equal(result.rawRouterStateBytesUnchanged, false, 'The current registry is expected to refresh; do not claim a whole-file byte invariant');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const label = process.argv[2], result = await verifyRestartStateScope(label);
  await writeFile(join(directory, label + '-restart-state-scope.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ label, restartStateScopeVerified: true, rawRouterStateBytesUnchanged: false,
    registryEntriesRefreshed: result.refreshed.length, allHistoricalFieldsUnchanged: true, realModelRequests: 0 }));
}
