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
      BUDGET_STOPPED: '用户已停止此任务；已报告的消耗保留。',
    };
    const amountKind = kind => ({ 'api-calculated': '计算费用', 'subscription-reference': '订阅参考价值', 'fixture-reference': '本地 fixture 参考值' })[kind] ?? '未知费用';
    const budgetReason = value => value.resource === 'tokens' ? 'token 上限' : value.resource === 'durationMs' ? '耗时上限' : value.resource === 'money' ? `${value.currency} ${amountKind(value.kind)}上限` : '预算限制';
    const budgetWarning = value => value.reason === 'UNKNOWN_USAGE_OR_FORECAST' ? 'token 用量或预测不完整，只能检查已知消耗。' : value.reason === 'UNKNOWN_NEXT_CALL_DURATION' ? '下一次调用耗时未知，只能检查已耗用时间；运行中的调用可能超过估算。' : value.reason === 'UNKNOWN_PRICE_USAGE_OR_CURRENCY' ? `${value.currency} ${amountKind(value.kind)}缺少适用报价、完整用量或同币种预测，无法完整执行金额上限。` : '旧记录的预算限制无法确认。';
    const number = value => value === null || value === undefined ? '未知' : String(value);
    const field = (label, value, update, disabled, props = {}) => h('label', { style: { display: 'block', margin: '8px 0' } }, `${label} `, h('input', { 'aria-label': label, value, disabled, onChange: event => update(event.target.value), ...props }));
    function BudgetEditor({ budget, disabled, save }) {
      const empty = { tokens: null, durationMs: null, money: [] };
      const [draft, setDraft] = React.useState(budget ?? empty);
      React.useEffect(() => { setDraft(budget ?? empty); }, [JSON.stringify(budget)]);
      const patch = change => setDraft(current => ({ ...current, ...change }));
      return h('fieldset', { disabled }, h('legend', null, '新任务预算'),
        h('p', null, '留空表示不限。保存只影响新任务；当前任务使用下方的扩展预算。预留为估算，单次实际请求可能超出，不能保证绝对账单上限。'),
        field('每任务 token 上限', draft.tokens ?? '', value => patch({ tokens: value === '' ? null : Number(value) }), disabled, { type: 'number', min: 0, step: 1 }),
        field('每任务耗时上限（秒）', draft.durationMs === null ? '' : draft.durationMs / 1000, value => patch({ durationMs: value === '' ? null : Math.round(Number(value) * 1000) }), disabled, { type: 'number', min: 0, step: 0.001 }),
        ...draft.money.map((item, index) => h('div', { key: index },
          h('label', null, '币种 ', h('input', { 'aria-label': `金额币种 ${index + 1}`, value: item.currency, onChange: event => patch({ money: draft.money.map((entry, position) => position === index ? { ...entry, currency: event.target.value.toUpperCase() } : entry) }) })),
          h('select', { 'aria-label': `金额口径 ${index + 1}`, value: item.kind, onChange: event => patch({ money: draft.money.map((entry, position) => position === index ? { ...entry, kind: event.target.value } : entry) }) }, ...['api-calculated', 'subscription-reference', 'fixture-reference'].map(kind => h('option', { key: kind, value: kind }, amountKind(kind)))),
          field(`金额上限 ${index + 1}`, item.amount, value => patch({ money: draft.money.map((entry, position) => position === index ? { ...entry, amount: Number(value) } : entry) }), disabled, { type: 'number', min: 0, step: 'any' }),
          h('button', { type: 'button', onClick: () => patch({ money: draft.money.filter((_entry, position) => position !== index) }) }, `删除金额限制 ${index + 1}`))),
        h('button', { type: 'button', onClick: () => patch({ money: [...draft.money, { currency: 'USD', kind: 'api-calculated', amount: 0 }] }) }, '添加金额限制'),
        h('button', { type: 'button', onClick: () => save(draft) }, '保存新任务预算'),
        h('p', null, '缺少适用报价、用量或预测时，金额限制无法完整执行；不同币种及费用/参考价值分别计算，不合并换算。耗时在新调用前检查，不能中断已经发送的请求。'));
    }
    function TaskBudget({ task, disabled, change, api }) {
      const [tokens, setTokens] = React.useState('');
      const [seconds, setSeconds] = React.useState('');
      const [money, setMoney] = React.useState({});
      if (!task.budget) return null;
      const active = ['running', 'waiting-budget'].includes(task.lifecycle);
      const limits = task.budget.limits;
      return h('div', null,
        h('p', null, `任务预算：token ${limits.tokens === null ? '不限' : limits.tokens} · 耗时 ${limits.durationMs === null ? '不限' : `${limits.durationMs / 1000} 秒`}${task.lifecycle === 'waiting-budget' ? ' · 预算等待：下一次调用尚未发送' : ''}`),
        ...limits.money.map(item => h('p', { key: `${item.currency}:${item.kind}` }, `${amountKind(item.kind)}上限：${item.currency} ${item.amount}`)),
        ...(task.budget.unenforceableLimits ?? []).map(reason => h('p', { key: `${reason.resource}:${reason.currency ?? ''}:${reason.kind ?? ''}:${reason.reason}`, role: 'status' }, budgetWarning(reason))),
        task.budget.waiting && active ? h('p', null, `等待原因：${task.budget.waiting.blockedBy.map(budgetReason).join('、')} · 下次预留 token ${number(task.budget.waiting.proposedTokens)}`) : null,
        active ? h('fieldset', { disabled }, h('legend', null, '扩展或停止当前任务'),
          limits.tokens !== null ? field(`增加 token ${task.id}`, tokens, setTokens, disabled, { type: 'number', min: 1, step: 1 }) : null,
          limits.durationMs !== null ? field(`增加秒数 ${task.id}`, seconds, setSeconds, disabled, { type: 'number', min: 0.001, step: 0.001 }) : null,
          ...limits.money.map(item => field(`增加 ${item.currency} ${amountKind(item.kind)} ${task.id}`, money[`${item.currency}:${item.kind}`] ?? '', value => setMoney(current => ({ ...current, [`${item.currency}:${item.kind}`]: value })), disabled, { type: 'number', min: 0, step: 'any' })),
          h('button', { type: 'button', onClick: () => {
            const extension = { ...(Number(tokens) > 0 ? { tokens: Number(tokens) } : {}), ...(Number(seconds) > 0 ? { durationMs: Math.round(Number(seconds) * 1000) } : {}) };
            const amounts = limits.money.filter(item => Number(money[`${item.currency}:${item.kind}`]) > 0).map(item => ({ ...item, amount: Number(money[`${item.currency}:${item.kind}`]) }));
            if (amounts.length) extension.money = amounts;
            return change(() => api.extendTaskBudget(task.id, extension));
          } }, `扩展任务预算 ${task.id}`),
          h('button', { type: 'button', onClick: () => change(() => api.stopTask(task.id)) }, `停止任务 ${task.id}`)) : null,
        h('p', null, `预算扩展：${task.budget.extensions.length} 次；沿用本任务和历史。`));
    }
    function TaskLedger({ task }) {
      const ledger = task.ledger;
      if (!ledger) return h('p', null, '旧记录尚无完整账本；缺失项保留未知。');
      return h('div', null,
        h('p', null, `token：${number(ledger.tokens.total)}${ledger.tokens.total === null ? `（已知部分 ${ledger.knownTokens.total}）` : ''} · 输入 ${number(ledger.tokens.input)} · 输出 ${number(ledger.tokens.output)} · 缓存读 ${number(ledger.tokens.cacheRead)} · 缓存写 ${number(ledger.tokens.cacheWrite)} · 推理 ${number(ledger.tokens.reasoning)}`),
        h('p', null, `耗时：${(ledger.elapsedMs / 1000).toFixed(3)} 秒 · 记账调用 ${ledger.callCount}`),
        task.nativeLifecycle === 'completed' && ['running', 'waiting-budget'].includes(task.lifecycle) ? h('p', null, '原生 turn 已完成，所属辅助调用仍在处理；任务预算继续生效。') : null,
        ledger.uncertainDispatchCalls ? h('p', null, `${ledger.uncertainDispatchCalls} 次调用仅保留可能派发的意图；是否实际发送及消耗未知，不能按零计算。`) : null,
        ...ledger.money.map(item => h('p', { key: `${item.currency}:${item.kind}` }, `${amountKind(item.kind)}：${item.currency} ${number(item.amount)}${item.amount === null ? `（已知部分 ${item.knownSubtotal}；${item.unknownCalls} 次用量未完整）` : ''} · 估算，账单未确认`)),
        ledger.unknownPriceCalls ? h('p', null, `${ledger.unknownPriceCalls} 次调用缺少价格，费用未知，不能按零支出或执行完整金额上限。`) : null,
        ...task.calls.map(call => h('details', { key: call.id }, h('summary', null, `${call.purpose}${call.nativePurpose ? ` (${call.nativePurpose})` : ''} · ${call.selection.provider}/${call.selection.model} · ${call.status}`),
          call.priceQuote ? h('p', null, `${amountKind(call.priceQuote.kind)}报价来源：${call.priceQuote.source} · ${call.priceQuote.date} · ${call.priceQuote.currency} · ${confidence(call.priceQuote.confidence)} · ${call.priceQuote.reasoning === 'included-in-output' ? '推理已含于输出，不重复计价' : call.priceQuote.reasoning === 'separate' ? '推理单独计价' : '推理重叠关系未知'}`) : h('p', null, '价格未知'),
          call.overEstimate?.length ? h('p', null, '实际用量超过预留；单次请求可能超出预算估算。') : null,
          h('pre', null, JSON.stringify({ selection: call.selection, reservation: call.reservation, usage: call.usage, cost: call.cost, priceQuote: call.priceQuote }, null, 2)))));
    }
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
        h('p', null, '当前连接仅生成本地测试响应，不产生真实费用。参考报价由公开设置命令保存，不代表官方价格或实际账单。'),
        h(BudgetEditor, { budget: state.config.budget, disabled, save: budget => change(() => api.setBudgetDefaults(budget)) }),
        ...state.tasks.filter(task => ['running', 'waiting-budget'].includes(task.lifecycle)).map(task => h('article', { key: task.id }, h('strong', null, task.id), h(TaskLedger, { task }), h(TaskBudget, { task, disabled, change, api }))));
      const history = () => h('div', null, h('h3', null, '任务记录'), state.tasks.length === 0 ? h('p', null, '尚无任务。') : h('ol', null, ...state.tasks.slice(-20).reverse().map(task => h('li', { key: task.id, style: { padding: '12px 0', whiteSpace: 'pre-wrap' } },
        h('strong', null, `${task.activeSelection?.provider ?? '尚未选择'}/${task.activeSelection?.model ?? '—'}`),
        h('p', null, `${task.lifecycle === 'completed' ? '响应完成' : task.lifecycle === 'paused' ? '任务暂停' : task.lifecycle === 'waiting-budget' ? '预算等待' : '执行中'} · 验收：无法确认${task.pauseReason ? ` · ${reasons[task.pauseReason] ?? task.pauseReason}` : ''}`),
        h('p', null, task.result || '尚无输出'), h('small', null, `有效配置 ${task.configVersion} · ${task.id}`),
        h(TaskLedger, { task }), h(TaskBudget, { task, disabled, change, api }),
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
          ...(state.blockedRequests ?? []).slice(-5).map((request, index) => h('p', { key: `${request.at}:${index}`, role: 'status' }, `辅助请求 ${request.nativePurpose} ${request.reason === 'AUXILIARY_LIFECYCLE_UNAVAILABLE' ? '缺少可观察的流生命周期' : '无法安全关联活动任务'}，尚未发送：${request.reason}`)),
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
