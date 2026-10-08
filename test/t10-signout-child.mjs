import { credentialsContext, stateFor } from './t10-harness.mjs';
import { ChatGptHost } from '../src/chatgpt-host.mjs';
import { CHATGPT_CREDENTIAL_KEY } from '../src/chatgpt-oauth.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';
import { lookup } from 'node:dns/promises';
const [home, origin] = process.argv.slice(2);
const ctx = await credentialsContext(home);
const record = await ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY);
const host = new ChatGptHost(ctx, { chatGpt: stateFor(record) }, async () => {}, {
  transport: createSourceNetworkTransport({ lookup, directOnly: true }),
  endpoints: { kind: 'controlled-test', authorizationURL: `${origin}/authorize`, tokenURL: `${origin}/token`, discoveryURL: `${origin}/discovery`, modelsURL: `${origin}/models` },
  mountConnection: async () => ({ disconnect: async () => {} }),
});
await host.initialize();
process.send({ type: 'ready' });
process.once('message', async () => {
  try { await host.signOut(); process.send({ type: 'result', ok: true }); }
  catch (cause) { process.send({ type: 'result', ok: false, code: cause.code ?? 'UNKNOWN' }); }
  finally { await host.dispose(); await ctx.fiber.dispose(); process.disconnect(); }
});
