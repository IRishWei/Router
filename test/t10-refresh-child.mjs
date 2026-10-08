import { credentialsContext, registrationFor } from './t10-harness.mjs';
import { CHATGPT_CREDENTIAL_KEY } from '../src/chatgpt-oauth.mjs';
import { ChatGptSessions } from '../src/chatgpt-sessions.mjs';
import { createSourceNetworkTransport } from '../src/source-network.mjs';
import { lookup } from 'node:dns/promises';
const [home, origin, hostId] = process.argv.slice(2);
const ctx = await credentialsContext(home);
const registration = registrationFor(await ctx.credentials.readRecord(CHATGPT_CREDENTIAL_KEY));
const sessions = new ChatGptSessions({ credentials: ctx.credentials, hostId, transport: createSourceNetworkTransport({ lookup, directOnly: true }),
  endpoints: { kind: 'controlled-test', authorizationURL: `${origin}/authorize`, tokenURL: `${origin}/token`, discoveryURL: `${origin}/discovery`, modelsURL: `${origin}/models` },
});
process.send({ type: 'ready' });
process.once('message', async () => {
  try { await sessions.ensure(registration); process.send({ type: 'result', ok: true }); }
  catch (cause) { process.send({ type: 'result', ok: false, code: cause.code ?? 'UNKNOWN' }); }
  finally { await ctx.fiber.dispose(); process.disconnect(); }
});
