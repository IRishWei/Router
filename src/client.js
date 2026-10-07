window.__ModuleLoader__.load({
  id: '@irishwei/dsh-router',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const valueOf = result => { if (!result.ok) throw result.error; return result.value; };
    const DeepSeekSettings = createDeepSeekSettingsComponent(React);
    const deepSeekService = api => ({
      snapshot: async () => valueOf(await api.snapshot()).deepSeek,
      saveCredential: async request => valueOf(await api.deepSeekSaveCredential(request)).deepSeek,
      discoverCatalog: async () => valueOf(await api.deepSeekDiscoverCatalog()).deepSeek.catalog,
      connect: async request => valueOf(await api.deepSeekConnect(request)).deepSeek,
      disconnect: async request => valueOf(await api.deepSeekDisconnect(request)).deepSeek,
      runDetection: async request => {
        const snapshot = valueOf(await api.deepSeekRunDetection(request));
        const task = snapshot.tasks.find(item => item.id === snapshot.deepSeek?.lastDetectionTaskId);
        if (!task) throw new Error('DeepSeek detection Task is unavailable');
        return {
          taskId: task.id,
          lifecycle: task.lifecycle,
          result: task.result ?? '',
          budget: task.budget.limits,
          ledger: task.ledger,
          calls: task.calls,
        };
      },
    });
    const deepSeekRouterApi = api => ({
      snapshot: async () => valueOf(await api.snapshot()),
      setModelEnabled: async (candidateId, enabled) => valueOf(await api.setModelEnabled(candidateId, enabled)),
    });
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
      NO_ELIGIBLE_CANDIDATE: '没有满足当前任务要求的候选。',
      ASSESSMENT_NOT_ENABLED: '任务请求语义判断，但判断调用尚未启用。',
      ASSESSMENT_BUDGET_REQUIRED: '语义判断需要先获得预算许可。',
      ASSESSMENT_EVIDENCE_INSUFFICIENT: '语义判断证据不足，未改变候选资格。',
    };
    const objectiveName = value => ({ balanced: '均衡', cost: '费用', tokens: 'token', speed: '速度', quality: '质量' })[value] ?? value;
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
    function RoutingDecision({ task }) {
      if (!task.routing) return h('p', null, '此任务没有起始路由记录。');
      const routing = task.routing;
      return h('div', null,
        h('p', null, `起始路由：${routing.status === 'selected' ? `${routing.selected.identity.provider}/${routing.selected.identity.model}` : routing.status === 'paused' ? '已暂停' : '判断中'} · 目标 ${objectiveName(routing.objective)} · 快照 ${routing.snapshotEpoch ?? '未知'}`),
        h('p', null, `理由：${(routing.reasonCodes ?? []).map(code => reasons[code] ?? code).join('、') || '未知'} · 要求：${(routing.requirements?.modalities ?? ['text']).join('+')}${routing.requirements?.tools ? ' + 工具' : ''} · 上下文估算 ${number(routing.requirements?.contextTokens)}`),
        ...(routing.excluded ?? []).map(item => h('p', { key: item.candidateId }, `排除 ${item.candidateId}：${item.reasons.join('、')}`)),
        routing.assessment ? h('p', null, `语义判断：${routing.assessment.status}${routing.assessment.callId ? ` · 调用 ${routing.assessment.callId}` : ''}${routing.assessment.reason ? ` · ${routing.assessment.reason}` : ''}`) : null,
        routing.comparison?.unknowns?.length ? h('p', null, `不可比较：${routing.comparison.unknowns.join('、')}`) : null);
    }
    function AcceptancePolicyEditor({ state, disabled, save }) {
      const defaults = { enabled: false, review: { enabled: false, candidateId: null, allowCrossModel: false, maxTokens: 256, forecastTokens: 4096 } };
      const [draft, setDraft] = React.useState(state.config.acceptance ?? defaults);
      React.useEffect(() => { setDraft(state.config.acceptance ?? defaults); }, [JSON.stringify(state.config.acceptance)]);
      const review = change => setDraft(current => ({ ...current, review: { ...current.review, ...change } }));
      return h('fieldset', { disabled }, h('legend', null, '明确要求验收'),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': '启用明确要求验收', checked: draft.enabled, onChange: event => setDraft(current => ({ ...current, enabled: event.target.checked })) }), '启用明确要求验收'),
        h('p', null, '仅检查用户在任务中明确写出的有限规则和工作区产物路径；没有明确要求时保持无法确认。设置只影响新任务。'),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': '启用有界匿名评审', checked: draft.review.enabled, onChange: event => review({ enabled: event.target.checked }) }), '启用有界匿名评审'),
        h('label', null, '评审候选 ', h('select', { 'aria-label': '评审候选', value: draft.review.candidateId ?? '', onChange: event => review({ candidateId: event.target.value || null }) },
          h('option', { value: '' }, '未选择'),
          ...state.models.map(model => h('option', { key: model.candidateId ?? model.id, value: model.candidateId ?? model.id, disabled: !model.enabled || !model.available }, `${model.name} · ${model.provider}/${model.model} · ${model.connectionId} · ${model.accountId} · ${model.billingPath}${model.enabled && model.available ? '' : '（不可用）'}`)))),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': '允许跨模型评审', checked: draft.review.allowCrossModel, onChange: event => review({ allowCrossModel: event.target.checked }) }), '允许评审候选与执行候选不同'),
        h('p', null, '跨模型默认关闭；开启表示明确许可所选候选参与匿名评审，仍受模型池、当前资格和任务预算约束。'),
        field('评审输出 token 上限', draft.review.maxTokens, value => review({ maxTokens: Number(value) }), disabled, { type: 'number', min: 1, max: 4096, step: 1 }),
        field('评审输入与输出总预留 token', draft.review.forecastTokens, value => review({ forecastTokens: Number(value) }), disabled, { type: 'number', min: 1, max: 65536, step: 1 }),
        h('button', { type: 'button', onClick: () => save(draft) }, '保存验收设置'));
    }
    function AcceptanceResult({ task }) {
      const acceptance = task.acceptance ?? { verdict: 'unconfirmed', evidence: [] };
      const label = acceptance.verdict === 'passed' ? '通过' : acceptance.verdict === 'failed' ? '失败' : '无法确认';
      const evidenceLabel = item => item.verdict === 'passed' ? '通过' : item.verdict === 'failed' ? '失败' : '未确认';
      const research = acceptance.research;
      const researchRows = [];
      for (const requirement of research?.requirements ?? []) {
        if (!requirement.kind.startsWith('research-') || requirement.kind === 'research-unresolved') continue;
        const support = (acceptance.evidence ?? []).find(item => item.requirementId === requirement.id && item.aspect === 'claim-support');
        researchRows.push(h('p', { key: `${requirement.id}:claim` }, `研究论点：${requirement.claim} · 论点支持：${support ? evidenceLabel(support) : '未确认'}${support?.reason ? ` · ${support.reason}` : ''}`));
        for (const reference of (research.sourceReferences ?? []).filter(item => item.requirementId === requirement.id)) {
          const snapshot = (research.sourceSnapshots ?? []).find(item => item.sourceReferenceId === reference.id);
          const access = (acceptance.evidence ?? []).find(item => item.sourceReferenceId === reference.id && item.aspect === 'source-access');
          const quote = (acceptance.evidence ?? []).find(item => item.sourceReferenceId === reference.id && item.aspect === 'quote-binding');
          researchRows.push(h('p', { key: reference.id }, `来源地址：${snapshot?.displayUrl ?? '不可用'} · 来源访问：${access ? evidenceLabel(access) : '未确认'} · 引文定位：${quote ? evidenceLabel(quote) : '未确认'}${snapshot?.reason ? ` · ${snapshot.reason}` : ''}`));
        }
      }
      return h('div', null,
        h('p', null, `验收：${label}${acceptance.coverage ? ` · 覆盖 ${acceptance.coverage.covered}/${acceptance.coverage.required}` : ''}`),
        ...(acceptance.evidence ?? []).map(item => h('p', { key: item.id ?? item.requirementId }, `${evidenceLabel(item)} · ${item.aspect ?? item.source?.kind ?? '未知来源'}${item.reason ? ` · ${item.reason}` : ''}`)),
        ...researchRows,
        acceptance.history?.length ? h('p', null, `保留 ${acceptance.history.length} 个已被新产物或要求取代的验收版本。`) : null,
        acceptance.limitations?.includes('no-overall-quality-guarantee') ? h('p', null, '覆盖仅限明确要求，不代表整体质量保证。') : null);
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
      const pool = () => h('div', null, h('h3', null, '连接与模型'), h('p', null, '通过宿主公开目录显示可复用连接；目录、配置和能力验证分别记录。原生引用不会复制认证材料，也不会自动启用。'),
        h('button', { type: 'button', disabled, onClick: () => change(() => api.refreshConnections()) }, '刷新宿主连接'),
        ...(state.unsupportedProviders ?? []).map(item => h('p', { key: `${item.provider}:${item.reason}`, role: 'status' }, `${item.displayName ?? item.provider}：暂不支持（${item.reason}）；未承诺社区 provider 通用兼容。`)),
        ...state.models.map(model => h('article', { key: model.candidateId ?? model.id, style: { padding: '12px 0' } },
        h('strong', null, model.name),
        h('p', null, `${model.connectionId} · ${model.ownership === 'native-reference' ? '宿主原生引用' : 'Router 自有'} · ${model.available ? '当前可用' : '已断开'} · ${model.inPool ? '在模型池中' : '未加入模型池'} · ${model.enabled ? '已启用' : '未启用'}`),
        h('p', null, `账号 ${model.accountId === 'unknown' ? '未知' : model.accountId} · 计费来源 ${model.billingPath === 'unknown' ? '未知' : model.billingPath} · Router 使用许可 ${model.routerAuthorization?.status === 'enabled' ? '已启用' : '未启用'} · provider 授权 ${model.providerAuthorization?.status === 'unknown' ? '未知，目录可见不代表推理已验证' : model.providerAuthorization?.status ?? '未知'}`),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': `启用 ${model.name}`, checked: model.enabled, disabled: disabled || !model.inPool || !model.available, onChange: event => change(() => api.setModelEnabled(model.candidateId ?? model.id, event.target.checked)) }), '启用'),
        h('button', { type: 'button', disabled: disabled || !model.available, onClick: () => change(() => model.inPool ? api.removeModel(model.candidateId ?? model.id) : api.setModelEnabled(model.candidateId ?? model.id, true)) }, `${model.inPool ? '移除' : '加入模型池'} ${model.name}`),
        h('p', null, Object.entries(model.capability).map(([name, fact]) => `${({ text: '文本', image: '图像', tools: '工具' })[name]}：${fact.supported === null ? '尚未确认' : fact.supported ? '支持' : '不支持'}（${confidence(fact.confidence)}）`).join(' · ')),
        h('p', null, `兼容性：${confidence(model.compatibility.confidence)}，范围为 ${model.compatibility.scope}；不代表未验证的真实服务权限或效果。`))));
      const routing = () => h('div', null,
        h('h3', null, '路由与预算'),
        h('p', null, `自动路由：${state.config.automatic ? '已启用' : '已暂停；原生模型选择仍可用'}`),
        h('button', { type: 'button', disabled, onClick: () => change(() => api.setAutomatic(!state.config.automatic)) }, state.config.automatic ? '暂停自动路由' : '启用自动路由'),
        h('label', null, '路由目标 ', h('select', { 'aria-label': '路由目标', value: state.config.routingObjective, disabled, onChange: event => change(() => api.setRoutingObjective(event.target.value)) }, ...['balanced', 'cost', 'tokens', 'speed', 'quality'].map(value => h('option', { key: value, value }, objectiveName(value))))),
        h('label', null, h('input', { type: 'checkbox', 'aria-label': '允许有界语义判断', checked: state.config.semanticAssessment, disabled, onChange: event => change(() => api.setSemanticAssessment(event.target.checked)) }), '允许有界语义判断'),
        h('p', null, '语义判断默认关闭；开启许可后可为下一个任务明确请求一次判断，使用同一任务预算且限制输入与输出。'),
        h('button', { type: 'button', disabled: disabled || !state.config.automatic || !state.config.semanticAssessment || state.semanticAssessmentRequest?.status === 'armed', onClick: () => change(() => api.requestSemanticAssessment()) }, state.semanticAssessmentRequest?.status === 'armed' ? '下一个任务判断已准备' : '下一个任务使用判断'),
        h('button', { type: 'button', disabled, onClick: () => change(() => api.previewCalibrationBudget()) }, '查看校准预算'),
        state.calibrationPreview ? h('p', null, `校准预算预览：${state.calibrationPreview.budgetEstimate.calls} 次调用 · ${state.calibrationPreview.budgetEstimate.totalTokens} token${state.calibrationPreview.budgetEstimate.unknownPriceCandidates ? ` · ${state.calibrationPreview.budgetEstimate.unknownPriceCandidates} 个候选价格未知` : ''}。尚未授权，未发送校准调用。`) : h('p', null, '校准默认关闭；查看预算不会发送模型调用。'),
        h('label', null, '固定执行模型 ', h('select', { 'aria-label': '固定执行模型', value: state.config.fixedCandidateId ?? state.config.fixedModel ?? '', disabled, onChange: event => change(() => api.setFixedModel(event.target.value || null)) },
          h('option', { value: '' }, '自动选择已启用模型'), ...state.models.map(model => h('option', { key: model.candidateId ?? model.id, value: model.candidateId ?? model.id, disabled: !model.enabled || !model.available }, `${model.name}${model.enabled && model.available ? '' : '（不可用）'}`)))),
        h('button', { type: 'button', disabled: disabled || !(state.config.fixedCandidateId ?? state.config.fixedModel), onClick: () => change(() => api.setFixedModel(null)) }, '解除固定'),
        h('p', null, '固定时不自动更换执行模型。与原生待执行选择冲突时暂停并保留手动意图。暂停自动路由后保留设置，使用有效的原生选择。'),
        h('p', null, 'Router 受控连接仅生成本地测试响应；主动启用的 DSH 原生连接会使用其宿主 provider。参考报价由公开设置命令保存，不代表官方价格或实际账单。'),
        h(BudgetEditor, { budget: state.config.budget, disabled, save: budget => change(() => api.setBudgetDefaults(budget)) }),
        h(AcceptancePolicyEditor, { state, disabled, save: policy => change(() => api.setAcceptancePolicy(policy)) }),
        ...state.tasks.filter(task => ['running', 'waiting-budget'].includes(task.lifecycle)).map(task => h('article', { key: task.id }, h('strong', null, task.id), h(RoutingDecision, { task }), h(TaskLedger, { task }), h(TaskBudget, { task, disabled, change, api }))));
      const history = () => h('div', null, h('h3', null, '任务记录'), state.tasks.length === 0 ? h('p', null, '尚无任务。') : h('ol', null, ...state.tasks.slice(-20).reverse().map(task => h('li', { key: task.id, style: { padding: '12px 0', whiteSpace: 'pre-wrap' } },
        h('strong', null, `${task.activeSelection?.provider ?? '尚未选择'}/${task.activeSelection?.model ?? '—'}`),
        h('p', null, `${task.lifecycle === 'completed' ? '响应完成' : task.lifecycle === 'paused' ? '任务暂停' : task.lifecycle === 'waiting-budget' ? '预算等待' : '执行中'}${task.pauseReason ? ` · ${reasons[task.pauseReason] ?? task.pauseReason}` : ''}`),
        h(AcceptanceResult, { task }),
        h('p', null, task.result || '尚无输出'), h('small', null, `有效配置 ${task.configVersion} · ${task.id}`),
        h(RoutingDecision, { task }), h(TaskLedger, { task }), h(TaskBudget, { task, disabled, change, api }),
        h('details', null, h('summary', null, '选择与结果记录'), h('pre', null, JSON.stringify(task.timeline, null, 2)))))));
      return h('section', { style: { maxWidth: 720, display: 'grid', gap: 16 } },
        h('h2', null, 'DSH Router'),
        h('p', null, '启用模型池和自动路由后发送 Reply ROUTER_OK。暂停后可在原生会话模型菜单选择仍有效的模型。'),
        h('nav', { 'aria-label': 'Router 设置' }, ...['连接与模型', 'DeepSeek API', '路由与预算', '任务记录'].map(label => h('button', { key: label, type: 'button', 'aria-pressed': page === label, onClick: () => setPage(label) }, label))),
        error ? h('p', { role: 'alert' }, error) : null,
        !state ? h('p', null, '加载中…') : h(React.Fragment, null,
          h('p', { role: 'status' }, `期望配置 ${state.config.version} · ${state.application?.status === 'pending' ? '待生效：下一稳定请求应用' : '已生效'}`),
          ...(state.application?.active ?? []).map(task => h('p', { key: task.taskId }, `当前任务有效配置 ${task.appliedVersion} · 期望配置 ${task.desiredVersion}`)),
          state.storageError ? h('p', { role: 'alert' }, state.storageError) : null,
          ...(state.blockedRequests ?? []).slice(-5).map((request, index) => h('p', { key: `${request.at}:${index}`, role: 'status' }, `辅助请求 ${request.nativePurpose} ${request.reason === 'AUXILIARY_LIFECYCLE_UNAVAILABLE' ? '缺少可观察的流生命周期' : '无法安全关联活动任务'}，尚未发送：${request.reason}`)),
          h('button', { type: 'button', onClick: refresh }, '刷新任务记录'),
          page === '连接与模型' ? pool() : page === 'DeepSeek API' ? h(DeepSeekSettings, { service: deepSeekService(api), routerApi: deepSeekRouterApi(api) }) : page === '路由与预算' ? routing() : history()));
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
