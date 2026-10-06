import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startNative, submit } from '../test/t02-harness.mjs';

const home = await mkdtemp(join(tmpdir(), 'router-same-route-'));
const ctx = await startNative(home);
try {
  await ctx.router.setFixedModel('controlled-tools');
  const { sessionId } = await ctx.sessionController.create({ cwd: home });
  const session = ctx.sessions.get(sessionId);
  await submit(ctx, sessionId, 'Reply INITIAL_B');
  await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled-tools' });
  const matching = await submit(ctx, sessionId, 'Reply MATCHING_B');
  console.log(JSON.stringify({ phase: 'same-route', result: matching.result, header: session.requestHeader().config, native: ctx.sessionProjections.stateOf(session, 'modelSelection') }));
  await ctx.router.setFixedModel('controlled');
  const paused = await submit(ctx, sessionId, 'Reply CONFLICT_A');
  console.log(JSON.stringify({ phase: 'conflict', reason: paused.pauseReason, calls: paused.calls.length, native: ctx.sessionProjections.stateOf(session, 'modelSelection') }));
  await ctx.sessionController.selectModel({ sessionId, provider: 'router-controlled', model: 'controlled' });
  const recovered = await submit(ctx, sessionId, 'Reply RECOVERED_A');
  console.log(JSON.stringify({ phase: 'public-recovery', result: recovered.result, header: session.requestHeader().config, native: ctx.sessionProjections.stateOf(session, 'modelSelection') }));
} finally {
  await ctx.fiber.dispose();
  await rm(home, { recursive: true, force: true });
}
