import { mountSettings } from '../test/client-harness.mjs';

const mounted = await mountSettings();
try {
  console.log(JSON.stringify({
    registered: mounted.ctx.slots.entries('settings.section').map(entry => entry.options.id),
    errors: mounted.errors.map(({ key, error }) => ({ slot: key, message: error.message })),
    rpc: mounted.calls.map(({ endpoint }) => endpoint),
    tree: mounted.page.toJSON(),
  }, null, 2));
} finally {
  await mounted.dispose();
}
