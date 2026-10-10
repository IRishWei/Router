import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { LlmAdapter, LlmError, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

export const inject = ['llm', 'profileContext', 'attachments', 'tools'];
const providerPrefix = 'router-t17-controlled-fixture';
const groups = [
  { provider: providerPrefix + '-main', models: ['main'] },
  { provider: providerPrefix + '-advisor', models: ['advisor'] },
  { provider: providerPrefix + '-target', models: ['target', 'target-small', 'target-text-only', 'target-format-unsupported', 'target-unknown'] },
];
const textOf = message => (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const caseOf = messages => (messages ?? []).map(textOf).findLast(text => /^T17_CASE [a-z-]+(?:\n|$)/.test(text))?.split(/\r?\n/, 1)[0].slice('T17_CASE '.length) ?? null;
const contextWindow = model => model === 'target-small' ? 128 : 262144;
const supportsImage = model => !['advisor', 'target-text-only'].includes(model);
const handoff = model => model === 'target-unknown' ? null : {
  protocol: 'dsh-canonical-v1', toolProtocol: model === 'target-format-unsupported' ? 'unsupported' : 'function-json-schema-v1',
  confidence: 'declared', source: 'T17-local-predetermined-canonical-contract',
};
const capability = model => ({
  text: { supported: true, confidence: 'declared', source: 'T17-local-fixture' },
  image: { supported: supportsImage(model), confidence: 'declared', source: 'T17-local-fixture' },
  tools: { supported: true, confidence: 'declared', source: 'T17-local-fixture' },
});
function* toolResponse(id, name, args) {
  const raw = JSON.stringify(args);
  yield { type: 'block-start', index: 0, blockType: 'tool-call' };
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: raw };
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: raw } };
  yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 8 } };
  yield { type: 'finish', reason: { kind: 'tool-calls' } };
}

function createRecorder(home) {
  let queue = Promise.resolve();
  return async function record(field, value) {
    queue = queue.then(async () => {
      const path = join(home, 't17-controlled-counts.json');
      const data = JSON.parse(await readFile(path, 'utf8'));
      data[field] ??= [];
      if (field === 'requests') assert(data.requests.length < 160, 'Local fixture request ceiling reached');
      data[field].push(value);
      await writeFile(path, JSON.stringify(data, null, 2));
    });
    await queue;
  };
}

