import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { startNative, submit } from './t02-harness.mjs';
import { TaskCoordinationController } from '../src/coordination.mjs';

const clone = value => structuredClone(value);

function acceptance(taskId, revision, verdict) {
  const failed = verdict === 'failed';
  return {
    version: 1, schemaVersion: 1, revision, taskId, requirementRevision: 1, requirementHash: 'a'.repeat(64),
    artifact: { id: `artifact-${revision}`, revision, hash: `${revision}`.repeat(64).slice(0, 64), text: failed ? 'BAD' : 'FIXED', complete: true },
    requirements: [{ id: 'requirement-1', version: 1, kind: 'includes-literal', literal: 'FIXED', description: '正文必须包含「FIXED」', required: true }],
    evidence: [{ id: `evidence-${revision}`, version: 1, requirementId: 'requirement-1', artifactHash: `${revision}`.repeat(64).slice(0, 64), verdict, source: { kind: 'deterministic-rule', rule: 'includes-literal', checkerVersion: 1 }, observed: { included: !failed } }],
    coverage: { required: 1, requiredIds: ['requirement-1'], covered: 1, coveredIds: ['requirement-1'], failedIds: failed ? ['requirement-1'] : [], uncovered: [], uncoveredIds: [] },
    verdict, scope: 'explicit-requirements', limitations: ['finite-explicit-requirement-dsl'], reviews: [], history: [], phase: 'checked',
    blocking: failed ? [{ id: 'blocking-1', version: 1, key: 'includes-literal:failed:evidence', requirementIds: ['requirement-1'], evidenceIds: [`evidence-${revision}`], repairable: true, category: 'requirement-failed', artifactRevision: revision, selfRepairAttempted: false, newEvidenceVersion: 1 }] : [],
  };
}

