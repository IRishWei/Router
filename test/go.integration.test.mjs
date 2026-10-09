import assert from 'node:assert/strict';
import test from 'node:test';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { submit } from './t02-harness.mjs';
import { goHost, completed } from './go-harness.mjs';

test('Go full native detection accounts execution/title, stable sessions, unknown money, restart and permanent claim', async () => {
  const f = await goHost();
  try {
    const ctx = f.ctx;
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 2000 });
    assert.equal(f.candidate.enabled, false); assert.equal(f.candidate.inferenceVerification.status, 'unknown');
    await ctx.router.setModelEnabled(f.candidate.candidateId, true);
    const before = await ctx.router.snapshot();
    const result = await ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 32768, durationMs: 5000 } });
    const task = result.tasks.find(item => item.id === result.openCodeGo.lastDetectionTaskId);
    assert.equal(task.lifecycle, 'completed', JSON.stringify({ pauseReason: task.pauseReason, calls: task.calls.map(call => ({ status: call.status, failureCode: call.failureCode })) }));
    assert.equal(task.result, 'OPENCODE_GO_CONNECTION_OK'); assert.equal(task.calls.length, 2);
    assert.deepEqual(task.calls.map(call => call.nativePurpose ?? call.purpose).sort(), ['detection', 'session-title']);
    assert.equal(task.ledger.callCount, 2); assert.equal(task.ledger.tokens.total, 24); assert.equal(task.ledger.unknownPriceCalls, 2);
    assert.equal(task.ledger.actualSpend.amount, null); assert.equal(result.openCodeGo.quota.remainingRatio, null);
    assert(f.requests.every(item => item.headers['x-opencode-session'] === task.sessionId));
    assert(f.requests.every(item => /^irishwei-dsh-router\//u.test(item.headers['user-agent'])));
    assert(f.requests.every(item => item.headers.authorization === 'Bearer controlled-go-host-key'));
    assert(f.requests.every(item => item.body.max_output_tokens <= 1024));
    assert(task.calls.every(call => call.selection.billingPath === 'opencode-go-subscription' && call.reservation.tokens.total > 0));
    assert.deepEqual(result.config, before.config); assert(!JSON.stringify(result).includes('controlled-go-host-key'));
    await f.restart();
    const restored = await f.ctx.router.snapshot();
    assert.deepEqual(restored.tasks, JSON.parse(JSON.stringify(result.tasks))); assert.equal(restored.openCodeGo.lastDetectionTaskId, task.id);
    await assert.rejects(f.ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 32768, durationMs: 5000 } }));
    await f.ctx.router.openCodeGoDisconnect({ deleteCredential: true });
    assert.equal((await f.ctx.router.snapshot()).openCodeGo.configured, false); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('Go runs native tools in one Task and each continuation carries its conversation ID', async () => {
  const f = await goHost((entry, response, requests) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(requests.length === 1 ? completed('', [{ type: 'function_call', id: 'go-tool-item', call_id: 'go-tool-call', name: 'router_test_wait', arguments: '{}' }]) : completed('TOOL_DONE'));
  });
  try {
    f.ctx.tools.register({ name: 'router_test_wait', description: 'Controlled check', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    await f.ctx.router.setModelEnabled(f.candidate.candidateId, true); await f.ctx.router.setFixedModel(f.candidate.candidateId);
    const { sessionId } = await f.ctx.sessionController.create({ cwd: f.home });
    const task = await submit(f.ctx, sessionId, 'Run the controlled check [router:tool]');
    assert.equal(task.lifecycle, 'completed'); assert.equal(task.result, 'TOOL_DONE'); assert.equal(task.calls.length, 2);
    assert(f.requests.every(item => item.headers['x-opencode-session'] === sessionId));
    assert(f.requests[1].body.input.some(item => item.type === 'function_call_output' && item.call_id === 'go-tool-call'));
  } finally { await f.close(); }
});

test('Go failed/partial requests preserve unknowns, do not retry and reject credential changes', async () => {
  for (const kind of ['error', 'partial', 'missing-usage']) {
    const f = await goHost((_entry, response) => {
      response.writeHead(kind === 'error' ? 429 : 200, { 'content-type': 'text/event-stream' });
      response.end(kind === 'partial' ? 'data: {"type":"response.output_text.delta","item_id":"part","output_index":0,"content_index":0,"delta":"PART"}\n\n' : kind === 'missing-usage' ? completed('OPENCODE_GO_CONNECTION_OK', undefined, null) : 'controlled-go-host-key');
    });
    try {
      await f.ctx.router.setModelEnabled(f.candidate.candidateId, true);
      const snapshot = await f.ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 32768, durationMs: 5000 } });
      const task = snapshot.tasks.at(-1);
      if (kind !== 'missing-usage') assert.equal(task.lifecycle, 'paused');
      assert.equal(f.requests.length, 1); assert.equal(task.ledger.tokens.total, null); assert.equal(task.ledger.actualSpend.amount, null);
      assert(!JSON.stringify(snapshot).includes('controlled-go-host-key'));
      const go = snapshot.openCodeGo;
      await f.ctx.credentials.modifyRecord(credentialKey('irishwei-dsh-router-go', go.accountId), async () => ({ kind: 'api-key', key: 'changed-controlled-key' }));
      await assert.rejects(f.ctx.llm.prepareCall({ provider: f.candidate.provider, model: f.candidate.model }));
      await f.ctx.router.openCodeGoDisconnect({ deleteCredential: true });
      await f.ctx.router.openCodeGoSaveCredential({ apiKey: 'new-controlled-key' }); await f.ctx.router.openCodeGoConnect();
      assert.equal((await f.ctx.router.snapshot()).openCodeGo.detectionClaimed, true);
    } finally { await f.close(); }
  }
});

