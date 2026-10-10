import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { prepare, submitTask, register, RecoveryFixture, assertAccounted, waitForSnapshot } from './t18-harness.mjs';

for (const broken of ['billing', 'unknown-account', 'protocol', 'capacity', 'fixed']) test(`a full native recovery refuses unsafe alternative ${broken} without a target model entry`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-proof-'));
  let ctx;
  try {
    const fixture = await prepare(home, { mainOptions: broken === 'unknown-account' ? { accountId: 'unknown' } : {} }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-proof-target', target, { connectionId: fixture.registration.source.connectionId, accountId: broken === 'billing' ? 'different-account' : fixture.registration.source.accountId, ...(broken === 'protocol' ? { handoffFact: null } : {}), ...(broken === 'capacity' ? { capacity: 1 } : {}) });
    const previous = await submitTask(ctx, fixture.sessionId, 'Complete the original current-model Task.');
    if (broken !== 'fixed') await ctx.router.setFixedModel(null);
    await ctx.router.setModelEnabled('controlled', false); await ctx.router.setModelEnabled('controlled-tools', false);
    await ctx.router.setRecoveryPolicy({ ...(await ctx.router.snapshot()).config.recovery, alternativeCandidateId: registration.candidate.candidateId });
    fixture.main.failures = [{ code: 'CONNECTION' }, { code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(target.requests.length, 0);
    assert.equal(task.recovery.attempts, 2);
    if (broken === 'fixed') { assert.equal(task.lifecycle, 'completed'); assert.equal(fixture.main.requests.length - previous.calls.length, 3); }
    else { assert.equal(task.lifecycle, 'paused'); assert.match(task.recovery.reason, ['billing', 'unknown-account'].includes(broken) ? /BILLING_PATH_CHANGED/ : broken === 'protocol' ? /MODEL_FORMAT_UNSUPPORTED/ : /CONTEXT_CAPACITY_EXCEEDED/); }
    assert.equal(task.takeover, null);
    assertAccounted(task, [{ requests: fixture.main.requests.slice(previous.calls.length) }, target]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

for (const unknownPricing of [false, true]) test(`ordinary recovery retains the exact image attachment and ${unknownPricing ? 'refuses unknown' : 'proves declared'} image pricing`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-image-'));
  let ctx;
  try {
    const fixture = await prepare(home, { nativeOptions: { images: true }, mainOptions: { image: true } }); ctx = fixture.ctx;
    fixture.main.modalities = ['text', 'image']; fixture.main.imagePricingUnknown = unknownPricing;
    const previous = await submitTask(ctx, fixture.sessionId, 'Prepare to carry the original image.');
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const task = await submitTask(ctx, fixture.sessionId, '', [{ type: 'text', text: 'Keep the original image.' }, { type: 'image', mediaType: 'image/png', data: png }]);
    const requests = fixture.main.requests.slice(previous.calls.length);
    assert.equal(requests.length, unknownPricing ? 1 : 2);
    if (unknownPricing) { assert.equal(task.lifecycle, 'paused'); assert.equal(task.recovery.reason, 'RECOVERY_IMAGE_FORECAST_UNKNOWN'); }
    else {
      assert.equal(task.lifecycle, 'completed');
      const first = requests[0].messages.flatMap(message => message.content).find(part => part.type === 'image');
      const last = requests[1].messages.flatMap(message => message.content).find(part => part.type === 'image');
      assert.deepEqual(last.attachment, first.attachment);
      const stored = await ctx.attachments.readImage(last.attachment, new AbortController().signal);
      const original = await ctx.attachments.readImage(first.attachment, new AbortController().signal);
      assert.deepEqual(stored.data, original.data);
      assert.equal('sha256:' + createHash('sha256').update(stored.data).digest('hex'), first.attachment.attachmentId);
      assert.equal(task.recovery.imageForecast.visualTokens, 64);
      assert.equal(task.recovery.finalRequest.nativeRequest, true);
    }
    assertAccounted(task, [{ requests }]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

test('two explicit manual retry-current actions cannot silently dispatch the configured alternative', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-manual-fixed-target-'));
  let ctx, running;
  try {
    const fixture = await prepare(home, { policy: { automatic: false } }); ctx = fixture.ctx;
    const target = new RecoveryFixture();
    const registration = await register(ctx, 't18-manual-alternative', target, { connectionId: fixture.registration.source.connectionId, accountId: fixture.registration.source.accountId });
    const previous = await submitTask(ctx, fixture.sessionId);
    await ctx.router.setFixedModel(null); await ctx.router.setModelEnabled('controlled', false); await ctx.router.setModelEnabled('controlled-tools', false);
    await ctx.router.setRecoveryPolicy({ ...(await ctx.router.snapshot()).config.recovery, alternativeCandidateId: registration.candidate.candidateId });
    fixture.main.failures = [{ code: 'CONNECTION' }, { code: 'CONNECTION' }];
    running = submitTask(ctx, fixture.sessionId);
    for (const attempt of [1, 2]) {
      const live = await waitForSnapshot(ctx, state => state.tasks.find(task => task.recovery?.state === 'waiting-user' && task.recovery.attempts === attempt));
      await ctx.router.resolveTaskRecovery({ taskId: live.id, recoveryId: live.recovery.id, expectedRevision: live.recovery.revision, action: 'retry-current' });
    }
    const task = await running;
    assert.equal(task.lifecycle, 'completed'); assert.equal(target.requests.length, 0);
    assert.equal(fixture.main.requests.length - previous.calls.length, 3);
    assertAccounted(task, [{ requests: fixture.main.requests.slice(previous.calls.length) }, target]);
  } finally {
    if (ctx) { for (const task of (await ctx.router.snapshot()).tasks.filter(task => !task.nativeLifecycle)) await ctx.router.stopTask(task.id); await running; await ctx.fiber.dispose(); }
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('a real recovery state write failure stops dispatch and releases reservations while retaining known usage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-t18-storage-'));
  let ctx, failed = false;
  try {
    const files = { rename, async writeFile(path, value, options) { if (JSON.parse(value).tasks.some(task => task.recovery?.state === 'planning')) { failed = true; throw Object.assign(new Error('Controlled full disk'), { code: 'ENOSPC' }); } return writeFile(path, value, options); } };
    const fixture = await prepare(home, { nativeOptions: { files } }); ctx = fixture.ctx;
    fixture.main.failures = [{ code: 'CONNECTION' }];
    const task = await submitTask(ctx, fixture.sessionId);
    assert.equal(failed, true); assert.equal(fixture.main.requests.length, 1);
    assert.equal(task.lifecycle, 'paused'); assert.equal(task.pauseReason, 'STATE_WRITE_FAILED');
    assert.equal(task.ledger.tokens.total, 12); assert.equal(task.acceptance.verdict, 'unconfirmed');
    assertAccounted(task, [fixture.main]);
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
