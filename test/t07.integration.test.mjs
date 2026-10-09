import assert from 'node:assert/strict';
import test from 'node:test';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { compatibleHost } from './t07-harness.mjs';
import { completed } from './go-harness.mjs';
import { submit } from './t02-harness.mjs';

test('compatible native detection freezes identity, budgets, unknowns and claim through restart', async () => {
  const f = await compatibleHost();
  try {
    assert.equal(f.requests.length, 0); assert.equal(f.candidate.enabled, false);
    await f.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 120, maxTitleBytes: 120 });
    await f.ctx.plugin(FirstPromptTitle, { targetWords: 8, targetCjkCharacters: 16, maxInputBytes: 4096, maxOutputTokens: 128, timeoutMs: 2000 });
    await f.ctx.router.setModelEnabled(f.candidate.candidateId, true);
    const before = await f.ctx.router.snapshot();
    const result = await f.ctx.router.compatibleRunDetection({ candidateId: f.candidate.candidateId, budget: { tokens: 32768, durationMs: 5000 } });
    const task = result.tasks.at(-1); assert.equal(task.lifecycle, 'completed'); assert.equal(task.result, 'COMPATIBLE_CONNECTION_OK'); assert.equal(task.calls.length, 2);
    assert.equal(f.requests.length, 2); assert(f.requests.every(item => item.path === '/v1/responses' && item.headers['x-opencode-session'] === task.sessionId && item.body.max_output_tokens <= 1024));
    assert(task.calls.every(call => call.selection.billingPath === 'compatible-unconfirmed'));
    assert.equal(task.ledger.tokens.total, 24); assert.equal(task.ledger.actualSpend.amount, null); assert.equal(task.ledger.unknownPriceCalls, 2);
    assert(task.calls[0].reservation.tokens.input >= Buffer.byteLength(JSON.stringify(f.requests[0].body.input)));
    assert.deepEqual(result.config, before.config); assert(!JSON.stringify(result).includes('controlled-compatible-private-key'));
    await f.restart(); const restored = await f.ctx.router.snapshot(); assert.deepEqual(restored.tasks, JSON.parse(JSON.stringify(result.tasks))); assert(restored.compatible.entries[0].detectionClaimed);
    await assert.rejects(f.ctx.router.compatibleRunDetection({ candidateId: f.candidate.candidateId, budget: { tokens: 32768, durationMs: 5000 } }));
    await f.ctx.router.compatibleDisconnect({ id: f.id, deleteCredential: true }); assert.equal((await f.ctx.router.snapshot()).compatible.entries[0].configured, false); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});
