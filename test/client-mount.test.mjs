import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react-test-renderer';
import { mountSettings } from './client-harness.mjs';

test('the native Cordis and rc.2 renderer mount the Router settings and RPC task records', async () => {
  const mounted = await mountSettings();
  try {
    assert.equal(mounted.ctx.slots.entries('settings.section')[0].options.label(), 'DSH Router');
    assert.equal(mounted.page.root.findAllByProps({ 'data-slot-error': 'settings.section' }).length, 0, mounted.errors.map(item => item.error.message).join('\n'));
    assert.match(JSON.stringify(mounted.page.toJSON()), /ROUTER_OK/);
    assert.match(JSON.stringify(mounted.page.toJSON()), /无法确认/);
    assert.equal(mounted.calls[0].endpoint, 'router/snapshot');
    const button = mounted.page.root.findAllByType('button').find(item => item.children.includes('暂停自动路由'));
    await act(async () => { await button.props.onClick(); });
    assert.match(JSON.stringify(mounted.page.toJSON()), /已暂停/);
    assert.deepEqual(mounted.calls.at(-1), { path: '/api', endpoint: 'router/setAutomatic', payload: { args: { automatic: false } } });
    assert.equal(mounted.errors.length, 0);
    await mounted.unload();
    assert.equal(mounted.ctx.slots.entries('settings.section').length, 0);
    assert.equal(mounted.ctx.get('remote.router'), undefined);
    await mounted.reload();
    assert.match(JSON.stringify(mounted.page.toJSON()), /ROUTER_OK/);
    assert.equal(mounted.ctx.slots.entries('settings.section').length, 1);
  } finally {
    await mounted.dispose();
  }
});
