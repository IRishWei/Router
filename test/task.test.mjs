import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import AttachmentStore from '@deepseek-ai/dsh-attachment';
import Commands from '@deepseek-ai/dsh-commands';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import * as router from '../src/index.mjs';

async function start(home, files) {
  const ctx = new Context();
  ctx.provide('profileContext', { home, dir: join(home, 'profiles', 'test'), name: 'test' });
  if (files) ctx.provide('routerFileSystem', files);
  for (const plugin of [SessionStore, SessionProjections, AgentRegistry, LlmRuntime, ToolRuntime, SystemPrompt, AgentLoop]) await ctx.plugin(plugin);
  await ctx.plugin(AgentDefaultModel, { provider: 'native-local', model: 'native-model' });
  await ctx.plugin(router);
  return ctx;
}

async function task(ctx, prompt, sessionId = 'task-session', route = { provider: 'router-controlled', model: 'controlled' }) {
  const handle = await ctx.agents.create({ sessionId, agentOptions: route });
  const selected = { current: route };
  installModelSelection(handle.agent.ctx, selected);
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }] }));
  await handle.agent.whenIdle();
  await ctx.router.flush();
  return { handle, session: handle.agent.session, selected, state: await ctx.router.snapshot() };
}

test('a complete task reports the native selected model and controlled result', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-task-'));
  const ctx = await start(home);
  try {
    const result = await task(ctx, 'Reply ROUTER_OK');
    assert.deepEqual(result.session.requestHeader().config, { provider: 'router-controlled', model: 'controlled' });
    assert.equal(result.state.tasks[0].result, 'ROUTER_OK');
    assert.deepEqual(result.state.tasks[0].activeSelection, { connectionId: 'controlled-local', accountId: 'local', billingPath: 'controlled', provider: 'router-controlled', model: 'controlled' });
    assert.equal(result.state.tasks[0].lifecycle, 'completed');
    assert.equal(result.state.tasks[0].acceptance.verdict, 'unconfirmed');
    await result.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('pause survives restart and leaves a native task and global default intact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-pause-'));
  let ctx = await start(home);
  try {
    await ctx.router.setAutomatic(false);
    await ctx.fiber.dispose();
    ctx = await start(home);
    class NativeLocal extends LlmAdapter {
      async *stream() {
        yield { type: 'text-delta', index: 0, text: 'NATIVE_OK' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['native-local'], new NativeLocal());
    const result = await task(ctx, 'Native task', 'native-session', { provider: 'native-local', model: 'native-model' });
    assert.equal(result.state.config.automatic, false);
    assert.equal(result.state.tasks[0].activeSelection.provider, 'native-local');
    assert.equal(result.state.tasks[0].result, 'NATIVE_OK');
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider: 'native-local', model: 'native-model' });
    assert.equal(result.state.tasks[0].timeline[0].reason, 'native-routing');
    await result.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a controlled connection fault pauses only its task and a later task still completes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-fault-'));
  const ctx = await start(home);
  try {
    const failed = await task(ctx, '[router:fail]', 'fault-session');
    assert.equal(failed.state.tasks[0].lifecycle, 'paused');
    assert.deepEqual(failed.state.tasks[0].fault, { kind: 'connection', code: 'CONNECTION', retryable: true });
    assert.equal(failed.state.tasks[0].calls[0].usage, null);
    failed.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Reply RECOVERED' }] }));
    await failed.handle.agent.whenIdle();
    const state = await ctx.router.snapshot();
    assert.equal(state.tasks[1].result, 'RECOVERED');
    assert.notEqual(state.tasks[0].id, state.tasks[1].id);
    assert.equal(state.tasks[0].acceptance.verdict, 'unconfirmed');
    await failed.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('the actual native controller consumes pending selection and agrees with the durable request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-native-'));
  const ctx = await start(home);
  try {
    // Only the external HTTP carrier is replaced. Controller, inbox, projection,
    // prompt admission and model selection are the real target-version services.
    ctx.provide('connection', { fetch: { register: () => () => {} } });
    for (const plugin of [TypertRegistry, Commands, AttachmentStore, FileUploads]) await ctx.plugin(plugin);
    new SessionQueryEngine(ctx);
    new SessionController(ctx, {});
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const route = { provider: 'router-controlled', model: 'controlled' };
    await ctx.sessionController.selectModel({ sessionId, ...route });
    const session = ctx.sessions.get(sessionId);
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'modelSelection').pending, route);
    const globalBefore = ctx.agentDefaultModel.currentSelection();
    await ctx.sessionController.prompt({ sessionId, requestId: 'native-one', mode: 'queue', content: [{ type: 'text', text: 'Reply NATIVE_CONTROLLER_OK' }] }, new AbortController().signal);
    await ctx.agents.get(sessionId).whenIdle();
    const state = await ctx.router.snapshot();
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'modelSelection'), { pending: null, lastUsed: route });
    assert.deepEqual(session.requestHeader().config, route);
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), globalBefore);
    assert.equal(state.tasks[0].result, 'NATIVE_CONTROLLER_OK');
    assert.equal(state.tasks[0].calls[0].dispatchState, 'header-confirmed');
    await ctx.sessionController.prompt({ sessionId, requestId: 'native-two', mode: 'queue', content: [{ type: 'text', text: 'Reply SECOND' }] }, new AbortController().signal);
    await ctx.agents.get(sessionId).whenIdle();
    const notices = session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'model-selection');
    assert.equal(notices.length, 0);
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('an output-token ceiling preserves partial output and pauses the incomplete task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-ceiling-'));
  const ctx = await start(home);
  try {
    class LimitedLocal extends LlmAdapter {
      async *stream() {
        yield { type: 'text-delta', index: 0, text: 'PARTIAL' };
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
        yield { type: 'finish', reason: { kind: 'max-tokens' } };
      }
    }
    ctx.llm.registerAdapter(['native-local'], new LimitedLocal());
    const result = await task(ctx, 'Complete the task', 'limited-session', { provider: 'native-local', model: 'limited' });
    assert.equal(result.session.snapshotEvents().at(-1).data.reason.kind, 'max-tokens');
    const record = result.state.tasks[0];
    assert.equal(record.lifecycle, 'paused');
    assert.equal(record.pauseReason, 'max-tokens');
    assert.equal(record.calls[0].status, 'interrupted');
    assert.equal(record.calls[0].usage.totalTokens, 7);
    assert.equal(record.result, 'PARTIAL');
    assert.equal(record.acceptance.verdict, 'unconfirmed');
    assert.equal(record.timeline.at(-1).reason, 'max-tokens');
    await result.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a rejected native step reports a blocked task without dispatching a request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-blocked-'));
  const ctx = await start(home);
  try {
    ctx.on('agent/pre-step', () => ({ kind: 'reject' }));
    const result = await task(ctx, 'Blocked task');
    assert.equal(result.state.tasks[0].lifecycle, 'paused');
    assert.equal(result.state.tasks[0].pauseReason, 'blocked');
    assert.deepEqual(result.state.tasks[0].calls, []);
    assert.equal(result.state.tasks[0].acceptance.verdict, 'unconfirmed');
    await result.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a native cancellation keeps the delivered prefix and an interrupted call', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-cancel-'));
  const ctx = await start(home);
  const entered = Promise.withResolvers();
  try {
    class WaitingLocal extends LlmAdapter {
      async *stream({ signal }) {
        yield { type: 'text-delta', index: 0, text: 'DELIVERED_PREFIX' };
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
        entered.resolve();
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
    }
    ctx.llm.registerAdapter(['native-local'], new WaitingLocal());
    const handle = await ctx.agents.create({ sessionId: 'cancel-session', agentOptions: { provider: 'native-local', model: 'waiting' } });
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'A cancellable task' }] }));
    await entered.promise;
    handle.agent.cancel({ kind: 'user' });
    await handle.agent.whenIdle();
    const state = await ctx.router.snapshot();
    assert.equal(state.tasks[0].lifecycle, 'paused');
    assert.equal(state.tasks[0].pauseReason, 'aborted');
    assert.equal(state.tasks[0].calls[0].status, 'interrupted');
    assert.equal(state.tasks[0].calls[0].usage.totalTokens, 7);
    assert.equal(state.tasks[0].result, 'DELIVERED_PREFIX');
    await handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a failed request keeps its reported usage when a native retry completes the same task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-retry-'));
  const ctx = await start(home);
  try {
    class RetryLocal extends LlmAdapter {
      attempt = 0;
      async *stream() {
        if (++this.attempt === 1) {
          yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONNECTION', message: 'Controlled outage' } } };
        } else {
          yield { type: 'text-delta', index: 0, text: 'RETRY_OK' };
          yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
      }
    }
    ctx.llm.registerAdapter(['native-local'], new RetryLocal());
    ctx.on('agent/request-error', ({ failure }, next) => failure.code === 'CONNECTION' ? { kind: 'retry' } : next());
    const result = await task(ctx, 'A retryable task', 'retry-session', { provider: 'native-local', model: 'retry' });
    const record = result.state.tasks[0];
    assert.equal(record.lifecycle, 'completed');
    assert.equal(record.result, 'RETRY_OK');
    assert.deepEqual(record.calls.map(call => ({ status: call.status, total: call.usage?.totalTokens })), [{ status: 'failed', total: 7 }, { status: 'completed', total: 12 }]);
    assert.ok(record.calls.every(call => call.taskId === record.id));
    assert.notEqual(record.calls[0].hostAttemptId, record.calls[1].hostAttemptId);
    assert.equal(record.acceptance.verdict, 'unconfirmed');
    await result.handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a failed write rejects pending settings and cannot persist stale queued enablement', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-storage-'));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let armed = false;
  const files = {
    rename,
    async writeFile(...args) {
      if (armed) {
        armed = false;
        entered.resolve();
        await release.promise;
        throw Object.assign(new Error('Controlled disk fault'), { code: 'EIO' });
      }
      return writeFile(...args);
    },
  };
  let ctx = await start(home, files);
  try {
    await ctx.router.setAutomatic(false);
    armed = true;
    const run = task(ctx, 'Reply BEFORE_DISK_FAULT');
    await entered.promise;
    const enable = ctx.router.setAutomatic(true);
    const pause = ctx.router.setAutomatic(false);
    const failures = Promise.all([assert.rejects(enable, /storage is unavailable/i), assert.rejects(pause, /storage is unavailable/i)]);
    release.resolve();
    const [result] = await Promise.all([run, failures]);
    assert.equal(result.state.storageError, 'STATE_WRITE_FAILED');
    assert.equal(result.state.config.automatic, false);
    await result.handle.dispose();
    await ctx.fiber.dispose();
    ctx = await start(home);
    assert.equal((await ctx.router.snapshot()).config.automatic, false);
    assert.equal((await ctx.router.snapshot()).config.version, 2);
  } finally {
    release.resolve();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('a disk fault during a native request keeps routing paused after the response settles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-router-storage-task-'));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let armed = false;
  const ctx = await start(home, { rename, async writeFile(...args) { if (armed) { armed = false; throw Object.assign(new Error('Controlled disk fault'), { code: 'EIO' }); } return writeFile(...args); } });
  try {
    await ctx.router.setAutomatic(true);
    class WaitingLocal extends LlmAdapter {
      async *stream() {
        yield { type: 'text-delta', index: 0, text: 'PRESERVED_OUTPUT' };
        entered.resolve();
        await release.promise;
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['native-local'], new WaitingLocal());
    const handle = await ctx.agents.create({ sessionId: 'disk-task-session', agentOptions: { provider: 'native-local', model: 'waiting' } });
    armed = true;
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'A task with a local storage fault' }] }));
    await entered.promise;
    await ctx.router.flush();
    assert.equal((await ctx.router.snapshot()).tasks[0].pauseReason, 'STATE_WRITE_FAILED');
    release.resolve();
    await handle.agent.whenIdle();
    const state = await ctx.router.snapshot();
    assert.equal(state.tasks[0].lifecycle, 'paused');
    assert.equal(state.tasks[0].pauseReason, 'STATE_WRITE_FAILED');
    assert.equal(state.tasks[0].result, 'PRESERVED_OUTPUT');
    assert.equal(state.tasks[0].acceptance.verdict, 'unconfirmed');
    assert.equal(state.config.automatic, false);
    await handle.dispose();
  } finally {
    release.resolve();
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
