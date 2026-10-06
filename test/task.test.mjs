import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

async function start(home) {
  const ctx = new Context();
  ctx.provide('profileContext', { home, dir: join(home, 'profiles', 'test'), name: 'test' });
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
