window.__ModuleLoader__.load({
  id: '@irishwei/dsh-router',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const valueOf = result => { if (!result.ok) throw result.error; return result.value; };
    function RouterSettings({ api }) {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const refresh = async () => { try { setState(valueOf(await api.snapshot())); setError(''); } catch { setError('无法读取 Router 状态，请检查插件是否已启用。'); } };
      React.useEffect(() => { void refresh(); }, []);
      const toggle = async () => {
        setBusy(true);
        try { setState(valueOf(await api.setAutomatic(!state.config.automatic))); setError(''); }
        catch { setError('设置保存失败，请检查 DSH 本地存储。'); }
        finally { setBusy(false); }
      };
      return h('section', { style: { maxWidth: 720, display: 'grid', gap: 16 } },
        h('h2', null, 'DSH Router'),
        h('p', null, '先在会话模型菜单选择 Router 的 Controlled fixture，发送 Reply ROUTER_OK。此本地模型不连接服务、不产生真实费用。'),
        error ? h('p', { role: 'alert' }, error) : null,
        !state ? h('p', null, '加载中…') : h(React.Fragment, null,
          h('p', null, `自动路由：${state.config.automatic ? '已启用（单个可控模型）' : '已暂停；原生模型选择仍可用'} · 配置版本 ${state.config.version}`),
          state.storageError ? h('p', { role: 'alert' }, state.storageError) : null,
          h('button', { type: 'button', disabled: busy || Boolean(state.storageError), onClick: toggle }, state.config.automatic ? '暂停自动路由' : '启用自动路由'),
          h('button', { type: 'button', onClick: refresh }, '刷新任务记录'),
          h('h3', null, '任务记录'),
          state.tasks.length === 0 ? h('p', null, '尚无任务。') : h('ol', null, ...state.tasks.slice(-20).reverse().map(task => h('li', { key: task.id, style: { padding: '12px 0', whiteSpace: 'pre-wrap' } },
            h('strong', null, `${task.activeSelection?.provider ?? '尚未选择'}/${task.activeSelection?.model ?? '—'}`),
            h('p', null, `${task.lifecycle === 'completed' ? '响应完成' : task.lifecycle === 'paused' ? '任务暂停' : '执行中'} · 验收：无法确认${task.pauseReason ? ` · ${task.pauseReason}` : ''}`),
            h('p', null, task.result || '尚无输出'),
            h('small', null, `配置 ${task.configVersion} · ${task.id}`),
            h('details', null, h('summary', null, '选择与结果记录'), h('pre', null, JSON.stringify(task.timeline, null, 2))))))));
    }
    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        const descriptors = __ROUTER_REMOTE_DESCRIPTORS__;
        const dispose = await ctx.remote.$mount({ package: '@irishwei/dsh-router', descriptors });
        ctx.effect(() => dispose, 'router: Remote facade');
        // The owner must mount the namespace before its consumer can depend on it.
        await ctx.plugin({
          name: 'router.settings',
          inject: ['slots', 'remote.router'],
          apply(settingsCtx) {
            settingsCtx.slots.inject('settings.section', () => settingsCtx.slots.register({ name: 'settings.section', id: 'router', order: 45, label: () => 'DSH Router', inject: () => ({ api: settingsCtx.remote.router }) }, RouterSettings));
          },
        });
      },
    };
  },
});
