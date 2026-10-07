import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import AttachmentStore from '@deepseek-ai/dsh-attachment';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import Commands from '@deepseek-ai/dsh-commands';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import * as router from '../src/index.mjs';

export async function startNative(home, { images = false, files, beforeRouter, routerPlugin = router } = {}) {
  const ctx = new Context();
  ctx.provide('profileContext', { home, dir: join(home, 'profiles', 'test'), name: 'test' });
  if (files) ctx.provide('routerFileSystem', files);
  ctx.provide('connection', { fetch: { register: () => () => {} } });
  for (const plugin of [SessionStore, SessionProjections, AgentRegistry, LlmRuntime, ToolRuntime, SystemPrompt, AgentLoop, TypertRegistry, Commands]) await ctx.plugin(plugin);
  await ctx.plugin(images ? LocalAttachmentStore : AttachmentStore, images ? { dshHome: home } : {});
  await ctx.plugin(FileUploads);
  await ctx.plugin(AgentDefaultModel, { provider: 'router-controlled', model: 'controlled' });
  new SessionQueryEngine(ctx);
  new SessionController(ctx, {});
  if (beforeRouter) await beforeRouter(ctx);
  try { await ctx.plugin(routerPlugin); }
  catch (error) { await ctx.fiber.dispose(); throw error; }
  return ctx;
}

export async function submit(ctx, sessionId, text) {
  await ctx.sessionController.prompt({ sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
  await ctx.agents.get(sessionId).whenIdle();
  return (await ctx.router.snapshot()).tasks.at(-1);
}