class RepairingAdapter extends LlmAdapter {
  requests = [];
  async listModels(provider) { return [{ provider, id: 'main', name: 'T16 main fixture' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'T16 main fixture', contextWindow: 8192, maxTokens: 1024 }; }
  async *stream(request) {
    this.requests.push(request);
    const repair = isAgentLoopRequest(request) && request.messages.some(message => message.source?.kind === 'router-self-repair');
    yield { type: 'text-delta', index: 0, text: repair ? 'FIXED' : 'BAD' };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class RepeatedFailureAdapter extends LlmAdapter {
  requests = [];
  async listModels(provider) { return [{ provider, id: 'main', name: 'T16 repeated failure fixture' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'T16 repeated failure fixture', contextWindow: 8192, maxTokens: 1024 }; }
  async *stream(request) {
    this.requests.push(request);
    const kinds = request.messages.map(message => message.source?.kind);
    const text = kinds.includes('router-consultation') ? 'FIXED' : kinds.includes('router-self-repair') ? 'BAD2' : 'BAD1';
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

class ConsultationAdapter extends LlmAdapter {
  requests = [];
  async *stream(request) {
    this.requests.push(request);
    yield { type: 'text-delta', index: 0, text: 'Focus on the failed literal and preserve the rest of the artifact.' };
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('the real Controller keeps a producer-owned self-repair notice in the same Task and turn', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-controller-'));
  let ctx;
  try {
    ctx = await startNative(home);
    const adapter = new RepairingAdapter();
    ctx.llm.registerAdapter(['t16-main'], adapter);
    await ctx.router.setAutomatic(false);

    const acceptances = new Map();
    const coordinations = new Map();
    const facade = {
      exactTask(sessionId, turn) {
        const task = ctx.router.exactTask(sessionId, turn);
        if (!task) return null;
        return { ...task, acceptance: clone(acceptances.get(task.id) ?? task.acceptance), coordination: clone(coordinations.get(task.id) ?? null) };
      },
      async publishCoordination(taskId, expected, next) {
        const current = coordinations.get(taskId);
        const currentAcceptance = acceptances.get(taskId);
        if (currentAcceptance?.revision !== expected.acceptanceRevision || (current?.revision ?? 0) !== expected.coordinationRevision) {
          const error = new Error('stale'); error.code = 'COORDINATION_STALE'; throw error;
        }
        coordinations.set(taskId, clone(next));
        return clone(next);
      },
    };
    const controller = new TaskCoordinationController({ router: facade, policyForTask: () => null });
    let stops = 0;
    ctx.on('agent/turn-stopping', async payload => {
      const task = ctx.router.exactTask(payload.agent.session.id, payload.turn);
      const result = acceptance(task.id, ++stops, stops === 1 ? 'failed' : 'passed');
      acceptances.set(task.id, result);
      await controller.afterAcceptance({ ...payload, acceptance: clone(result) });
    });

    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 't16-main', model: 'main' });
    const task = await submit(ctx, sessionId, 'Complete the controlled task');
    const messages = ctx.agents.get(sessionId).session.deriveMessages();
    const repairNotices = messages.filter(message => message.source?.kind === 'router-self-repair');

    assert.equal(stops, 2);
    assert.equal(task.turn, 1);
    assert.equal((await ctx.router.snapshot()).tasks.length, 1);
    assert.equal(task.calls.filter(call => call.purpose === 'execution').length, 2);
    assert.equal(task.result, 'BADFIXED');
    assert.equal(repairNotices.length, 1);
    assert.equal(repairNotices[0].role, 'user');
    assert.equal(repairNotices[0].source.kind === 'user', false);
    assert.equal(repairNotices[0].source.form, 'notice');
    assert.equal(coordinations.get(task.id).selfRepair.used, true);
    assert.equal(coordinations.get(task.id).episodes[0].status, 'resolved');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test('the real Controller runs self-repair, one owned consultation Call, advice continuation and reassessment in one Task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t16-controller-consultation-'));
  let ctx;
  let dispose;
  try {
    ctx = await startNative(home);
    const main = new RepeatedFailureAdapter();
    const expert = new ConsultationAdapter();
    ctx.llm.registerAdapter(['t16-repeated'], main);
    ctx.llm.registerAdapter(['t16-expert'], expert);
    dispose = ctx.router.registerOwned({
      provider: 't16-expert', connectionId: 't16-expert-connection', accountId: 't16-expert-account', billingPath: 'controlled-test', ownership: 'router-owned',
      source: 't16-controller-test', sourceKey: 't16-expert:v1', configRevision: 1, configured: true, authorizationStatus: 'configured',
      models: [{ model: 'expert', name: 'T16 expert fixture', maxContextTokens: 8192, capability: { text: { supported: true, confidence: 'declared' }, image: { supported: false, confidence: 'declared' }, tools: { supported: false, confidence: 'declared' } } }],
    });
    const expertCandidate = (await ctx.router.refreshConnections()).models.find(item => item.identity.provider === 't16-expert');
    await ctx.router.setModelEnabled(expertCandidate.candidateId, true);
    await ctx.router.setAutomatic(false);

    const acceptances = new Map();
    const coordinations = new Map();
    const facade = {
      exactTask(sessionId, turn) {
        const task = ctx.router.exactTask(sessionId, turn);
        if (!task) return null;
        return { ...task, acceptance: clone(acceptances.get(task.id) ?? task.acceptance), coordination: clone(coordinations.get(task.id) ?? null) };
      },
      async publishCoordination(taskId, expected, next) {
        const current = coordinations.get(taskId);
        const currentAcceptance = acceptances.get(taskId);
        if (currentAcceptance?.revision !== expected.acceptanceRevision || (current?.revision ?? 0) !== expected.coordinationRevision) {
          const error = new Error('stale'); error.code = 'COORDINATION_STALE'; throw error;
        }
        coordinations.set(taskId, clone(next));
        return clone(next);
      },
      captureCandidate: (...args) => ctx.router.captureCandidate(...args),
      reserveCall: (...args) => ctx.router.reserveCall(...args),
      streamReservedCall: (...args) => ctx.router.streamReservedCall(...args),
    };
    const consultationPolicy = {
      enabled: true, candidateId: expertCandidate.candidateId, allowCrossModel: true, allowFixedModel: false,
      objective: 'balanced', selectionBasis: 'objective-qualified', maxTokens: 128, maxAdviceChars: 2048, forecast: { totalTokens: 4096 },
    };
    const controller = new TaskCoordinationController({ router: facade, policyForTask: () => clone(consultationPolicy) });
    let stops = 0;
    ctx.on('agent/turn-stopping', async payload => {
      const task = ctx.router.exactTask(payload.agent.session.id, payload.turn);
      const result = acceptance(task.id, ++stops, stops === 3 ? 'passed' : 'failed');
      if (stops === 2) result.evidence[0].observed = { included: false, checkReceipt: 'second-real-check' };
      acceptances.set(task.id, result);
      await controller.afterAcceptance({ ...payload, acceptance: clone(result) });
    });

    const { sessionId } = await ctx.sessionController.create({ cwd: home });
    await ctx.sessionController.selectModel({ sessionId, provider: 't16-repeated', model: 'main' });
    const task = await submit(ctx, sessionId, 'Complete the repeated-obstacle task');
    const messages = ctx.agents.get(sessionId).session.deriveMessages();
    const coordination = coordinations.get(task.id);

    assert.equal(stops, 3);
    assert.equal((await ctx.router.snapshot()).tasks.length, 1);
    assert.equal(task.turn, 1);
    assert.equal(task.result, 'BAD1BAD2FIXED');
    assert.deepEqual(task.calls.map(call => call.purpose), ['execution', 'execution', 'consultation', 'execution']);
    assert.equal(task.calls[2].candidateId, expertCandidate.candidateId);
    assert.equal(task.calls[2].reservation.state, 'settled');
    assert.equal(task.calls[2].status, 'completed');
    assert.equal(expert.requests.length, 1);
    assert.equal(messages.filter(message => message.source?.kind === 'router-self-repair').length, 1);
    assert.equal(messages.filter(message => message.source?.kind === 'router-consultation').length, 1);
    assert.equal(messages.filter(message => message.source?.kind === 'user').length, 1);
    assert.equal(coordination.consultationAttempts, 1);
    assert.equal(coordination.selfRepair.used, true);
    assert.equal(coordination.episodes[0].status, 'resolved');
    assert.equal(coordination.timeline.filter(item => item.kind === 'consultation-intent').length, 1);
  } finally {
    dispose?.();
    if (ctx) await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