test('compatible full tool task preserves call history and full input reservation, catalog is explicit', async () => {
  const f = await compatibleHost((entry, response, requests) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(requests.length === 1 ? completed('', [{ type: 'function_call', id: 'tool-item', call_id: 'tool-call', name: 'router_test_wait', arguments: '{}' }]) : completed('TOOL_DONE'));
  });
  try {
    f.ctx.tools.register({ name: 'router_test_wait', description: 'Controlled check', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'TOOL_OK'; } });
    await f.ctx.router.setBudgetDefaults({ tokens: 65536, durationMs: 10000, money: [] }); await f.ctx.router.setModelEnabled(f.candidate.candidateId, true); await f.ctx.router.setFixedModel(f.candidate.candidateId);
    const { sessionId } = await f.ctx.sessionController.create({ cwd: f.home }); const task = await submit(f.ctx, sessionId, 'Run check [router:tool]');
    assert.equal(task.lifecycle, 'completed'); assert.equal(task.result, 'TOOL_DONE'); assert.equal(task.calls.length, 2);
    assert(f.requests[1].body.input.some(item => item.type === 'function_call_output' && item.call_id === 'tool-call'));
    assert(f.requests[0].body.tools.some(tool => tool.name === 'router_test_wait')); assert(f.requests.every(item => item.headers['x-opencode-session'] === sessionId));
    assert(task.calls.every((call, index) => call.reservation.tokens.input >= Buffer.byteLength(JSON.stringify(f.requests[index].body.input))), JSON.stringify(task.calls.map((call, index) => ({ reservation: call.reservation.tokens.input, actual: Buffer.byteLength(JSON.stringify(f.requests[index].body.input)) }))));
  } finally { await f.close(); }
  const catalog = await compatibleHost();
  try { assert.equal(catalog.requests.length, 0); await catalog.ctx.router.compatibleDiscover({ id: catalog.id }); assert.equal(catalog.requests.length, 1); const value = (await catalog.ctx.router.snapshot()).compatible.entries[0]; assert.equal(value.catalog.status, 'listed'); assert.deepEqual(value.catalog.models, ['fixture-compatible']); assert.equal((await catalog.ctx.router.snapshot()).models.find(item => item.source === 'openai-compatible').inferenceVerification.status, 'unknown'); } finally { await catalog.close(); }
});
test('compatible errors, incomplete streams and missing partitions remain unknown and never retry', async () => {
  for (const kind of ['429', 'json', 'partial', 'missing-usage']) {
    const f = await compatibleHost((_entry, response) => { response.writeHead(kind === '429' ? 429 : 200, { 'content-type': kind === 'json' ? 'application/json' : 'text/event-stream' }); response.end(kind === 'partial' ? 'data: {"type":"response.output_text.delta","item_id":"part","output_index":0,"content_index":0,"delta":"PART"}\n\n' : kind === 'missing-usage' ? completed('COMPATIBLE_CONNECTION_OK', undefined, null) : 'controlled-compatible-private-key'); });
    try { await f.ctx.router.setModelEnabled(f.candidate.candidateId, true); const result = await f.ctx.router.compatibleRunDetection({ candidateId: f.candidate.candidateId, budget: { tokens: 32768, durationMs: 5000 } }); assert.equal(f.requests.length, 1); assert.equal(result.tasks.at(-1).ledger.tokens.total, null); assert.equal(result.tasks.at(-1).ledger.actualSpend.amount, null); if (kind !== 'missing-usage') assert.equal(result.tasks.at(-1).lifecycle, 'paused'); assert(!JSON.stringify(result).includes('controlled-compatible-private-key')); } finally { await f.close(); }
  }
});
test('compatible disabled, unlimited and image-incompatible tasks cannot call; credential change revokes prepared calls', async () => {
  const f = await compatibleHost();
  try {
    await f.ctx.router.setModelEnabled(f.candidate.candidateId, true); await f.ctx.router.setFixedModel(f.candidate.candidateId);
    const { sessionId } = await f.ctx.sessionController.create({ cwd: f.home }); const task = await submit(f.ctx, sessionId, 'Finite limits are required'); assert.equal(task.lifecycle, 'paused'); assert.equal(f.requests.length, 0);
    await f.ctx.router.setBudgetDefaults({ tokens: 65536, durationMs: 10000, money: [] });
    const prepared = await f.ctx.llm.prepareCall({ provider: f.candidate.provider, model: f.candidate.model });
    await f.ctx.credentials.modifyRecord(credentialKey('irishwei-dsh-router-compatible', `account-${f.id}`), async () => ({ kind: 'api-key', key: 'changed-controlled-key' }));
    await assert.rejects(async () => { for await (const _part of prepared.stream({ provider: f.candidate.provider, model: f.candidate.model, sessionId, messages: [], maxTokens: 16 })) {} });
    assert.equal((await f.ctx.router.snapshot()).models.find(item => item.source === 'openai-compatible').available, false); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
test('compatible waiting detection rejects expansion without resetting claim', async () => {
  const f = await compatibleHost();
  try { await f.ctx.router.setModelEnabled(f.candidate.candidateId, true); const result = await f.ctx.router.compatibleRunDetection({ candidateId: f.candidate.candidateId, budget: { tokens: 1, durationMs: 5000 } }); const task = result.tasks.at(-1); assert.equal(task.lifecycle, 'waiting-budget'); await assert.rejects(f.ctx.router.extendTaskBudget(task.id, { tokens: 32768 })); assert.equal(f.requests.length, 0); await f.ctx.router.stopTask(task.id); } finally { await f.close(); }
});
