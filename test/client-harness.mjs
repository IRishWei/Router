import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as cordis from '@deepseek-ai/cordis';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import renderer, { act } from 'react-test-renderer';

async function loadClient(path, imports, diagnostics, openedUrls = [], openPopup) {
  let plugin;
  const window = {
    open(url) {
      if (openPopup && openPopup(url) === null) return null;
      const entry = { url, closed: false };
      openedUrls.push(entry);
      const popup = { opener: window, closed: false, close() { this.closed = true; entry.closed = true; } };
      popup.location = { get href() { return entry.url; }, set href(value) { entry.url = value; } };
      return popup;
    },
  };
  vm.runInNewContext(await readFile(path, 'utf8'), {
    queueMicrotask, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: webcrypto,
    console: { ...console, error: (...args) => diagnostics.push(args) },
    window: { ...window, __ModuleLoader__: { load(module) {
      plugin = module.factory(name => {
        if (!(name in imports)) throw new Error(`Unexpected client dependency: ${name}`);
        return imports[name];
      });
    } } },
  }, { filename: path });
  return plugin;
}

export function taskState() {
  return { schemaVersion: 1, config: { automatic: true, version: 1 }, storageError: null, models: [], tasks: [{ id: 'task-one', activeSelection: { provider: 'router-controlled', model: 'controlled' }, lifecycle: 'completed', result: 'ROUTER_OK', configVersion: 1, timeline: [] }] };
}

// Only the transport and browser DOM mount are external. Slot assembly,
// Cordis dependency tracing, namespace mounting, and RPC codecs use rc.2 code.
export async function mountSettings(initialState = taskState(), carrier, { openPopup } = {}) {
  const diagnostics = [], errors = [], calls = [], openedUrls = [];
  const imports = { 'react': React, 'react/jsx-runtime': jsx, '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slots, 'react-dom': {}, 'react-dom/client': {} };
  const native = name => loadClient(`node_modules/@deepseek-ai/${name}/lib/client.js`, imports, diagnostics, openedUrls, openPopup);
  const [nativeRenderer, registry, gateway, client] = await Promise.all([
    native('dsh-client-ui-renderer'), native('dsh-typert-registry'), native('dsh-api-gateway'), loadClient('lib/client.js', imports, diagnostics, openedUrls, openPopup),
  ]);
  const ctx = new cordis.Context();
  let state = structuredClone(initialState), page, clientFiber;
  const connection = {
    rpc: {
      open: () => { throw new Error('This settings test must not open a stream'); },
      async call(path, endpoint, payload) {
        calls.push({ path, endpoint, payload: structuredClone(payload) });
        if (carrier) return carrier(path, endpoint, payload);
        if (endpoint === 'router/setAutomatic') state = { ...state, config: { automatic: payload.args.automatic, version: state.config.version + 1 } };
        else if (endpoint !== 'router/snapshot') throw new Error(`Unexpected RPC endpoint: ${endpoint}`);
        return { ok: true, value: structuredClone(state) };
      },
    },
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
  };
  try {
    ctx.provide('connection', connection);
    await ctx.plugin(registry);
    await ctx.plugin(gateway);
    await ctx.plugin(nativeRenderer);
    ctx.slots.onEntryError((key, entry, error, info) => errors.push({ key, entry, error, info }));
    await ctx.plugin({ inject: ['slots'], apply(ctx) {
      const binding = { hooks: {}, keyedHooks: {}, props: {}, ctx };
      ctx.slots.installScope('session', { current: { getSnapshot: () => binding, subscribe: () => () => {} } });
      ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, ({ renderSlot }) => React.createElement('main', null, renderSlot('settings.section', {}, { only: 'router' })));
    } });
    clientFiber = await ctx.plugin(client);
    await act(async () => { page = renderer.create(ctx.slots.renderSlot('root', {})); });
    return {
      ctx, page, errors, diagnostics, calls, openedUrls, client,
      async unload() { await act(async () => { await clientFiber.dispose(); }); },
      async reload() { await act(async () => { clientFiber = await ctx.plugin(client); }); },
      async dispose() {
        await act(async () => { page.unmount(); });
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    if (page) await act(async () => { page.unmount(); });
    await ctx.fiber.dispose();
    throw error;
  }
}
