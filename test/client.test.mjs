import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

test('the native settings page reads successful RemoteResult task records and pauses routing', async () => {
  let client;
  vm.runInNewContext(await readFile('lib/client.js', 'utf8'), { window: { __ModuleLoader__: { load(module) { client = module.factory(name => { assert.equal(name, 'react'); return React; }); } } } });
  const state = { schemaVersion: 1, config: { automatic: true, version: 1 }, storageError: null, models: [], tasks: [{ id: 'task-one', activeSelection: { provider: 'router-controlled', model: 'controlled' }, lifecycle: 'completed', result: 'ROUTER_OK', configVersion: 1, timeline: [] }] };
  const api = {
    snapshot: async () => ({ ok: true, value: structuredClone(state) }),
    setAutomatic: async automatic => ({ ok: true, value: { ...state, config: { automatic, version: 2 } } }),
  };
  let component;
  await client.apply({ remote: { router: api, $mount: async () => () => {} }, effect: callback => callback(), slots: { inject: (_slot, callback) => callback(), register: (_options, view) => { component = view; return () => {}; } } });
  let page;
  await act(async () => { page = renderer.create(React.createElement(component, { api })); });
  assert.match(JSON.stringify(page.toJSON()), /ROUTER_OK/);
  assert.match(JSON.stringify(page.toJSON()), /无法确认/);
  const button = page.root.findAllByType('button').find(item => item.children.includes('暂停自动路由'));
  await act(async () => { await button.props.onClick(); });
  assert.match(JSON.stringify(page.toJSON()), /已暂停/);
  await act(async () => { page.unmount(); });
});
