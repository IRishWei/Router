import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import { startNative } from './t02-harness.mjs';
import { lifecycleServer, registrationFor, stateFor } from './t10-harness.mjs';
import { chatGptSessionKey } from '../src/chatgpt-sessions.mjs';
import { recoveryPolicy, submitTask } from './t18-harness.mjs';

test('actual controlled OAuth refresh rejection records authorization recovery and cannot revive the ended Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-oauth-'));
  const remote = await lifecycleServer({ onRefresh: () => ({ status: 400, payload: { error: 'invalid_grant', error_description: 'T18_SECRET_REFRESH_BODY' } }) });
  let ctx;
  try {
    const record = remote.grant({ hostId: `urn:uuid:${randomUUID()}` });
    const registration = registrationFor(record);
    await mkdir(join(home, 'router', 'test'), { recursive: true });
    await writeFile(join(home, 'router', 'test', 'state.json'), JSON.stringify({ schemaVersion: 1, config: { automatic: true, version: 1 }, tasks: [], chatGpt: stateFor(record) }));
    ctx = await startNative(home, { sessionControllerAsPlugin: true, beforeRouter: async current => {
      await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
      await current.credentials.modifyRecord(chatGptSessionKey(registration), () => record);
      await current.plugin(AuthorizationService);
      current.provide('routerChatGptTransport', remote.transport);
      current.provide('routerChatGptEndpoints', remote.endpoints);
    } });
    const candidate = (await ctx.router.snapshot()).models.find(item => item.source === 'openai-chatgpt-oauth');
    await ctx.router.setModelEnabled(candidate.candidateId, true);
    await ctx.router.setFixedModel(candidate.candidateId);
    await ctx.router.setRecoveryPolicy(recoveryPolicy);
    await ctx.router.setBudgetDefaults({ tokens: 65536, durationMs: 5000, money: [] });
    await ctx.credentials.modifyRecord(chatGptSessionKey(registration), current => ({ ...current, payload: { ...current.payload, savedAt: '2000-01-01T00:00:00Z' } }));
    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    const task = await submitTask(ctx, sessionId);
    assert.equal(task.lifecycle, 'paused');
    assert.equal(task.recovery?.category, 'authorization', JSON.stringify(task));
    assert.equal(task.recovery.failure.code, 'INVALID_GRANT');
    assert.equal(task.recovery.reason, 'RECOVERY_REAUTHORIZE_REQUIRED');
    assert.equal(task.recovery.attempts, 0);
    assert.equal(task.calls.filter(call => call.dispatchStarted).length, 0);
    assert.equal(remote.requests.filter(item => item.path === '/token').length, 1);
    assert.equal(remote.requests.filter(item => item.path === '/responses').length, 0);
    assert.equal(JSON.stringify(task.recovery).includes('T18_SECRET_REFRESH_BODY'), false);
    await assert.rejects(ctx.router.resolveTaskRecovery({ taskId: task.id, recoveryId: task.recovery.id, expectedRevision: task.recovery.revision, action: 'retry-current' }), { code: 'RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED' });
  } finally { await ctx?.fiber.dispose(); await remote.close(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
