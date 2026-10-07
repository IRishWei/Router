function candidateLabel(candidate) {
  return `${candidate.name ?? candidate.model} (${candidate.model}) · 连接 ${candidate.connectionId} · 账号 ${candidate.accountId} · 计费 ${candidate.billingPath}`;
}

export function createDeepSeekSettingsComponent(React) {
  const h = React.createElement;
  return function DeepSeekSettings({ service, routerApi }) {
  const [state, setState] = React.useState(null);
  const [router, setRouter] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [candidateId, setCandidateId] = React.useState('');
  const [tokens, setTokens] = React.useState('4096');
  const [durationMs, setDurationMs] = React.useState('30000');
  const [detection, setDetection] = React.useState(null);
  const apiKey = React.useRef('');
  const apiKeyInput = React.useRef(null);

  const refresh = async () => {
    const [nextState, nextRouter] = await Promise.all([service.snapshot(), routerApi.snapshot()]);
    setState(nextState);
    setRouter(nextRouter);
    return { nextState, nextRouter };
  };
  React.useEffect(() => { void refresh().catch(() => setError('无法读取 DeepSeek 设置。')); }, []);
  const candidates = (router?.models ?? []).filter(model => model.source === 'deepseek-official-api');
  const selected = candidates.find(model => model.candidateId === candidateId) ?? candidates[0];
  React.useEffect(() => {
    if (!candidateId && candidates[0]) setCandidateId(candidates[0].candidateId);
  }, [candidateId, candidates.map(model => model.candidateId).join('\0')]);
  const change = async action => {
    setBusy(true);
    try {
      const result = await action();
      await refresh();
      setError('');
      return result;
    } catch {
      setError('操作失败；敏感信息未写入页面状态或错误详情。');
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const detectionBudget = { tokens: Number(tokens), durationMs: Number(durationMs) };
  const validBudget = Number.isSafeInteger(detectionBudget.tokens) && detectionBudget.tokens > 0 && detectionBudget.tokens <= 4096
    && Number.isSafeInteger(detectionBudget.durationMs) && detectionBudget.durationMs > 0 && detectionBudget.durationMs <= 60_000;

  return h('section', { style: { display: 'grid', gap: 12 } },
    h('h3', null, 'DeepSeek API'),
    h('p', null, '分三步完成设置：保存账号密钥、连接账号、选择可参与任务的模型。保存密钥不会自动连接或启用模型。'),
    h('label', null, 'DeepSeek API key ', h('input', {
      type: 'password',
      autoComplete: 'off',
      'aria-label': 'DeepSeek API key',
      disabled: busy,
      ref: apiKeyInput,
      onChange: event => { apiKey.current = event.target.value; },
    })),
    h('button', {
      type: 'button',
      disabled: busy,
      onClick: () => {
        const value = apiKey.current;
        apiKey.current = '';
        if (apiKeyInput.current) apiKeyInput.current.value = '';
        return change(() => service.saveCredential({ apiKey: value }));
      },
    }, '保存账号密钥'),
    h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.discoverCatalog()) }, '获取公开模型目录'),
    h('p', null, '读取公开模型目录不会发送账号密钥。目录中出现模型，不表示账号已验证或模型已经可用。'),
    error ? h('p', { role: 'alert' }, error) : null,
    !state || !router ? h('p', null, '加载中…') : h(React.Fragment, null,
      h('h4', null, '公开目录'),
      state.catalog.status === 'not-requested' ? h('p', null, '尚未读取公开目录。') : null,
      ...state.catalog.models.map(model => h('p', { key: model.id }, `${model.name} · ${model.id} · 仅目录声明`)),
      ...state.catalog.unrecognizedModelIds.map(model => h('p', { key: model, role: 'status' }, `${model} · 当前版本暂不支持调用`)),
      h('h4', null, '账号密钥'),
      state.bindings.length === 0 ? h('p', null, '尚未保存 DeepSeek 账号密钥。') : null,
      ...state.bindings.map(binding => h('article', { key: binding.accountId },
        h('strong', null, binding.accountId),
        h('p', null, binding.configured ? '密钥已保存' : '密钥不可用'),
        h('button', { type: 'button', disabled: busy || !binding.configured, onClick: () => change(() => service.connect({ accountId: binding.accountId })) }, `连接账号 ${binding.accountId}`))),
      h('h4', null, '账号连接'),
      state.connections.length === 0 ? h('p', null, '尚未连接 DeepSeek 账号。') : null,
      ...state.connections.map(connection => h('article', { key: connection.connectionId },
        h('strong', null, connection.connectionId),
        h('p', null, `账号 ${connection.accountId}`),
        h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ connectionId: connection.connectionId, deleteCredential: false })) }, `断开连接并保留密钥 ${connection.connectionId}`),
        h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ connectionId: connection.connectionId, deleteCredential: true })) }, `断开连接并删除密钥 ${connection.connectionId}`))),
      h('h4', null, '参与模型'),
      candidates.length === 0 ? h('p', null, '连接账号后才会显示模型；你仍需选择哪些模型可以参与任务。') : null,
      ...candidates.map(candidate => h('article', { key: candidate.candidateId },
        h('strong', null, candidateLabel(candidate)),
        h('p', null, `${candidate.available ? '账号已连接' : '账号已断开'} · ${candidate.enabled ? '可参与任务' : '尚未加入'}`),
        h('button', {
          type: 'button',
          disabled: busy || !candidate.available || candidate.enabled,
          onClick: () => change(() => routerApi.setModelEnabled(candidate.candidateId, true)),
        }, `加入模型选择 ${candidate.name ?? candidate.model}`))),
      h('h4', null, '有限预算连接检测'),
      h('p', null, '检测会生成可查看的任务记录，并记录每次请求的用量。当前没有已确认价格时，费用保持未知。'),
      h('label', null, '检测模型与账号 ', h('select', {
        'aria-label': '检测模型与账号',
        value: selected?.candidateId ?? '',
        disabled: busy || candidates.length === 0,
        onChange: event => setCandidateId(event.target.value),
      }, h('option', { value: '' }, '请选择'), ...candidates.map(candidate => h('option', { key: candidate.candidateId, value: candidate.candidateId }, candidateLabel(candidate))))),
      h('label', null, '检测 token 上限 ', h('input', { type: 'number', min: 1, max: 4096, step: 1, 'aria-label': '检测 token 上限', value: tokens, disabled: busy, onChange: event => setTokens(event.target.value) })),
      h('label', null, '检测耗时上限（毫秒） ', h('input', { type: 'number', min: 1, max: 60000, step: 1, 'aria-label': '检测耗时上限（毫秒）', value: durationMs, disabled: busy, onChange: event => setDurationMs(event.target.value) })),
      h('button', {
        type: 'button',
        disabled: busy || !selected || !selected.available || !selected.enabled || !validBudget,
        onClick: async () => {
          const result = await change(() => service.runDetection({ candidateId: selected.candidateId, budget: detectionBudget }));
          if (result) setDetection(result);
        },
      }, '运行有限预算检测'),
      detection ? h('article', null,
        h('strong', null, `检测记录 ${detection.taskId}`),
        h('p', null, `${detection.lifecycle === 'completed' ? '已完成' : detection.lifecycle === 'waiting-budget' ? '等待增加预算；请求尚未发送' : '已暂停'} · ${detection.result}`),
        h('p', null, `请求 ${detection.ledger.callCount} 次 · token ${detection.ledger.tokens.total ?? '未知'}`),
        detection.ledger.unknownPriceCalls ? h('p', null, `费用未知：${detection.ledger.unknownPriceCalls} 个调用缺少价格。`) : null) : null));
  };
}

export function createDeepSeekSettingsPlugin(React, service, routerApi) {
  const DeepSeekSettings = createDeepSeekSettingsComponent(React);
  return {
    inject: ['slots'],
    apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'router-deepseek',
        order: 46,
        label: () => 'DeepSeek API',
        inject: () => ({ service, routerApi }),
      }, DeepSeekSettings));
    },
  };
}
