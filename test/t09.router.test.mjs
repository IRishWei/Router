import assert from 'node:assert/strict';
import test from 'node:test';
import { chatGptOwnedSource } from '../src/chatgpt-router.mjs';

test('ChatGPT owned source declares only route-level preview capabilities', () => {
  const source = chatGptOwnedSource({
    provider: 'router-chatgpt-account-a', connectionId: 'connection-a', accountId: 'account-a', configRevision: 1,
    models: [{ slug: 'gpt-a', display_name: 'GPT A' }],
  });
  assert.equal(source.billingPath, 'chatgpt-subscription');
  assert.equal(source.source, 'openai-chatgpt-oauth');
  assert.equal(source.models[0].maxContextTokens, null);
  assert.deepEqual(source.models[0].capability, {
    text: { supported: true, confidence: 'declared', source: 'openai-chatgpt-responses-preview' },
    tools: { supported: true, confidence: 'declared', source: 'openai-chatgpt-responses-preview' },
    image: { supported: null, confidence: 'unknown', source: 'openai-chatgpt-model-catalog' },
  });
  assert.equal(JSON.stringify(source).includes('token'), false);
});
