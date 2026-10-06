window.__ModuleLoader__.load({
  id: '@irishwei/dsh-router',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const valueOf = result => { if (!result.ok) throw result.error; return result.value; };
    const confidence = value => ({ known: '已知', declared: '声明', unknown: '未知' })[value] ?? '未知';
    const reasons = {
      NO_ENABLED_CANDIDATE: '没有已启用的候选，请在连接与模型页启用模型。',
      NO_COMPATIBLE_IMAGE_CANDIDATE: '当前模型池没有已确认支持图像的候选，任务已暂停；请选择支持图像的有效原生模型。',
      MODEL_DISABLED: '所选模型已禁用，请重新启用或在原生菜单选择有效模型。',
      MODEL_REMOVED: '所选模型已移除，请加入模型池或在原生菜单选择有效模型。',
      FIXED_MODEL_UNAVAILABLE: '固定模型不可用，请重新启用该模型或解除固定。',
      FIXED_MODEL_CONFLICT: '原生待执行选择与固定模型冲突，请解除固定或在原生菜单选择固定模型。',
      NATIVE_SELECTION_CHANGED: '组装请求时原生选择发生变化，已暂停并保留手动选择；确认固定设置后再次发送任务。',
    };
    function RouterSettings({ api }) {
      const [state, setState] = React.useState(null);
      const [page, setPage] = React.useState('连接与模型');
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const refresh = async () => { try { setState(valueOf(await api.snapshot())); setError(''); } catch { setError('无法读取 Router 状态，请检查插件是否已启用。'); } };
      React.useEffect(() => { void refresh(); }, []);
      const change = async action => {
        setBusy(true);
        try { setState(valueOf(await action())); setError(''); }
        catch { setError('设置保存失败，请检查模型是否有效及 DSH 本地存储。'); }
        finally { setBusy(false); }
      };
      const disabled = busy || Boolean(state?.storageError);
      const pool = () => h('div', null, h('h3', null, '连接与模型'), h('p', null, '本地可控连接：两个测试模型，不连接服务、不产生真实费用。能力声明与已知兼容性分别显示。'), ...state.models.map(model => h('article', { key: model.id, style: { padding: '12px 0' } },
        h('strong', null, model.name),
        h('p', null, `${model.connectionId} · ${model.inPool ? '在模型池中' : '已移除'} · ${model.enabled ? '已启用' : '未启用'}`),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': `启用 ${model.name}`, checked: model.enabled, disabled: disabled || !model.inPool, onChange: event => change(() => api.setModelEnabled(model.id, event.target.checked)) }), '启用'),
        h('button', { type: 'button', disabled, onClick: () => change(() => model.inPool ? api.removeModel(model.id) : api.setModelEnabled(model.id, true)) }, `${model.inPool ? '移除' : '加入模型池'} ${model.name}`),
        h('p', null, Object.entries(model.capability).map(([name, fact]) => `${({ text: '文本', image: '图像', tools: '工具' })[name]}：${fact.supported === null ? '尚未确认' : fact.supported ? '支持' : '不支持'}（${confidence(fact.confidence)}）`).join(' · ')),
        h('p', null, `兼容性：${confidence(model.compatibility.confidence)}，范围为本地可控协议；不代表真实服务权限或效果。`))));
      const routing = () => h('div', null,
        h('h3', null, '路由与预算'),
        h('p', null, `自动路由：${state.config.automatic ? '已启用' : '已暂停；原生模型选择仍可用'}`),
        h('button', { type: 'button', disabled, onClick: () => change(() => api.setAutomatic(!state.config.automatic)) }, state.config.automatic ? '暂停自动路由' : '启用自动路由'),
        h('label', null, '固定执行模型 ', h('select', { 'aria-label': '固定执行模型', value: state.config.fixedModel ?? '', disabled, onChange: event => change(() => api.setFixedModel(event.target.value || null)) },
          h('option', { value: '' }, '自动选择已启用模型'), ...state.models.map(model => h('option', { key: model.id, value: model.id, disabled: !model.enabled }, `${model.name}${model.enabled ? '' : '（不可用）'}`)))),
        h('button', { type: 'button', disabled: disabled || !state.config.fixedModel, onClick: () => change(() => api.setFixedModel(null)) }, '解除固定'),
        h('p', null, '固定时不自动更换执行模型。与原生待执行选择冲突时暂停并保留手动意图。暂停自动路由后保留设置，使用有效的原生选择。'),
        h('p', null, '当前连接仅生成本地测试响应，不产生真实费用。'));
      const history = () => h('div', null, h('h3', null, '任务记录'), state.tasks.length === 0 ? h('p', null, '尚无任务。') : h('ol', null, ...state.tasks.slice(-20).reverse().map(task => h('li', { key: task.id, style: { padding: '12px 0', whiteSpace: 'pre-wrap' } },
        h('strong', null, `${task.activeSelection?.provider ?? '尚未选择'}/${task.activeSelection?.model ?? '—'}`),
        h('p', null, `${task.lifecycle === 'completed' ? '响应完成' : task.lifecycle === 'paused' ? '任务暂停' : '执行中'} · 验收：无法确认${task.pauseReason ? ` · ${reasons[task.pauseReason] ?? task.pauseReason}` : ''}`),
        h('p', null, task.result || '尚无输出'), h('small', null, `有效配置 ${task.configVersion} · ${task.id}`),
        h('details', null, h('summary', null, '选择与结果记录'), h('pre', null, JSON.stringify(task.timeline, null, 2)))))));
      return h('section', { style: { maxWidth: 720, display: 'grid', gap: 16 } },
        h('h2', null, 'DSH Router'),
        h('p', null, '启用模型池和自动路由后发送 Reply ROUTER_OK。暂停后可在原生会话模型菜单选择仍有效的模型。'),
        h('nav', { 'aria-label': 'Router 设置' }, ...['连接与模型', '路由与预算', '任务记录'].map(label => h('button', { key: label, type: 'button', 'aria-pressed': page === label, onClick: () => setPage(label) }, label))),
        error ? h('p', { role: 'alert' }, error) : null,
        !state ? h('p', null, '加载中…') : h(React.Fragment, null,
          h('p', { role: 'status' }, `期望配置 ${state.config.version} · ${state.application?.status === 'pending' ? '待生效：下一稳定请求应用' : '已生效'}`),
          ...(state.application?.active ?? []).map(task => h('p', { key: task.taskId }, `当前任务有效配置 ${task.appliedVersion} · 期望配置 ${task.desiredVersion}`)),
          state.storageError ? h('p', { role: 'alert' }, state.storageError) : null,
          h('button', { type: 'button', onClick: refresh }, '刷新任务记录'),
          page === '连接与模型' ? pool() : page === '路由与预算' ? routing() : history()));
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
