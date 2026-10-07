import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import * as cordis from '@deepseek-ai/cordis';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import renderer, { act } from 'react-test-renderer';
import * as jsx from 'react/jsx-runtime';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import { createDeepSeekSettingsPlugin } from '../src/deepseek-client.mjs';
import { createDeepSeekUiService, deepSeekUiSchemaFactories } from '../src/deepseek-ui-contract.mjs';

function routerCandidate(candidateId = 'candidate-ui', overrides = {}) {
  const identity = {
    connectionId: 'connection-ui', accountId: 'account-ui-binding', billingPath: 'deepseek-api',
    provider: 'router-deepseek-account-ui-binding', model: 'deepseek-flash',
    ...overrides,
  };
  return {
    candidateId, identity, connectionConfigRevision: 1, authEpoch: 1, observedSettingsRevision: null,
    ownership: 'router-owned', source: 'deepseek-official-api',
    routerAuthorization: { status: 'enabled' }, providerAuthorization: { status: 'configured' },
    availability: { status: 'available' }, inferenceVerification: { status: 'unknown' },
    capabilities: {
      modalities: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' } },
      text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: true, confidence: 'declared' },
      contextWindow: { value: 1_048_576, confidence: 'declared', source: 'provider-model-metadata' },
      inputLimit: { value: null, confidence: 'unknown', source: 'host-public-contract' },
      maxOutput: { value: null, confidence: 'unknown', source: 'host-public-contract' },
      maxContextTokens: 1_048_576, confidence: 'declared', source: 'deepseek-public-documentation',
    },
    quote: null, observations: [],
  };
}

function routerCandidateSnapshot(candidate = routerCandidate()) {
  return { epoch: 1, snapshotEpoch: 1, capturedAt: null, candidates: [candidate], unsupported: [] };
}

function capturedCandidate(candidate = routerCandidate(), registryEpoch = 1) {
  return {
    candidateId: candidate.candidateId,
    identity: candidate.identity,
    registryEpoch,
    connectionConfigRevision: candidate.connectionConfigRevision,
    authEpoch: candidate.authEpoch,
    capability: candidate.capabilities,
    capabilities: candidate.capabilities,
    maxContextTokens: candidate.capabilities.maxContextTokens,
    quote: null,
    quoteVersion: null,
    enabled: true,
  };
}

function detectionTask(request, candidate = routerCandidate(), capture = capturedCandidate(candidate)) {
  return {
    id: 'task-detection', lifecycle: 'completed', result: 'DEEPSEEK_CONNECTION_OK',
    budget: { limits: { tokens: request.budget.tokens, durationMs: request.budget.durationMs, money: [] } },
    ledger: { tokens: { total: 8 }, knownTokens: { total: 8 }, money: [], unknownPriceCalls: 1, callCount: 1, elapsedMs: 10 },
    calls: [{
      id: 'call-detection', purpose: 'execution', candidateId: request.candidateId,
      selection: candidate.identity,
      selectionSnapshot: {
        candidateId: request.candidateId, identity: candidate.identity,
        registryEpoch: capture.registryEpoch,
        authEpoch: candidate.authEpoch, connectionConfigRevision: candidate.connectionConfigRevision,
      },
      status: 'completed', usage: { totalTokens: 8 }, cost: { amount: null, reason: 'PRICE_UNKNOWN' },
    }],
  };
}

async function loadClient(path, imports) {
  let plugin;
  vm.runInNewContext(await readFile(path, 'utf8'), {
    queueMicrotask, AbortController, AbortSignal, crypto: webcrypto, console,
    window: { __ModuleLoader__: { load(module) { plugin = module.factory(name => imports[name]); } } },
  }, { filename: path });
  return plugin;
}

async function mountDeepSeekSettings(service, routerApi) {
  const imports = { react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slots, 'react-dom': {}, 'react-dom/client': {} };
  const nativeRenderer = await loadClient('node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js', imports);
  const ctx = new cordis.Context();
  let page;
  try {
    await ctx.plugin(nativeRenderer);
    const binding = { hooks: {}, keyedHooks: {}, props: {}, ctx };
    ctx.slots.installScope('session', { current: { getSnapshot: () => binding, subscribe: () => () => {} } });
    ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, ({ renderSlot }) => React.createElement('main', null, renderSlot('settings.section', {}, { only: 'router-deepseek' })));
    await ctx.plugin(createDeepSeekSettingsPlugin(React, service, routerApi));
    await act(async () => { page = renderer.create(ctx.slots.renderSlot('root', {})); });
    return { page, async dispose() { await act(async () => { page.unmount(); }); await ctx.fiber.dispose(); } };
  } catch (error) {
    if (page) await act(async () => { page.unmount(); });
    await ctx.fiber.dispose();
    throw error;
  }
}

