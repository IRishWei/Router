import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startNative, submit } from './t02-harness.mjs';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';

test('a persisted pool cannot grant a different connection or provider through state edits', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-invalid-state-'));
  try {
    const directory = join(home, 'router', 'test');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'state.json'), JSON.stringify({ schemaVersion: 1, config: { automatic: true, version: 2, fixedModel: null, pool: [{ connectionId: 'unexpected', accountId: 'other-account', billingPath: 'paid', provider: 'external', model: 'controlled', enabled: true }] }, tasks: [] }));
    await assert.rejects(startNative(home), /Unsupported DSH Router pool configuration/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a paused 0.1.2 profile migrates without resetting its version or task history', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-migration-'));
  let ctx;
  try {
    const directory = join(home, 'router', 'test');
    await mkdir(directory, { recursive: true });
    const previous = { id: 'previous-task', lifecycle: 'completed', acceptance: { verdict: 'unconfirmed', evidence: [] }, result: 'OLD_RESULT', calls: [], timeline: [], configVersion: 1 };
    await writeFile(join(directory, 'state.json'), JSON.stringify({ schemaVersion: 1, config: { automatic: false, version: 2 }, tasks: [previous] }));
    ctx = await startNative(home);
    let state = await ctx.router.snapshot();
    assert.equal(state.config.version, 2);
    assert.equal(state.config.automatic, false);
    assert.equal(state.config.fixedModel, null);
    assert.deepEqual(state.tasks[0], previous);
    assert.equal(state.models.filter(model => model.enabled).length, 2);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    const record = await submit(ctx, sessionId, 'Reply MIGRATED');
    assert.equal(record.result, 'MIGRATED');
    assert.equal(record.calls[0].configVersion, 2);
    await ctx.router.setFixedModel('controlled-tools');
    await ctx.fiber.dispose();
    ctx = await startNative(home);
    state = await ctx.router.snapshot();
    assert.equal(state.config.version, 3);
    assert.equal(state.config.automatic, false);
    assert.equal(state.config.fixedModel, 'controlled-tools');
    assert.equal(state.tasks[0].result, 'OLD_RESULT');
    assert.equal(state.tasks[1].result, 'MIGRATED');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('an enabled pool member serves a native task with coherent prompt, header and selection', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-pool-'));
  const ctx = await startNative(home);
  try {
    const models = (await ctx.router.snapshot()).models;
    assert.equal(models.length, 2);
    assert.equal(models[0].capability.text.confidence, 'known');
    assert.equal(models[1].capability.tools.confidence, 'declared');
    assert.equal(models[1].capability.image.confidence, 'unknown');
    await ctx.router.setModelEnabled('controlled', false);
    const before = ctx.agentDefaultModel.currentSelection();
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    ctx.systemPrompt.section({ name: 'route-proof', order: 0, text: 'Route {{provider}}/{{model}}' });
    const record = await submit(ctx, sessionId, 'Reply POOL_OK');
    assert.equal(record.result, 'POOL_OK');
    assert.equal(record.calls[0].selection.model, 'controlled-tools');
    const session = ctx.sessions.get(sessionId);
    assert.equal(session.requestHeader().config.model, 'controlled-tools');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').lastUsed.model, 'controlled-tools');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending, null);
    assert.match(session.deriveMessages().find(message => message.role === 'system').content[0].text, /Route router-controlled\/controlled-tools/);
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), before);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('an image task cannot dispatch to a candidate whose image capability is unknown', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-image-'));
  const ctx = await startNative(home, { images: true });
  try {
    await ctx.router.setModelEnabled('controlled', false);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await ctx.sessionController.prompt({ sessionId, requestId: 'image-task', mode: 'queue', content: [{ type: 'text', text: 'Describe the image' }, { type: 'image', mediaType: 'image/png', data: png }] }, new AbortController().signal);
    await ctx.agents.get(sessionId).whenIdle();
    const record = (await ctx.router.snapshot()).tasks.at(-1);
    assert.equal(record.pauseReason, 'NO_COMPATIBLE_IMAGE_CANDIDATE');
    assert.equal(record.calls.length, 0);
    assert.equal(ctx.sessions.get(sessionId).requestHeader(), undefined);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of [
  { label: 'disabled', revoke: ctx => ctx.router.setModelEnabled('controlled-tools', false), reason: 'MODEL_DISABLED' },
  { label: 'removed', revoke: ctx => ctx.router.removeModel('controlled-tools'), reason: 'MODEL_REMOVED' },
  { label: 'removed after stream creation but before consumption', lazyStream: true, revoke: ctx => ctx.router.removeModel('controlled-tools'), reason: 'MODEL_REMOVED' },
]) test(`a prepared native request cannot dispatch a model ${scenario.label} during middleware waiting`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-revoke-wait-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let run, dispatches = 0;
  try {
    await ctx.router.setFixedModel('controlled-tools');
    if (scenario.lazyStream) ctx.on('llm/stream', (_request, next) => {
      const stream = next();
      return (async function* () { entered.resolve(); await release.promise; yield* stream; })();
    }, { prepend: true });
    else ctx.on('agent/request', async (_context, next) => { const config = await next(); entered.resolve(); await release.promise; return config; }, { prepend: true });
    ctx.on('llm/stream', async function* (_request, next) { dispatches++; yield* next(); });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply AFTER_REVOKE');
    await entered.promise;
    await scenario.revoke(ctx);
    assert.equal(dispatches, 0);
    release.resolve();
    const record = await run;
    assert.equal(dispatches, 0);
    assert.equal(record.lifecycle, 'paused');
    assert.equal(record.pauseReason, scenario.reason);
    assert.equal(record.result, '');
    assert.equal(record.calls[0].selection.model, 'controlled-tools');
    assert.equal(record.calls[0].usage, null);
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('revocation during a prepared native retry preserves its first usage and prevents another dispatch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-retry-revoke-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let run, prepared = 0, dispatches = 0;
  try {
    await ctx.router.setFixedModel('controlled-tools');
    ctx.on('agent/request', async (_context, next) => { const config = await next(); if (++prepared === 2) { entered.resolve(); await release.promise; } return config; }, { prepend: true });
    ctx.on('llm/stream', async function* (_request, next) {
      dispatches++;
      if (dispatches === 1) {
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONNECTION', message: 'Controlled connection failure' } } };
      } else yield* next();
    });
    ctx.on('agent/request-error', ({ failure }, next) => failure.code === 'CONNECTION' ? { kind: 'retry' } : next());
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply RETRY_AFTER_REVOKE');
    await entered.promise;
    await ctx.router.removeModel('controlled-tools');
    release.resolve();
    const record = await run;
    assert.equal(dispatches, 1);
    assert.equal(record.pauseReason, 'MODEL_REMOVED');
    assert.equal(record.lifecycle, 'paused');
    assert.equal(record.result, '');
    assert.deepEqual(record.calls.map(call => [call.selection.model, call.configVersion, call.usage?.totalTokens ?? null]), [['controlled-tools', 2, 7], ['controlled-tools', 2, null]]);
    assert.ok(record.calls.every(call => call.status === 'failed'));
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('paused routing with an empty Router pool still permits a real native manual route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-native-after-revoke-'));
  const ctx = await startNative(home);
  let seen, originalSignal;
  try {
    class NativeFixture extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async listModels(provider) { return [await this.resolveModel(provider, 'native')]; }
      async *stream(request) {
        seen = request;
        yield { type: 'text-delta', index: 0, text: 'NATIVE_OK' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['native-fixture'], new NativeFixture());
    ctx.on('llm/stream', (request, next) => { originalSignal = request.signal; return next(); });
    await ctx.router.setAutomatic(false);
    await ctx.router.setModelEnabled('controlled', false);
    await ctx.router.setModelEnabled('controlled-tools', false);
    const before = ctx.agentDefaultModel.currentSelection();
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 'native-fixture', model: 'native' });
    const selectedDefault = ctx.agentDefaultModel.currentSelection();
    const record = await submit(ctx, sessionId, 'Reply NATIVE_OK');
    assert.equal(record.result, 'NATIVE_OK');
    assert.equal(record.lifecycle, 'completed');
    assert.equal(seen.provider, 'native-fixture');
    assert.equal(seen.model, 'native');
    assert.equal(seen.signal.aborted, false);
    assert.equal(seen.signal, originalSignal);
    assert.equal(ctx.sessionProjections.stateOf(ctx.sessions.get(sessionId), 'modelSelection').pending, null);
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), selectedDefault);
    assert.equal(before.provider, 'router-controlled');
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('removing a model during its real native stream preserves that request and blocks its following fixed request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-stream-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let run;
  try {
    ctx.on('llm/stream', async function* (_request, next) { entered.resolve(); await release.promise; yield* next(); });
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, 'Reply STREAM_OK');
    await entered.promise;
    await ctx.router.removeModel('controlled-tools');
    const pending = await ctx.router.snapshot();
    assert.equal(pending.application.status, 'pending');
    assert.equal(pending.tasks.at(-1).calls[0].selection.model, 'controlled-tools');
    assert.equal(pending.tasks.at(-1).calls[0].routerSnapshot.fixedModel, 'controlled-tools');
    release.resolve();
    const record = await run;
    assert.equal(record.result, 'STREAM_OK');
    assert.equal(record.calls[0].configVersion, 2);
    assert.equal(ctx.sessions.get(sessionId).requestHeader().config.model, 'controlled-tools');
    const next = await submit(ctx, sessionId, 'Reply CANNOT_USE_REMOVED');
    assert.equal(next.pauseReason, 'FIXED_MODEL_UNAVAILABLE');
    assert.equal(next.calls.length, 0);
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a native retry keeps its assembled snapshot after matching pending selection was consumed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-retry-'));
  const ctx = await startNative(home);
  let first = true;
  try {
    ctx.on('llm/stream', async function* (_request, next) {
      if (first) {
        first = false;
        await ctx.router.setFixedModel('controlled');
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONNECTION', message: 'Controlled transport outage' } } };
      } else yield* next();
    });
    ctx.on('agent/request-error', ({ failure }, next) => failure.code === 'CONNECTION' ? { kind: 'retry' } : next());
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    const record = await submit(ctx, sessionId, 'Reply RETRY_DONE');
    assert.equal(record.result, 'RETRY_DONE');
    assert.deepEqual(record.calls.map(call => [call.selection.model, call.configVersion, call.usage?.totalTokens]), [['controlled-tools', 2, 7], ['controlled-tools', 2, 12]]);
    const session = ctx.sessions.get(sessionId);
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending, null);
    const next = await submit(ctx, sessionId, 'Reply NEXT_BOUNDARY');
    assert.equal(next.calls[0].selection.model, 'controlled');
    assert.equal(next.calls[0].configVersion, 3);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a native manual choice arriving during assembly is retained without a mismatched prompt or switch notice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-manual-race-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let armed = false, run;
  try {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      if (armed) { armed = false; entered.resolve(); await release.promise; }
      return next();
    });
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply BASELINE');
    armed = true;
    run = submit(ctx, sessionId, 'Reply RACING');
    await entered.promise;
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    release.resolve();
    const record = await run;
    assert.equal(record.pauseReason, 'NATIVE_SELECTION_CHANGED');
    assert.equal(record.calls.length, 0);
    const session = ctx.sessions.get(sessionId);
    assert.equal(session.requestHeader().config.model, 'controlled-tools');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending.model, 'controlled');
    assert.equal(session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'model-selection').length, 0);
    await ctx.router.setFixedModel(null);
    const resumed = await submit(ctx, sessionId, 'Reply MANUAL_RESUMED');
    assert.equal(resumed.result, 'MANUAL_RESUMED');
    assert.equal(resumed.calls[0].selection.model, 'controlled');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending, null);
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a native choice arriving while pre-step waits cannot persist a switch notice for an unsent route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-prestep-race-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let armed = false, run;
  try {
    ctx.on('agent/pre-step', async (_context, next) => {
      if (armed) { armed = false; entered.resolve(); await release.promise; }
      return next();
    });
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await submit(ctx, sessionId, 'Reply BASELINE_A');
    await ctx.router.setFixedModel('controlled-tools');
    armed = true;
    run = submit(ctx, sessionId, 'Reply RACING_PRESTEP');
    await entered.promise;
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    release.resolve();
    const record = await run;
    const session = ctx.sessions.get(sessionId);
    assert.equal(record.pauseReason, 'NATIVE_SELECTION_CHANGED');
    assert.equal(record.calls.length, 0);
    assert.equal(session.requestHeader().config.model, 'controlled');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending.model, 'controlled');
    assert.equal(session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'model-selection').length, 0);
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('configuration changed during a native tool stays pending until the next coherent request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-boundary-'));
  const ctx = await startNative(home);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let run;
  try {
    ctx.tools.register({ name: 'router_test_wait', description: 'A controlled external wait', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { entered.resolve(); await release.promise; return 'TOOL_OK'; } });
    ctx.systemPrompt.tools(() => ({ schemas: ctx.tools.schemas() }));
    ctx.systemPrompt.section({ name: 'route-proof', order: 0, text: 'Route {{provider}}/{{model}}' });
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    run = submit(ctx, sessionId, '[router:tool]\nReply TOOL_DONE');
    await Promise.race([entered.promise, run.then(() => { throw new Error('The task completed without its required tool'); })]);
    await ctx.router.setFixedModel('controlled');
    const pending = await ctx.router.snapshot();
    assert.equal(pending.application.status, 'pending');
    assert.equal(pending.application.active[0].appliedVersion, 2);
    assert.equal(pending.application.active[0].desiredVersion, 3);
    assert.equal(pending.tasks.at(-1).calls[0].configVersion, 2);
    release.resolve();
    const record = await run;
    assert.equal(record.result, 'TOOL_DONE');
    assert.deepEqual(record.calls.map(call => [call.selection.model, call.configVersion]), [['controlled-tools', 2], ['controlled', 3]]);
    assert.ok(record.calls.every(call => call.taskId === record.id));
    assert.equal((await ctx.router.snapshot()).application.status, 'applied');
    const session = ctx.sessions.get(sessionId);
    const notices = session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'model-selection');
    assert.equal(notices.length, 1);
    assert.equal(session.requestHeader().config.model, 'controlled');
    assert.match(session.deriveMessages().findLast(message => message.role === 'system').content[0].text, /Route router-controlled\/controlled/);
  } finally {
    release.resolve();
    if (run) await run.catch(() => {});
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('disabled and removed models cannot dispatch even with native pending or routing paused, and settings survive restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-remove-'));
  let ctx = await startNative(home);
  try {
    await ctx.router.removeModel('controlled-tools');
    await ctx.router.setModelEnabled('controlled', false);
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    let record = await submit(ctx, sessionId, 'Reply EMPTY');
    assert.equal(record.pauseReason, 'NO_ENABLED_CANDIDATE');
    assert.equal(record.calls.length, 0);
    await ctx.router.setAutomatic(false);
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    record = await submit(ctx, sessionId, 'Reply DISABLED');
    assert.equal(record.pauseReason, 'MODEL_DISABLED');
    assert.equal(record.calls.length, 0);
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    record = await submit(ctx, sessionId, 'Reply REMOVED');
    assert.equal(record.pauseReason, 'MODEL_REMOVED');
    assert.equal(record.calls.length, 0);
    await ctx.fiber.dispose();
    ctx = await startNative(home);
    const state = await ctx.router.snapshot();
    assert.equal(state.config.automatic, false);
    assert.deepEqual(state.models.map(model => [model.model, model.inPool, model.enabled]), [['controlled', true, false], ['controlled-tools', false, false]]);
    await ctx.router.setModelEnabled('controlled-tools', true);
    await ctx.router.setAutomatic(true);
    const next = await ctx.sessionController.create({ cwd: home });
    record = await submit(ctx, next.sessionId, 'Reply RESTORED');
    assert.equal(record.result, 'RESTORED');
    assert.equal(record.calls[0].selection.model, 'controlled-tools');
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('fixed routing preserves conflicting and same-route native pending intent without duplicate notices', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t02-fixed-'));
  const ctx = await startNative(home);
  try {
    await ctx.router.setFixedModel('controlled-tools');
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    let record = await submit(ctx, sessionId, 'Reply FIXED_OK');
    assert.equal(record.calls[0].selection.model, 'controlled-tools');
    const session = ctx.sessions.get(sessionId);
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    record = await submit(ctx, sessionId, 'Reply CONFLICT');
    assert.equal(record.pauseReason, 'FIXED_MODEL_CONFLICT');
    assert.equal(record.calls.length, 0);
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending.model, 'controlled');
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
    await submit(ctx, sessionId, 'Reply MATCHING');
    // rc.2 emits no new header for this identical route, so its own pending
    // choice remains live. Router must preserve it rather than invent consumption.
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending.model, 'controlled-tools');
    await ctx.router.setFixedModel('controlled');
    record = await submit(ctx, sessionId, 'Reply STILL_CONFLICTING');
    assert.equal(record.pauseReason, 'FIXED_MODEL_CONFLICT');
    await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
    record = await submit(ctx, sessionId, 'Reply SWITCHED');
    assert.equal(record.result, 'SWITCHED');
    assert.equal(ctx.sessionProjections.stateOf(session, 'modelSelection').pending, null);
    assert.equal(session.requestHeader().config.model, 'controlled');
    await submit(ctx, sessionId, 'Reply SAME');
    const notices = session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'model-selection');
    assert.equal(notices.length, 1);
    assert.match(notices[0].data.content[0].text, /continues with controlled/);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