class FixtureAdapter extends LlmAdapter {
  constructor(group, attachments, record) { super(); this.group = group; this.attachments = attachments; this.record = record; }
  providerInfo(id) { return { id, name: 'T17 local predetermined fixture; no API, quality or billing claim' }; }
  async listModels(id) {
    return this.group.models.map(model => ({ provider: id, id: model, name: 'T17 local ' + model,
      inputModalities: supportsImage(model) ? ['text', 'image'] : ['text'] }));
  }
  async resolveModel(id, model) {
    assert(this.group.models.includes(model));
    return { provider: id, id: model, name: 'T17 local ' + model,
      inputModalities: supportsImage(model) ? ['text', 'image'] : ['text'],
      context: { contextWindow: contextWindow(model) },
      defaultMaxTokens: model === 'main' ? 128 : model === 'advisor' ? 256 : 512,
      systemPromptUpdate: 'in-history', toolUpdate: 'in-history' };
  }
  imageRequestPricing() { return { priceImages: images => images.map(() => ({ visualTokens: 64, text: '' })) }; }
  async *stream(request) {
    request.signal?.throwIfAborted();
    assert.equal(request.provider, this.group.provider);
    assert(this.group.models.includes(request.model));
    const mode = caseOf(request.messages);
    const isTitle = request.purpose === 'session-title';
    const sources = (request.messages ?? []).map(message => message.source?.kind).filter(Boolean);
    const images = (request.messages ?? []).flatMap(message => (message.content ?? []).filter(part => part.type === 'image'));
    const imageMetadata = [];
    for (const part of images) {
      assert(part.attachment && !part.offloaded, 'Actual fixture image must be a durable non-offloaded native ref');
      const stored = await this.attachments.readImage(part.attachment);
      assert.equal(stored.ref.attachmentId, part.attachment.attachmentId);
      imageMetadata.push({ attachmentId: stored.ref.attachmentId, mediaType: stored.ref.mediaType,
        bytes: stored.data.length, dataHash: digest(stored.data) });
    }
    const visible = { system: request.system ?? null,
      messages: (request.messages ?? []).map(message => ({ id: message.id ?? null, role: message.role,
        toolCallId: message.toolCallId ?? null, source: message.source ?? null, content: message.content })), tools: request.tools ?? [] };
    await this.record('requests', { provider: request.provider, model: request.model, mode,
      sessionId: request.sessionId ?? null,
      purpose: request.purpose ?? null, sources, visible, imageMetadata,
      fullVisibleRequestBytes: Buffer.byteLength(JSON.stringify(visible)),
      historicalReplayPresent: (request.messages ?? []).some(message => message.replayState != null || message.source?.replayState != null),
      maxTokens: request.maxTokens ?? null, realModelRequests: 0 });
    if (request.model.startsWith('target-') && request.model !== 'target') {
      throw new LlmError('Refusal target reached its local Adapter unexpectedly', 'MODEL_NOT_FOUND');
    }
    const originalCallId = mode && 't17-original-' + mode;
    const originalTool = mode === 'duplicate-operation' ? 't17_local_write_receipt' : 't17_local_read_receipt';
    if (!isTitle && request.model === 'main' && ['tools', 'duplicate-operation'].includes(mode)
      && !(request.messages ?? []).some(message => message.toolCallId === originalCallId)) {
      yield* toolResponse(originalCallId, originalTool, mode === 'duplicate-operation' ? { operationId: 't17-one-completed-operation' } : {});
      return;
    }
    if (!isTitle && request.model === 'target' && mode === 'duplicate-operation') {
      yield* toolResponse('t17-new-id-repeated-operation', 't17_local_write_receipt', { operationId: 't17-one-completed-operation' });
      return;
    }
    if (!isTitle && request.model === 'target' && mode === 'tools'
      && !(request.messages ?? []).some(message => message.toolCallId === 't17-new-allowed-read')) {
      yield* toolResponse('t17-new-allowed-read', 't17_local_read_receipt', {});
      return;
    }
    let text = 'T17 local fixture title or prime';
    if (request.model === 'advisor') text = 'Expand the artifact while preserving the complete original user constraints and completed work.';
    else if (mode && !isTitle) {
      if (request.model === 'main') text = 'A'.repeat(sources.includes('router-consultation') ? 14 : sources.includes('router-self-repair') ? 9 : 4);
      else if (request.model === 'target') {
        text = mode === 'image' ? '图像1识别「颜色与形状」答案为「红色圆形」。' + 'A'.repeat(40) : 'A'.repeat(24);
      }
    }
    request.signal?.throwIfAborted();
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 8 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export function apply(ctx) {
  const record = createRecorder(ctx.profileContext.home);
  const localToolNames = ['t17_local_read_receipt', 't17_local_write_receipt'];
  const nativeToolNames = [...localToolNames, 'subagent'];
  const restrictedAgents = new WeakSet();
  // The public created event is awaited before queued inputs enter AgentLoop.
  // Restrict this isolated fixture's tool source before the first assembly;
  // native requests and their full tool history are never edited afterwards.
  ctx.on('agent/created', async ({ agent }) => {
    assert(!restrictedAgents.has(agent), 'An isolated fixture Agent must receive one source restriction');
    restrictedAgents.add(agent);
    agent.ctx.tools.restrict({ allow: localToolNames });
    const initialCatalog = agent.ctx.tools.schemas(agent).map(tool => tool.name).sort();
    assert.equal(JSON.stringify(initialCatalog), JSON.stringify([...localToolNames].sort()),
      'The public pre-input source catalog must contain exactly the local fixture tools');
    await record('toolRestrictions', { sessionId: agent.session.id, allow: localToolNames,
      initialCatalog,
      publicBoundary: 'agent/created before queued input assembly', realModelRequests: 0 });
  }, { global: true });
  const allowed = new Set(groups.map(group => group.provider));
  // This listener is registered before adaptive-router. Its awaited observation
  // precedes Router's last synchronous live dispatch check, and never edits requests.
  ctx.on('llm/stream', (request, next) => (async function* () {
    if (!allowed.has(request.provider) && request.provider !== 'router-controlled') {
      throw new LlmError('Isolated T17 fixture denies every production-provider stream', 'MODEL_NOT_FOUND');
    }
    const nativeInput = { provider: request.provider, model: request.model,
      maxTokens: request.maxTokens ?? null, system: request.system ?? null,
      messages: request.messages ?? [], tools: request.tools ?? [], toolHistory: request.toolHistory ?? null };
    await record('nativeSeams', { provider: request.provider, model: request.model,
      sessionId: request.sessionId ?? null,
      purpose: request.purpose ?? null, nativeAgentLoop: isAgentLoopRequest(request),
      nativeToolNames: (request.tools ?? []).map(tool => tool.name).sort(),
      nativeToolsPrototypeMatchesFixtureRealm: Object.getPrototypeOf(request.tools ?? []) === Array.prototype,
      frozen: Object.isFrozen(request), messageIds: (request.messages ?? []).map(message => message.id ?? null),
      mode: caseOf(request.messages), nativeInput,
      nativeInputHash: digest(JSON.stringify(nativeInput)), realModelRequests: 0 });
    if (isAgentLoopRequest(request) && allowed.has(request.provider)) {
      assert.equal(JSON.stringify((request.tools ?? []).map(tool => tool.name).sort()),
        JSON.stringify([...nativeToolNames].sort()),
        'Every actual native assembly must expose the two local tools and the native scoped subagent tool');
    }
    yield* next();
  })());
  for (const group of groups) ctx.llm.registerAdapter([group.provider], new FixtureAdapter(group, ctx.attachments, record));
  for (const [name, effect] of [['t17_local_read_receipt', 'read'], ['t17_local_write_receipt', 'side-effect']]) {
    ctx.tools.register({ name, description: 'T17 local complete receipt with declared operation semantics',
      parameters: { type: 'object', properties: { operationId: { type: 'string' } }, additionalProperties: false },
      routerOperation: { version: 1, effect, idempotencyKey: effect === 'side-effect' ? 'operationId' : null,
        source: 'T17-local-registry-owner-contract', confidence: 'declared' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        await record('toolExecutions', { name, effect, args, realModelRequests: 0 });
        exec.signal?.throwIfAborted();
        return effect === 'side-effect' ? 'T17_COMPLETED_SIDE_EFFECT:' + args.operationId : 'T17_COMPLETE_READ_RECEIPT:ORIGINAL_LITERAL_VALUE';
      },
    });
  }
  // Router registration uses its public Host-owned source API when the service
  // appears; this inject fiber does not block the later Router patch's startup.
  ctx.inject(['router'], inner => {
    for (const group of groups) {
      const unregister = inner.router.registerOwned({ provider: group.provider,
        connectionId: group.provider + '-connection', accountId: group.provider + '-account',
        billingPath: 't17-controlled-fixture', ownership: 'router-owned', source: 't17-controlled-fixture',
        sourceKey: group.provider + ':v1', configRevision: 1, configured: true, authorizationStatus: 'configured',
        models: group.models.map(model => ({ model, name: 'T17 local ' + model,
          maxContextTokens: contextWindow(model), capability: capability(model), handoff: handoff(model) })) });
      inner.effect(() => unregister, 'router: T17 controlled candidate lifetime');
    }
  });
}