test('the DeepSeek UI keeps credential save, connection, enablement and budgeted detection separate', async () => {
  const secret = 'ui-only-controlled-secret';
  const actions = [];
  const safe = {
    bindings: [],
    connections: [],
    catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] },
  };
  const router = { models: [] };
  const host = { candidateSnapshot: routerCandidateSnapshot(), tasks: [] };
  const callbacks = {
    snapshot: async () => structuredClone(safe),
    routerSnapshot: async () => structuredClone(host),
    captureCandidate: async candidateId => capturedCandidate(routerCandidate(candidateId)),
    saveCredential: async ({ apiKey }) => {
      actions.push({ action: 'save', apiKey });
      const binding = { accountId: 'account-ui-binding', configured: true, writable: true };
      safe.bindings.push(binding);
      return binding;
    },
    discoverCatalog: async () => {
      actions.push({ action: 'catalog' });
      safe.catalog = { status: 'listed', models: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }], unrecognizedModelIds: [] };
      return safe.catalog;
    },
    connect: async ({ accountId }) => {
      actions.push({ action: 'connect', accountId });
      const connection = { connectionId: 'connection-ui', accountId, provider: `router-deepseek-${accountId}`, configured: true };
      safe.connections.push(connection);
      router.models.push({
        candidateId: 'candidate-ui', connectionId: connection.connectionId, accountId,
        billingPath: 'deepseek-api', provider: connection.provider, model: 'deepseek-flash',
        name: 'DeepSeek V4.1 Flash', source: 'deepseek-official-api', available: true, enabled: false, inPool: false,
      });
      return connection;
    },
    disconnect: async request => {
      actions.push({ action: 'disconnect', ...request });
      safe.connections = safe.connections.filter(connection => connection.connectionId !== request.connectionId);
      router.models = [];
    },
    runDetection: async request => {
      actions.push({ action: 'detect', ...request });
      const task = detectionTask(request, routerCandidate(request.candidateId), request.selectionSnapshot);
      host.tasks.push(task);
      return { taskId: task.id };
    },
  };
  const routerApi = {
    snapshot: async () => structuredClone(router),
    async setModelEnabled(candidateId, enabled) {
      actions.push({ action: 'enable', candidateId, enabled });
      router.models[0] = { ...router.models[0], enabled, inPool: true };
      return structuredClone(router);
    },
  };
  const service = createDeepSeekUiService(callbacks);
  let mounted;
  try {
    mounted = await mountDeepSeekSettings(service, routerApi);
    const { page } = mounted;
    const button = label => page.root.findAllByType('button').find(item => item.children.includes(label));
    const input = label => page.root.findByProps({ 'aria-label': label });

    await act(async () => { input('DeepSeek API key').props.onChange({ target: { value: secret } }); });
    assert.equal(JSON.stringify(page.toJSON()).includes(secret), false);
    await act(async () => { await button('保存账号密钥').props.onClick(); });
    assert.deepEqual(actions, [{ action: 'save', apiKey: secret }]);
    assert.equal(JSON.stringify(page.toJSON()).includes(secret), false);

    await act(async () => { await button('获取公开模型目录').props.onClick(); });
    assert.equal(actions.at(-1).action, 'catalog');
    assert.match(JSON.stringify(page.toJSON()), /DeepSeek V4.1 Flash/);
    await act(async () => { await button('连接账号 account-ui-binding').props.onClick(); });
    assert.equal(actions.some(action => action.action === 'enable'), false);
    await act(async () => { await button('加入模型选择 DeepSeek V4.1 Flash').props.onClick(); });
    assert.equal(actions.at(-1).action, 'enable');

    await act(async () => { input('检测 token 上限').props.onChange({ target: { value: '32' } }); });
    await act(async () => { input('检测耗时上限（毫秒）').props.onChange({ target: { value: '1500' } }); });
    await act(async () => { await button('运行有限预算检测').props.onClick(); });
    const detection = actions.at(-1);
    assert.deepEqual(detection.budget, { tokens: 32, durationMs: 1500 });
    assert.equal(detection.candidateId, 'candidate-ui');
    assert.equal(Object.hasOwn(detection, 'model'), false);
    const rendered = JSON.stringify(page.toJSON());
    assert.match(rendered, /费用未知/);
    assert.match(rendered, /task-detection/);
    assert.equal(rendered.includes(secret), false);

    await act(async () => { await button('断开连接并保留密钥 connection-ui').props.onClick(); });
    assert.deepEqual(actions.at(-1), { action: 'disconnect', connectionId: 'connection-ui', deleteCredential: false });
    assert.equal(safe.bindings.length, 1);
    await act(async () => { await button('连接账号 account-ui-binding').props.onClick(); });
    assert.equal(actions.at(-1).action, 'connect');
    assert.equal(router.models[0].enabled, false);
    assert.match(JSON.stringify(page.toJSON()), /尚未加入/);
  } finally {
    if (mounted) await mounted.dispose();
  }
});

