import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local';
import AuthorizationService from '@deepseek-ai/dsh-authorization';
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import { startNative, submit } from './t02-harness.mjs';
import { lifecycleServer, registrationFor, stateFor } from './t10-harness.mjs';
import { chatGptSessionKey } from '../src/chatgpt-sessions.mjs';

async function nativeFixture(options) {
  const home = await mkdtemp(join(tmpdir(), 'router-t10-native-'));
  const remote = await lifecycleServer(options);
  const record = remote.grant({ hostId: `urn:uuid:${randomUUID()}` });
  const registration = registrationFor(record);
  const directory = join(home, 'router', 'test');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'state.json'), JSON.stringify({ schemaVersion: 1, config: { automatic: true, version: 1 }, tasks: [], chatGpt: stateFor(record) }));
  const ctx = await startNative(home, { sessionControllerAsPlugin: true, beforeRouter: async current => {
    await current.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false });
    await current.credentials.modifyRecord(chatGptSessionKey(registration), () => record);
    await current.plugin(AuthorizationService);
    current.provide('routerChatGptTransport', remote.transport);
    current.provide('routerChatGptEndpoints', remote.endpoints);
  } });
  await ctx.plugin(LlmRetry);
  const candidate = (await ctx.router.snapshot()).models.find(item => item.source === 'openai-chatgpt-oauth');
  await ctx.router.setModelEnabled(candidate.candidateId, true);
  await ctx.router.setFixedModel(candidate.candidateId);
  await ctx.router.setBudgetDefaults({ tokens: 65_536, durationMs: 5_000, money: [] });
  return { home, remote, record, registration, ctx, candidate,
    async task() { const { sessionId } = await ctx.sessionController.create({ cwd: home }); return submit(ctx, sessionId, 'Reply LIFECYCLE_OK'); },
    async close() { await ctx.fiber.dispose(); await remote.close(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); },
  };
}

test('full native Task refreshes an expired session and completes using its replacement without changing global default', async () => {
  const f = await nativeFixture();
  try {
    const defaultBefore = f.ctx.agentDefaultModel.currentSelection();
    await f.ctx.credentials.modifyRecord(chatGptSessionKey(f.registration), current => ({ ...current, payload: { ...current.payload, savedAt: '2000-01-01T00:00:00Z' } }));
    const task = await f.task();
    assert.equal(task.lifecycle, 'completed');
    assert.equal(task.result, 'LIFECYCLE_OK');
    assert.equal(task.calls.length, 1);
    assert.equal(task.calls[0].selection.accountId, f.registration.accountId);
    assert.equal(task.calls[0].usage.totalTokens, 12);
    assert.equal(f.remote.requests.filter(item => item.path === '/token').length, 1);
    const response = f.remote.requests.find(item => item.path === '/responses');
    const rotated = await f.ctx.credentials.readRecord(chatGptSessionKey(f.registration));
    assert.equal(response.headers.authorization, `Bearer ${rotated.payload.accessToken}`);
    assert.notEqual(rotated.payload.refreshToken, f.record.payload.refreshToken);
    assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(), defaultBefore);
    assert.equal((await f.ctx.router.snapshot()).chatGpt.lastDetectionTaskId, 'historical-detection-must-remain');
  } finally { await f.close(); }
});

for (const [upstreamCode, status, cleared] of [
  ['token_revoked', 401, true],
  ['chatpass_v2_scope_not_authorized', 403, true],
  ['subscription_sharing_usage_limit_exceeded', 429, false],
  ['subscription_sharing_user_not_eligible', 403, false],
]) {
  test(`full Task ${upstreamCode} pauses and stops new calls while preserving unknown usage`, async () => {
    const f = await nativeFixture({ onResponse: () => ({ status, payload: { error: { code: upstreamCode, message: 'controlled lifecycle failure' } } }) });
    try {
      const task = await f.task();
      assert.equal(task.lifecycle, 'paused');
      assert.equal(task.calls.length, 1);
      assert.equal(task.calls[0].failureCode, upstreamCode);
      assert.equal(task.calls[0].usage, null);
      assert.equal(task.ledger.tokens.total, null);
      const snapshot = await f.ctx.router.snapshot();
      assert.equal(snapshot.chatGpt.connection, null);
      assert.equal(snapshot.chatGpt.account.configured, !cleared);
      assert.equal(snapshot.chatGpt.lifecycle.failureCode, upstreamCode.toUpperCase());
      assert.equal(snapshot.models.find(item => item.candidateId === f.candidate.candidateId).available, false);
      await f.task();
      assert.equal(f.remote.requests.filter(item => item.path === '/responses').length, 1);
      assert.equal(f.remote.requests.some(item => item.path === '/token'), false);
      assert.equal(snapshot.chatGpt.remainingPlanTokens, undefined);
      assert.equal(snapshot.chatGpt.resetAt, undefined);
    } finally { await f.close(); }
  });
}

test('switch refreshes the target catalog and requires selection of its distinct candidate before a full Task', async () => {
  const f = await nativeFixture();
  try {
    const other = f.remote.grant({ hostId: f.record.payload.hostId, client: 'oaiapp-b', subject: 'subject-b' });
    const registrationB = registrationFor(other, randomUUID(), 'ChatGPT 2');
    await f.ctx.credentials.modifyRecord(chatGptSessionKey(registrationB), () => other);
    // Restart discovers registrations from the public managed record enumeration.
    await f.ctx.fiber.dispose();
    const ctx = await startNative(f.home, { sessionControllerAsPlugin: true, beforeRouter: async current => {
      await current.plugin(LocalCredentialProvider, { path: join(f.home, '.credentials.yaml'), watch: false });
      await current.plugin(AuthorizationService);
      current.provide('routerChatGptTransport', f.remote.transport);
      current.provide('routerChatGptEndpoints', f.remote.endpoints);
    } });
    try {
      let snapshot = await ctx.router.chatGptSelectAccount({ accountId: registrationB.accountId });
      const selected = snapshot.models.find(item => item.accountId === registrationB.accountId && item.available);
      assert.equal(snapshot.models.find(item => item.candidateId === f.candidate.candidateId).available, false);
      assert.equal(selected.enabled, false);
      assert.notEqual(selected.candidateId, f.candidate.candidateId);
      await ctx.router.setModelEnabled(selected.candidateId, true);
      await ctx.router.setFixedModel(selected.candidateId);
      const { sessionId } = await ctx.sessionController.create({ cwd: f.home });
      const task = await submit(ctx, sessionId, 'Reply LIFECYCLE_OK');
      assert.equal(task.lifecycle, 'completed');
      assert.equal(task.calls[0].selection.accountId, registrationB.accountId);
      assert.equal(f.remote.requests.find(item => item.path === '/responses').headers.authorization, `Bearer ${other.payload.accessToken}`);
      snapshot = await ctx.router.chatGptSignOut();
      assert.equal(snapshot.chatGpt.lifecycle.revocation.status, 'confirmed');
      assert.equal(snapshot.chatGpt.registrations.find(item => item.accountId === f.registration.accountId).configured, true);
    } finally { await ctx.fiber.dispose(); }
  } finally { await f.close(); }
});
