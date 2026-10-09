export function createOpenCodeGoSettingsComponent(React) {
  const h = React.createElement;
  return function OpenCodeGoSettings({ api, valueOf }) {
    const [state, setState] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [balanceDisabled, setBalanceDisabled] = React.useState(false);
    const key = React.useRef('');
    const input = React.useRef(null);
    const refresh = async () => setState(valueOf(await api.snapshot()));
    React.useEffect(() => { void refresh().catch(() => setError('无法读取 Go 连接。')); }, []);
    const change = async action => {
      setBusy(true);
      try { valueOf(await action()); await refresh(); setError(''); }
      catch { setError('操作未完成；请检查连接状态。密钥不会显示在错误详情中。'); }
      finally { setBusy(false); }
    };
    const go = state?.openCodeGo;
    const candidate = state?.models.find(item => item.source === 'opencode-go' && item.accountId === go?.accountId);
    return h('section', null,
      h('h3', null, 'OpenCode Go'),
      h('p', null, '使用已有 Go 套餐连接 GPT 6 Luna。套餐剩余额度和实际账单保持未知；目录声明不等于已验证可调用。'),
      h('p', null, '请在 OpenCode 控制台关闭 Use balance，避免套餐额度耗尽后扣除 Zen 余额。本连接只使用 Go 接口。'),
      h('label', null, 'Go API key ', h('input', { type: 'password', autoComplete: 'off', 'aria-label': 'Go API key', disabled: busy || go?.configured, ref: input, onChange: event => { key.current = event.target.value; } })),
      h('button', { type: 'button', disabled: busy || go?.configured, onClick: () => { const apiKey = key.current; key.current = ''; if (input.current) input.current.value = ''; return change(() => api.openCodeGoSaveCredential({ apiKey })); } }, '保存 Go 密钥'),
      h('button', { type: 'button', disabled: busy || !go?.configured || go?.connected, onClick: () => change(() => api.openCodeGoConnect()) }, '连接 Go'),
      h('button', { type: 'button', disabled: busy || !go?.connected, onClick: () => change(() => api.openCodeGoDisconnect({ deleteCredential: false })) }, '断开 Go 并保留密钥'),
      h('button', { type: 'button', disabled: busy || !go?.configured, onClick: () => change(() => api.openCodeGoDisconnect({ deleteCredential: true })) }, '断开 Go 并删除密钥'),
      error ? h('p', { role: 'alert' }, error) : null,
      h('p', { role: 'status' }, go?.connected ? 'Go 已连接，是否能完成推理以任务记录为准。' : 'Go 尚未连接。'),
      candidate ? h('button', { type: 'button', disabled: busy || !candidate.available || candidate.enabled, onClick: () => change(() => api.setModelEnabled(candidate.candidateId, true)) }, '启用 Go GPT 6 Luna') : null,
      h('label', null, h('input', { type: 'checkbox', checked: balanceDisabled, disabled: busy, 'aria-label': '已关闭 Go Use balance', onChange: event => setBalanceDisabled(event.target.checked) }), '我已在 OpenCode 控制台关闭 Use balance'),
      h('p', null, '检测将消耗 Go 套餐额度：最多1个任务、2次请求（含可能的标题），32768 token预算、60秒总时限，每次最多1024输出token，无自动重试。检测记录在任务记录页显示；用量未知时不当作零。'),
      h('button', { type: 'button', disabled: busy || !balanceDisabled || !candidate?.available || !candidate?.enabled || go?.detectionClaimed, onClick: () => change(() => api.openCodeGoRunDetection({ candidateId: candidate.candidateId, useBalanceDisabled: true, budget: { tokens: 32768, durationMs: 60000 } })) }, go?.detectionClaimed ? '本次 Go 检测已使用' : '运行有界 Go 检测'),
      go?.lastDetectionTaskId ? h('p', null, `检测任务：${go.lastDetectionTaskId}；详情见任务记录。`) : null);
  };
}
