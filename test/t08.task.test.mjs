import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';

class CompanionAdapter extends LlmAdapter {
  constructor(label, calls) { super(); this.label = label; this.calls = calls; }
  providerInfo(provider) { return { id: provider, name: `Companion ${this.label}` }; }
  async listModels(provider) { return [{ provider, id: 'shared-model', name: `Shared ${this.label}`, inputModalities: ['text'] }]; }
  async resolveModel(provider, id) { return { provider, id, name: `Shared ${this.label}`, context: { contextWindow: 16384 }, inputModalities: ['text'] }; }
  async *stream(options) {
    this.calls.push({ provider: options.provider, model: options.model });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: `COMPANION_${this.label}` };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `COMPANION_${this.label}` } };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('native candidates with the same model stay isolated and only an explicitly enabled candidate executes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-task-'));
  const callsA = [], callsB = [];
  let ctx;
  try {
    ctx = await startNative(home, { beforeRouter(host) {
      host.llm.registerAdapter(['companion-a'], new CompanionAdapter('A', callsA));
      host.llm.registerAdapter(['companion-b'], new CompanionAdapter('B', callsB));
      host.llm.registerConfigurableProviders([
        { provider: 'companion-a', displayName: 'Companion A', settingsNs: 'companion', settingsPath: ['accounts', 'a'] },
        { provider: 'companion-b', displayName: 'Companion B', settingsNs: 'companion', settingsPath: ['accounts', 'b'] },
      ]);
    } });
    const discovered = await ctx.router.refreshConnections();
    const native = discovered.models.filter(model => model.ownership === 'native-reference');
    assert.equal(native.length, 2);
    assert.notEqual(native[0].candidateId, native[1].candidateId);
    assert.equal(native.every(model => model.model === 'shared-model' && !model.enabled), true);
    assert.equal(native.every(model => model.accountId === 'unknown' && model.billingPath === 'unknown'), true);
    assert.deepEqual(native[0].identity, Object.fromEntries(['connectionId', 'accountId', 'billingPath', 'provider', 'model'].map(key => [key, native[0][key]])));
    assert.equal(native.every(model => Number.isSafeInteger(model.connectionConfigRevision) && model.connectionConfigRevision >= 1), true);
    assert.equal(callsA.length + callsB.length, 0);

    const selected = native.find(model => model.provider === 'companion-b');
    await ctx.router.setModelEnabled(selected.candidateId, true);
    await ctx.router.setPriceQuote(selected.candidateId, { source: 'T08 synthetic native quote; no network or bill', date: '2026-10-07', currency: 'USD', kind: 'api-calculated', confidence: 'declared', perMillion: { input: 1, output: 2 }, reasoning: 'included-in-output' });
    await ctx.router.setFixedModel(selected.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submit(ctx, sessionId, 'Reply SHOULD_NOT_REWRITE_NATIVE_RESULT');
    assert.equal(task.result, 'COMPANION_B');
    assert.deepEqual(callsA, []);
    assert.equal(callsB.length, 1);
    assert.deepEqual(task.calls[0].selection, {
      connectionId: selected.connectionId,
      accountId: 'unknown',
      billingPath: 'unknown',
      provider: 'companion-b',
      model: 'shared-model',
    });
    assert.equal(task.calls[0].candidateId, selected.candidateId);
    assert.equal(task.calls[0].selectionSnapshot.authEpoch, selected.authEpoch);
    assert.equal(task.calls[0].priceQuote.source, 'T08 synthetic native quote; no network or bill');
    assert.equal(typeof task.calls[0].quoteVersion, 'string');

    await ctx.router.removeModel(selected.candidateId);
    const blocked = await submit(ctx, sessionId, 'Reply MUST_NOT_DISPATCH');
    assert.equal(blocked.lifecycle, 'paused');
    assert.equal(blocked.pauseReason, 'FIXED_MODEL_UNAVAILABLE');
    assert.equal(callsB.length, 1);
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('owned registration deduplicates an already visible route and never projects unrecognized secret fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-owned-'));
  const calls = [];
  let ctx;
  try {
    ctx = await startNative(home, { beforeRouter(host) { host.llm.registerAdapter(['owned-later'], new CompanionAdapter('OWNED', calls)); } });
    const before = await ctx.router.refreshConnections();
    assert.equal(before.models.filter(model => model.provider === 'owned-later').length, 1);
    const dispose = ctx.router.registerOwned({
      provider: 'owned-later', connectionId: 'router-owned-account-7', accountId: 'account-7', billingPath: 'api-funded',
      ownership: 'router-owned', source: 'provider-plugin-registration', sourceKey: 'owned-later:account-7:v1', configRevision: 4,
      configured: true, secret: 'MUST_NOT_APPEAR',
      models: [{ model: 'shared-model', name: 'Owned shared model', maxContextTokens: 8192, capability: {
        text: { supported: true, confidence: 'declared' }, image: { supported: null, confidence: 'unknown' }, tools: { supported: null, confidence: 'unknown' },
      } }],
    });
    const snapshot = await ctx.router.snapshot();
    const matches = snapshot.models.filter(model => model.provider === 'owned-later');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].ownership, 'router-owned');
    assert.equal(matches[0].connectionId, 'router-owned-account-7');
    assert.equal(matches[0].accountId, 'account-7');
    assert.equal(JSON.stringify(snapshot).includes('MUST_NOT_APPEAR'), false);
    dispose();
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('host disconnect revokes a prepared native call and restart keeps the stable candidate identity with a new epoch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-revoke-'));
  const calls = [];
  let disposeProvider, ctx, run, release;
  const install = host => {
    disposeProvider = host.llm.registerAdapter(['companion-revocable'], new CompanionAdapter('REVOCABLE', calls));
    host.llm.registerConfigurableProviders([{ provider: 'companion-revocable', displayName: 'Companion revocable', settingsNs: 'companion', settingsPath: ['revocable'] }]);
  };
  try {
    ctx = await startNative(home, { beforeRouter: install });
    let snapshot = await ctx.router.refreshConnections();
    const candidate = snapshot.models.find(model => model.provider === 'companion-revocable');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const entered = Promise.withResolvers(); release = Promise.withResolvers();
    ctx.on('agent/request', async (_request, next) => { const config = await next(); entered.resolve(); await release.promise; return config; }, { prepend: true });
    run = submit(ctx, sessionId, 'Reply MUST_BE_REVOKED');
    await entered.promise;
    disposeProvider();
    snapshot = await ctx.router.refreshConnections();
    const tombstone = snapshot.models.find(model => model.candidateId === candidate.candidateId);
    assert.equal(tombstone.available, false);
    assert.ok(tombstone.authEpoch > candidate.authEpoch);
    release.resolve();
    const blocked = await run;
    assert.equal(blocked.lifecycle, 'paused');
    assert.equal(blocked.pauseReason, 'CONNECTION_REMOVED');
    assert.equal(calls.length, 0);

    await ctx.fiber.dispose(); ctx = null;
    ctx = await startNative(home, { beforeRouter: install });
    snapshot = await ctx.router.refreshConnections();
    const restored = snapshot.models.find(model => model.provider === 'companion-revocable');
    assert.equal(restored.candidateId, candidate.candidateId);
    assert.ok(restored.authEpoch > tombstone.authEpoch);
    assert.equal(restored.enabled, true);
    assert.equal(snapshot.config.fixedCandidateId, candidate.candidateId);
  } finally {
    release?.resolve?.();
    if (run) await run.catch(() => {});
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a public settings revision change invalidates the captured native identity before dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-settings-'));
  const calls = [];
  let ctx, run, release;
  let revision = 0;
  try {
    ctx = await startNative(home, { beforeRouter(host) {
      host.provide('settings', { describe: () => [{ ns: 'revisioned-provider', revision, value: {}, secrets: [] }] });
      host.llm.registerAdapter(['revisioned-native'], new CompanionAdapter('REVISION', calls));
      host.llm.registerConfigurableProviders([{ provider: 'revisioned-native', displayName: 'Revisioned native', settingsNs: 'revisioned-provider', settingsPath: [] }]);
    } });
    const candidate = (await ctx.router.refreshConnections()).models.find(model => model.provider === 'revisioned-native');
    assert.equal(candidate.observedSettingsRevision, 0);
    assert.ok(candidate.connectionConfigRevision >= 1);
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const entered = Promise.withResolvers(); release = Promise.withResolvers();
    ctx.on('agent/request', async (_request, next) => { const config = await next(); entered.resolve(); await release.promise; return config; }, { prepend: true });
    run = submit(ctx, sessionId, 'Reply OLD_REVISION_MUST_NOT_RUN');
    await entered.promise;
    revision = 1;
    ctx.emit('settings/document-updated', 'revisioned-provider', revision);
    await ctx.router.refreshConnections();
    release.resolve();
    const task = await run;
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.pauseReason, 'CONNECTION_CHANGED');
    assert.equal(calls.length, 0);
  } finally {
    release?.resolve();
    if (run) await run.catch(() => {});
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a stale model-catalog response cannot revive a provider removed by a newer refresh', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-refresh-race-'));
  const delayed = Promise.withResolvers();
  let listCount = 0, disposeProvider, ctx;
  class DelayedCatalog extends CompanionAdapter {
    async listModels(provider) {
      listCount += 1;
      if (listCount > 1) await delayed.promise;
      return super.listModels(provider);
    }
  }
  try {
    ctx = await startNative(home, { beforeRouter(host) { disposeProvider = host.llm.registerAdapter(['racy-native'], new DelayedCatalog('RACY', [])); } });
    const candidate = (await ctx.router.snapshot()).models.find(model => model.provider === 'racy-native');
    const stale = ctx.router.refreshConnections();
    while (listCount < 2) await new Promise(resolve => setTimeout(resolve, 0));
    disposeProvider();
    const current = await ctx.router.refreshConnections();
    assert.equal(current.models.find(model => model.candidateId === candidate.candidateId).available, false);
    delayed.resolve();
    await stale;
    const final = await ctx.router.snapshot();
    assert.equal(final.models.find(model => model.candidateId === candidate.candidateId).available, false);
  } finally {
    delayed.resolve();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('the Host reservation seam rejects a candidateId paired with another candidate identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t08-spoof-'));
  let ctx, run, release;
  try {
    ctx = await startNative(home);
    const entered = Promise.withResolvers(); release = Promise.withResolvers();
    ctx.on('agent/request', async (_request, next) => { const config = await next(); entered.resolve(); await release.promise; return config; }, { prepend: true });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply RESERVATION_IDENTITY_OK');
    await entered.promise;
    const snapshot = await ctx.router.snapshot();
    const task = snapshot.tasks.find(item => item.sessionId === sessionId);
    const controlled = snapshot.models.find(model => model.model === 'controlled');
    const other = snapshot.models.find(model => model.model === 'controlled-tools');
    const signal = new AbortController().signal;
    await assert.rejects(ctx.router.reserveCall(task.id, {
      purpose: 'review', candidateId: controlled.candidateId,
      selection: Object.fromEntries(['connectionId', 'accountId', 'billingPath', 'provider', 'model'].map(key => [key, other[key]])),
      selectionSnapshot: { candidateId: controlled.candidateId, identity: Object.fromEntries(['connectionId', 'accountId', 'billingPath', 'provider', 'model'].map(key => [key, other[key]])), authEpoch: controlled.authEpoch, connectionConfigRevision: controlled.connectionConfigRevision },
      routerSnapshot: snapshot.config,
    }, signal), /does not match/);
    assert.equal((await ctx.router.snapshot()).tasks.find(item => item.id === task.id).calls.length, 1);
    release.resolve();
    assert.equal((await run).result, 'RESERVATION_IDENTITY_OK');
  } finally {
    release?.resolve();
    if (run) await run.catch(() => {});
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