test('Go requires balance attestation and finite budgets and reserves full input before sending', async () => {
  const f = await goHost();
  try {
    await f.ctx.router.setModelEnabled(f.candidate.candidateId, true);
    for (const request of [{ useBalanceDisabled: false, budget: { tokens: 100, durationMs: 1000 } }, { useBalanceDisabled: true, budget: { tokens: 32769, durationMs: 1000 } }]) await assert.rejects(f.ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, ...request }));
    assert.equal((await f.ctx.router.snapshot()).openCodeGo.detectionClaimed, false);
    const result = await f.ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 1, durationMs: 5000 } });
    assert.equal(result.tasks.at(-1).lifecycle, 'waiting-budget'); assert.equal(f.requests.length, 0);
    const taskId = result.tasks.at(-1).id;
    await assert.rejects(f.ctx.router.extendTaskBudget(taskId, { tokens: 32768, durationMs: 60001 }), /cannot be extended/u);
    const unchanged = (await f.ctx.router.snapshot()).tasks.at(-1);
    assert.deepEqual(unchanged.budget.limits, result.tasks.at(-1).budget.limits);
    assert.equal(unchanged.budget.extensions.length, 0); assert.equal(f.requests.length, 0);
    await f.ctx.router.stopTask(result.tasks.at(-1).id);
  } finally { await f.close(); }
});

test('Go detection permanently stops after two dispatched calls even if the model keeps requesting tools', async () => {
  const f = await goHost((_entry, response, requests) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(completed('', [{ type: 'function_call', id: `item-${requests.length}`, call_id: `call-${requests.length}`, name: 'router_test_wait', arguments: '{}' }]));
  });
  try {
    f.ctx.tools.register({ name: 'router_test_wait', description: 'Controlled check', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    await f.ctx.router.setModelEnabled(f.candidate.candidateId, true);
    const snapshot = await f.ctx.router.openCodeGoRunDetection({ candidateId: f.candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 32768, durationMs: 5000 } });
    const task = snapshot.tasks.at(-1); assert.equal(f.requests.length, 2);
    assert.equal(task.lifecycle, 'paused'); assert.equal(task.pauseReason, 'CALL_LIMIT_REACHED');
    assert.equal(snapshot.openCodeGo.detectionClaimed, true);
  } finally { await f.close(); }
});
