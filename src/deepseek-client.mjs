import React from 'react';

const h = React.createElement;

function candidateLabel(candidate) {
  return `${candidate.name ?? candidate.model} (${candidate.model})`;
}

export function DeepSeekSettings({ service, routerApi }) {
  const [state, setState] = React.useState(null);
  const [router, setRouter] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [candidateId, setCandidateId] = React.useState('');
  const [tokens, setTokens] = React.useState('256');
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
    h('p', null, '凭据 binding、provider 连接和 Router candidate 启用是三个独立动作。保存 key 不会自动连接或授权模型执行。'),
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
    }, '保存新的凭据 binding'),
    h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.discoverCatalog()) }, '获取公开模型目录'),
    h('p', null, '公开目录 GET 不携带凭据，只说明服务列出的模型；不代表认证、能力或推理已验证。'),
    error ? h('p', { role: 'alert' }, error) : null,
    !state || !router ? h('p', null, '加载中…') : h(React.Fragment, null,
      h('h4', null, '公开目录'),
      state.catalog.status === 'not-requested' ? h('p', null, '尚未读取公开目录。') : null,
      ...state.catalog.models.map(model => h('p', { key: model.id }, `${model.name} · ${model.id} · 仅目录声明`)),
      ...state.catalog.unrecognizedModelIds.map(model => h('p', { key: model, role: 'status' }, `${model} · 未进入可调用 allowlist`)),
      h('h4', null, '凭据 bindings'),
      state.bindings.length === 0 ? h('p', null, '尚未保存 DeepSeek 凭据。') : null,
      ...state.bindings.map(binding => h('article', { key: binding.accountId },
        h('strong', null, binding.accountId),
        h('p', null, binding.configured ? '凭据已配置' : '凭据未配置'),
        h('button', { type: 'button', disabled: busy || !binding.configured, onClick: () => change(() => service.connect({ accountId: binding.accountId })) }, `连接 ${binding.accountId}`))),
      h('h4', null, '连接'),
      state.connections.length === 0 ? h('p', null, '尚无 Router 自有 DeepSeek 连接。') : null,
      ...state.connections.map(connection => h('article', { key: connection.connectionId },
        h('strong', null, connection.connectionId),
        h('p', null, `${connection.accountId} · ${connection.provider}`),
        h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ connectionId: connection.connectionId, deleteCredential: false })) }, `断开并保留凭据 ${connection.connectionId}`),
        h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ connectionId: connection.connectionId, deleteCredential: true })) }, `断开并删除凭据 ${connection.connectionId}`))),
      h('h4', null, 'Router candidates'),
      candidates.length === 0 ? h('p', null, '连接后才会出现候选；候选仍保持未启用。') : null,
      ...candidates.map(candidate => h('article', { key: candidate.candidateId },
        h('strong', null, candidateLabel(candidate)),
        h('p', null, `${candidate.available ? '可用' : '已断开'} · ${candidate.enabled ? '已启用' : '未启用'}`),
        h('button', {
          type: 'button',
          disabled: busy || !candidate.available || candidate.enabled,
          onClick: () => change(() => routerApi.setModelEnabled(candidate.candidateId, true)),
        }, `启用 ${candidate.name ?? candidate.model}`))),
      h('h4', null, '有限预算连接检测'),
      h('p', null, '检测会创建可见的 Router Task 并逐 Call 记账。当前无已确认价格时费用保持未知，不能按零处理。'),
      h('label', null, '检测模型 ', h('select', {
        'aria-label': '检测模型',
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
        h('strong', null, detection.taskId),
        h('p', null, `${detection.lifecycle} · ${detection.result}`),
        h('p', null, `记账调用 ${detection.ledger.callCount} · token ${detection.ledger.tokens.total ?? '未知'}`),
        detection.ledger.unknownPriceCalls ? h('p', null, `费用未知：${detection.ledger.unknownPriceCalls} 个调用缺少价格。`) : null) : null));
}

/** Independent slot entry; the shared facade supplies callbacks during final wiring. */
export function createDeepSeekSettingsPlugin(service, routerApi) {
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