test('the DeepSeek Renderer distinguishes same-model candidates by connection, account and billing source', async () => {
  const first = routerCandidate('candidate-first', {
    connectionId: 'connection-first', accountId: 'account-first', provider: 'router-deepseek-account-first',
  });
  const second = routerCandidate('candidate-second', {
    connectionId: 'connection-second', accountId: 'account-second', provider: 'router-deepseek-account-second',
  });
  const actions = [];
  const models = [first, second].map(candidate => ({
    candidateId: candidate.candidateId,
    ...candidate.identity,
    name: 'DeepSeek V4.1 Flash', source: 'deepseek-official-api', available: true, enabled: true, inPool: true,
  }));
  const tasks = [];
  const service = createDeepSeekUiService({
    snapshot: async () => ({ bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] } }),
    routerSnapshot: async () => ({ candidateSnapshot: { ...routerCandidateSnapshot(first), candidates: [first, second] }, tasks }),
    captureCandidate: async candidateId => capturedCandidate(candidateId === second.candidateId ? second : first),
    saveCredential: async () => { throw new Error('unused'); },
    discoverCatalog: async () => { throw new Error('unused'); },
    connect: async () => { throw new Error('unused'); },
    disconnect: async () => { throw new Error('unused'); },
    runDetection: async request => {
      actions.push(request);
      const candidate = request.candidateId === second.candidateId ? second : first;
      const task = detectionTask(request, candidate, request.selectionSnapshot);
      tasks.push(task);
      return { taskId: task.id };
    },
  });
  const routerApi = {
    snapshot: async () => ({ models: structuredClone(models) }),
    setModelEnabled: async () => ({ models: structuredClone(models) }),
  };
  let mounted;
  try {
    mounted = await mountDeepSeekSettings(service, routerApi);
    const select = mounted.page.root.findByProps({ 'aria-label': '检测模型与账号' });
    const labels = select.findAllByType('option').map(option => option.children.join(''));
    assert.equal(labels.some(label => label.includes('connection-first') && label.includes('account-first') && label.includes('deepseek-api')), true);
    assert.equal(labels.some(label => label.includes('connection-second') && label.includes('account-second') && label.includes('deepseek-api')), true);
    await act(async () => { select.props.onChange({ target: { value: second.candidateId } }); });
    const detect = mounted.page.root.findAllByType('button').find(item => item.children.includes('运行有限预算检测'));
    await act(async () => { await detect.props.onClick(); });
    assert.equal(actions.at(-1).candidateId, second.candidateId);
  } finally {
    if (mounted) await mounted.dispose();
  }
});

test('DeepSeek UI request errors never echo the raw key', async () => {
  const secret = 'must-not-echo-secret';
  const service = createDeepSeekUiService({
    snapshot: async () => ({ bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] } }),
    routerSnapshot: async () => ({ candidateSnapshot: routerCandidateSnapshot(), tasks: [] }),
    captureCandidate: async () => capturedCandidate(),
    saveCredential: async () => { throw new Error(`backend rejected ${secret}`); },
    discoverCatalog: async () => { throw new Error('unused'); },
    connect: async () => { throw new Error('unused'); },
    disconnect: async () => { throw new Error('unused'); },
    runDetection: async () => { throw new Error('unused'); },
  });
  await assert.rejects(service.saveCredential({ apiKey: secret }), error => {
    assert.equal(error.code, 'DEEPSEEK_UI_OPERATION_FAILED');
    assert.equal(String(error).includes(secret), false);
    return true;
  });
  await assert.rejects(service.runDetection({ candidateId: 'candidate', budget: { tokens: 0, durationMs: null } }), error => {
    assert.equal(error.code, 'DEEPSEEK_UI_REQUEST_INVALID');
    return true;
  });
});

test('DeepSeek detection resolves only the Host candidate and rejects a mismatched Call identity', async () => {
  const selected = routerCandidate('candidate-selected');
  const host = { candidateSnapshot: routerCandidateSnapshot(selected), tasks: [] };
  const service = createDeepSeekUiService({
    snapshot: async () => ({ bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] } }),
    routerSnapshot: async () => structuredClone(host),
    captureCandidate: async () => capturedCandidate(selected),
    saveCredential: async () => { throw new Error('unused'); },
    discoverCatalog: async () => { throw new Error('unused'); },
    connect: async () => { throw new Error('unused'); },
    disconnect: async () => { throw new Error('unused'); },
    runDetection: async request => {
      const wrong = routerCandidate(request.candidateId);
      wrong.identity = { ...wrong.identity, provider: 'wrong-provider', model: 'deepseek-v4-pro' };
      const task = detectionTask(request, wrong, request.selectionSnapshot);
      host.tasks.push(task);
      return { taskId: task.id };
    },
  });

  const request = { candidateId: selected.candidateId, budget: { tokens: 32, durationMs: 1500 } };
  await assert.rejects(service.runDetection(request), error => error.code === 'DEEPSEEK_UI_OPERATION_FAILED');
  await assert.rejects(service.runDetection({ ...request, model: 'deepseek-flash' }), error => error.code === 'DEEPSEEK_UI_REQUEST_INVALID');
});

