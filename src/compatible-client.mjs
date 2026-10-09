export function createCompatibleSettingsComponent(React) {
  const h = React.createElement;
  return function CompatibleSettings({ api, valueOf }) {
    const [state, setState] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const [draft, setDraft] = React.useState({ name: '兼容连接', endpoint: 'https://opencode.ai/zen/go/v1', model: 'gpt-6-luna', tools: true });
    const [balanceDisabled, setBalanceDisabled] = React.useState(false);
    const [price, setPrice] = React.useState({ source: '', date: '', currency: 'USD', input: '', output: '' });
    const key = React.useRef(''), keyInput = React.useRef(null);
    const refresh = async () => setState(valueOf(await api.snapshot()));
    React.useEffect(() => { void refresh().catch(() => setError('无法读取兼容连接。')); }, []);
    const change = async action => { setBusy(true); try { valueOf(await action()); await refresh(); setError(''); } catch { setError('操作未完成。请检查地址、模型和连接状态；密钥不会出现在错误详情中。'); } finally { setBusy(false); } };
    const field = (label, value, update, props = {}) => h('label', { style: { display: 'block' } }, label, h('input', { 'aria-label': label, value, onChange: event => update(event.target.value), disabled: busy, ...props }));
    return h('section', null,
      h('h3', null, '自定义兼容连接'),
      h('p', null, '本版支持 Responses SSE 文本协议和已声明的函数工具。图像、Chat Completions、采样参数暂不支持；目录发现和连接不等于推理已验证。'),
      h('p', null, '填写 API 基础地址，不含 /responses、/models 或密钥。仅支持公共 HTTPS 服务；本地地址用于受控测试。与官方 API、ChatGPT OAuth、OpenCode Go 连接分别保存。'),
      ...[['名称', 'name'], ['API 基础地址', 'endpoint'], ['模型 ID', 'model']].map(([label, property]) => field(label, draft[property], value => setDraft(current => ({ ...current, [property]: value })))),
      h('label', null, h('input', { type: 'checkbox', 'aria-label': '声明支持函数工具', checked: draft.tools, disabled: busy, onChange: event => setDraft(current => ({ ...current, tools: event.target.checked })) }), '声明支持函数工具（声明不等于实测）'),
      h('label', null, '兼容连接 Key', h('input', { type: 'password', autoComplete: 'off', 'aria-label': '兼容连接 Key', ref: keyInput, disabled: busy, onChange: event => { key.current = event.target.value; } })),
      h('button', { disabled: busy, type: 'button', onClick: () => { const apiKey = key.current; key.current = ''; if (keyInput.current) keyInput.current.value = ''; return change(() => api.compatibleAdd({ ...draft, apiKey })); } }, '保存兼容连接'),
      error ? h('p', { role: 'alert' }, error) : null,
      h('p', null, '正常任务须先在路由与预算设置有限 token 和耗时上限，每次输出最多1024token。检测消耗来源额度：每条连接最多1个任务、2次请求含标题，32768token/60秒，无自动重试或扩额。'),
      h('label', null, h('input', { type: 'checkbox', 'aria-label': '兼容 Go 已关闭 Use balance', checked: balanceDisabled, onChange: event => setBalanceDisabled(event.target.checked), disabled: busy }), '使用 Go 地址时，我已在 OpenCode 控制台关闭 Use balance'),
      ...(state?.compatible?.entries ?? []).map(entry => {
        const candidate = state.models.find(item => item.source === 'openai-compatible' && item.connectionId === entry.id);
        const go = entry.endpoint === 'https://opencode.ai/zen/go/v1';
        return h('fieldset', { key: entry.id, disabled: busy }, h('legend', null, entry.name + ' · ' + entry.model),
          h('p', null, `${entry.endpoint} · ${entry.connected ? '已连接' : '未连接'} · 推理${candidate?.inferenceVerification.status === 'verified' ? '已验证' : '未验证'} · 图像不支持 · 账单及套餐额度未知`),
          h('button', { type: 'button', disabled: !entry.configured || entry.connected, onClick: () => change(() => api.compatibleConnect({ id: entry.id })) }, `连接 ${entry.id}`),
          h('button', { type: 'button', disabled: !entry.configured, onClick: () => change(() => api.compatibleDiscover({ id: entry.id })) }, `发现模型 ${entry.id}`),
          entry.catalog.status === 'listed' ? h('p', null, `目录（不认证能力/推理权限）：${entry.catalog.models.join('、') || '空'}`) : entry.catalog.status === 'error' ? h('p', null, `目录不可用：${entry.catalog.failureCode}；可继续使用手动模型 ID。`) : null,
          h('button', { type: 'button', disabled: !candidate?.available || candidate.enabled, onClick: () => change(() => api.setModelEnabled(candidate.candidateId, true)) }, `启用 ${entry.id}`),
          h('button', { type: 'button', disabled: !candidate?.available || !candidate.enabled || entry.detectionClaimed || (go && !balanceDisabled), onClick: () => change(() => api.compatibleRunDetection({ candidateId: candidate.candidateId, useBalanceDisabled: go ? balanceDisabled : false, budget: { tokens: 32768, durationMs: 60000 } })) }, entry.detectionClaimed ? `检测已使用 ${entry.id}` : `运行有界检测 ${entry.id}`),
          h('button', { type: 'button', disabled: !entry.connected, onClick: () => change(() => api.compatibleDisconnect({ id: entry.id, deleteCredential: false })) }, `断开 ${entry.id}`),
          h('button', { type: 'button', disabled: !entry.configured, onClick: () => change(() => api.compatibleDisconnect({ id: entry.id, deleteCredential: true })) }, `删除密钥 ${entry.id}`),
          h('details', null, h('summary', null, '参考费率（估算，非实际账单）'),
            ...[['来源 URL', 'source'], ['报价日期', 'date'], ['币种', 'currency'], ['每百万普通输入', 'input'], ['每百万输出', 'output']].map(([label, property]) => field(label, price[property], value => setPrice(current => ({ ...current, [property]: value })), property === 'date' ? { type: 'date' } : ['input', 'output'].includes(property) ? { type: 'number', min: 0, step: 'any' } : {})),
            h('p', null, '缓存及推理费率未知；未返回完整计价分区时保持总费用未知。此费率不会被当作已确认的账单或 Go 套餐扣减。'),
            h('button', { type: 'button', disabled: !candidate || !price.source || !price.date || price.input === '' || price.output === '', onClick: () => change(() => api.setPriceQuote(candidate.candidateId, { source: price.source, date: price.date, currency: price.currency, kind: 'api-calculated', confidence: 'declared', perMillion: { input: Number(price.input), output: Number(price.output) }, reasoning: 'unknown' })) }, `保存参考费率 ${entry.id}`),
            h('button', { type: 'button', disabled: !candidate, onClick: () => change(() => api.setPriceQuote(candidate.candidateId, null)) }, `清除参考费率 ${entry.id}`)));
      }));
  };
}