test('DeepSeek detection rejects a Call captured before the canonical Host capture and historical Task reuse', async () => {
  const selected = routerCandidate('candidate-capture');
  const request = { candidateId: selected.candidateId, budget: { tokens: 32, durationMs: 1500 } };
  const historical = detectionTask(request, selected, capturedCandidate(selected, 2));
  historical.id = 'task-historical';
  const host = { candidateSnapshot: { ...routerCandidateSnapshot(selected), epoch: 2, snapshotEpoch: 2 }, tasks: [historical] };
  let mode = 'old-capture';
  const service = createDeepSeekUiService({
    snapshot: async () => ({ bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] } }),
    routerSnapshot: async () => structuredClone(host),
    captureCandidate: async () => capturedCandidate(selected, 2),
    saveCredential: async () => { throw new Error('unused'); },
    discoverCatalog: async () => { throw new Error('unused'); },
    connect: async () => { throw new Error('unused'); },
    disconnect: async () => { throw new Error('unused'); },
    runDetection: async input => {
      if (mode === 'historical') return { taskId: historical.id };
      const task = detectionTask(input, selected, capturedCandidate(selected, 1));
      task.id = 'task-old-capture';
      host.tasks.push(task);
      return { taskId: task.id };
    },
  });

  await assert.rejects(service.runDetection(request), error => error.code === 'DEEPSEEK_UI_OPERATION_FAILED');
  mode = 'historical';
  await assert.rejects(service.runDetection(request), error => error.code === 'DEEPSEEK_UI_OPERATION_FAILED');
});

test('DeepSeek detection accepts its canonical capture when an unrelated catalog change advances the global epoch', async () => {
  const selected = routerCandidate('candidate-current');
  const host = { candidateSnapshot: { ...routerCandidateSnapshot(selected), epoch: 2, snapshotEpoch: 2 }, tasks: [] };
  const service = createDeepSeekUiService({
    snapshot: async () => ({ bindings: [], connections: [], catalog: { status: 'not-requested', models: [], unrecognizedModelIds: [] } }),
    routerSnapshot: async () => structuredClone(host),
    captureCandidate: async () => capturedCandidate(selected, 2),
    saveCredential: async () => { throw new Error('unused'); },
    discoverCatalog: async () => { throw new Error('unused'); },
    connect: async () => { throw new Error('unused'); },
    disconnect: async () => { throw new Error('unused'); },
    runDetection: async input => {
      const task = detectionTask(input, selected, input.selectionSnapshot);
      task.calls.push({
        ...structuredClone(task.calls[0]),
        id: 'call-detection-title',
        purpose: 'title',
        selectionSnapshot: { ...structuredClone(task.calls[0].selectionSnapshot), registryEpoch: 3 },
      });
      task.ledger.callCount = 2;
      task.ledger.unknownPriceCalls = 2;
      host.tasks.push(task);
      host.candidateSnapshot = { ...host.candidateSnapshot, epoch: 3, snapshotEpoch: 3 };
      return { taskId: task.id };
    },
  });

  const result = await service.runDetection({ candidateId: selected.candidateId, budget: { tokens: 32, durationMs: 1500 } });
  assert.equal(result.taskId, 'task-detection');
});

test('the real Typert registry materializes the independent DeepSeek request schemas', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(TypertRegistry);
    ctx.typert.register({
      package: '@irishwei/dsh-router-t05-ui',
      face: 'host',
      schemas: deepSeekUiSchemaFactories,
      invocations: [],
      model: { services: [], events: [], objects: [] },
    });
    const detection = ctx.typert.resolve('@irishwei/dsh-router-t05-ui#DeepSeekDetectionRequest').schema;
    assert.equal(detection.safeParse({ candidateId: 'candidate', budget: { tokens: 32, durationMs: 1500 } }).success, true);
    assert.equal(detection.safeParse({ candidateId: 'candidate', model: 'deepseek-flash', budget: { tokens: 32, durationMs: 1500 } }).success, false);
    assert.equal(detection.safeParse({ candidateId: 'candidate', budget: { tokens: 0, durationMs: 1500 } }).success, false);
    const save = ctx.typert.resolve('@irishwei/dsh-router-t05-ui#DeepSeekSaveCredentialRequest').schema;
    assert.equal(save.safeParse({ apiKey: 'transient-key', unexpected: true }).success, false);
  } finally {
    await ctx.fiber.dispose();
  }
});
