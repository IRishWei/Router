function chatGptCandidateLabel(candidate) {
  return `${candidate.name ?? candidate.model} (${candidate.model}) · 连接 ${candidate.connectionId} · 账号 ${candidate.accountId} · 计费 ${candidate.billingPath}`;
}

export function createChatGptSettingsComponent(React) {
  const h = React.createElement;
  return function ChatGptSettings({ service, routerApi }) {
    const [state, setState] = React.useState(null);
    const [router, setRouter] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [candidateId, setCandidateId] = React.useState('');
    const [tokens, setTokens] = React.useState('8192');
    const [durationMs, setDurationMs] = React.useState('60000');
    const [detection, setDetection] = React.useState(null);
    const authorizationURL = React.useRef(null);
    const [authorizationLinkReady, setAuthorizationLinkReady] = React.useState(false);
    const refresh = async () => {
      const [nextState, nextRouter] = await Promise.all([service.snapshot(), routerApi.snapshot()]);
      setState(nextState);
      setRouter(nextRouter);
      return { nextState, nextRouter };
    };
    React.useEffect(() => { void refresh().catch(() => setError('无法读取 ChatGPT OAuth 设置。')); }, []);
    React.useEffect(() => {
      if (state?.authorization?.status !== 'waiting') return undefined;
      let active = true;
      let timer;
      const poll = () => {
        timer = setTimeout(async () => {
          if (!active) return;
          try {
            const { nextState } = await refresh();
            if (active && nextState.authorization?.status === 'waiting') poll();
          } catch { setError('无法刷新 ChatGPT OAuth 状态。'); }
        }, 500);
      };
      poll();
      return () => { active = false; clearTimeout(timer); };
    }, [state?.authorization?.status, state?.authorization?.attemptId]);
    React.useEffect(() => {
      if (state?.authorization?.status === 'waiting') return undefined;
      authorizationURL.current = null;
      if (authorizationLinkReady) setAuthorizationLinkReady(false);
      return undefined;
    }, [state?.authorization?.status, authorizationLinkReady]);
    React.useEffect(() => () => { authorizationURL.current = null; }, []);
    const candidates = (router?.models ?? []).filter(model => model.source === 'openai-chatgpt-oauth');
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
        setError('操作失败；凭据和授权详情未写入页面状态或错误信息。');
        return undefined;
      } finally { setBusy(false); }
    };
    const authorize = async () => {
      const result = await change(() => service.startAuthorization());
      if (!result) return;
      let url;
      try {
        url = new URL(result.authorizationURL);
        if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.pathname !== '/api/accounts/authorize' || url.username || url.password || url.hash) throw new Error('invalid authorization URL');
      } catch {
        await change(() => service.cancelAuthorization());
        setError('Host 返回了无效的官方授权地址；本次授权已取消。');
        return;
      }
      authorizationURL.current = url.href;
      setAuthorizationLinkReady(true);
      try { window.open(url.href, '_blank', 'noopener,noreferrer'); }
      catch {
        setError('未能自动打开系统浏览器；请点击“打开官方授权页”重试。');
      }
    };
    const openAuthorization = () => {
      if (!authorizationURL.current) return;
      try { window.open(authorizationURL.current, '_blank', 'noopener,noreferrer'); setError(''); }
      catch { setError('系统浏览器仍未打开；授权保持等待，可重试或取消。'); }
    };
    const cancelAuthorization = async () => {
      authorizationURL.current = null;
      setAuthorizationLinkReady(false);
      await change(() => service.cancelAuthorization());
    };
    const budget = { tokens: Number(tokens), durationMs: Number(durationMs) };
    const validBudget = Number.isSafeInteger(budget.tokens) && budget.tokens > 0 && budget.tokens <= 65_536
      && Number.isSafeInteger(budget.durationMs) && budget.durationMs > 0 && budget.durationMs <= 120_000;
    return h('section', { style: { display: 'grid', gap: 12 } },
      h('h3', null, 'ChatGPT OAuth'),
      h('p', null, '使用 DSH Router 自己的官方开源应用授权。不会读取或复用 Codex 登录，也不需要 OpenAI API Key。'),
      h('button', { type: 'button', disabled: busy || state?.authorization?.status === 'waiting', onClick: authorize }, 'Continue with ChatGPT'),
      state?.authorization?.status === 'waiting' && authorizationLinkReady ? h('button', { type: 'button', disabled: busy, onClick: openAuthorization }, '打开官方授权页') : null,
      state?.authorization?.status === 'waiting' ? h('button', { type: 'button', disabled: busy, onClick: cancelAuthorization }, '取消 ChatGPT 授权') : null,
      error ? h('p', { role: 'alert' }, error) : null,
      !state || !router ? h('p', null, '加载中…') : h(React.Fragment, null,
        h('p', { role: 'status' }, `授权状态：${state.authorization.status}${state.authorization.failureCode ? ` · ${state.authorization.failureCode}` : ''}`),
        h('p', null, state.account ? `账号 ${state.account.accountId} · ${state.account.directUseEnabled ? 'ChatGPT 套餐使用已授权' : '身份已登录，但套餐使用未授权'}` : '尚未登录 ChatGPT。'),
        h('p', null, `模型目录：${state.catalog.status} · ${state.catalog.models.length} 个可见模型。目录可见不表示推理已验证。`),
        state.account && !state.connection ? h('button', { type: 'button', disabled: busy || !state.account.directUseEnabled || !state.catalog.models.length, onClick: () => change(() => service.connect()) }, '连接已保存的 ChatGPT 账号') : null,
        state.connection ? h(React.Fragment, null,
          h('p', null, `${state.connection.connectionId} · ${state.connection.available ? '连接可用' : '连接未挂载'}`),
          h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ deleteCredential: false })) }, '断开连接并保留 ChatGPT 登录'),
          h('button', { type: 'button', disabled: busy, onClick: () => change(() => service.disconnect({ deleteCredential: true })) }, '断开并删除 ChatGPT 登录')) : null,
        h('h4', null, '账号模型'),
        ...state.catalog.models.map(model => h('p', { key: model.slug }, `${model.displayName} · ${model.slug} · 当前账号目录可见`)),
        candidates.length === 0 ? h('p', null, '完成授权和连接后才会出现候选；候选默认不参与任务。') : null,
        ...candidates.map(candidate => h('article', { key: candidate.candidateId },
          h('strong', null, chatGptCandidateLabel(candidate)),
          h('p', null, `${candidate.available ? '连接可用' : '连接不可用'} · ${candidate.enabled ? '可参与任务' : '尚未加入'} · 推理 ${state.inference[candidate.model]?.status ?? 'unknown'}`),
          h('button', { type: 'button', disabled: busy || !candidate.available || candidate.enabled, onClick: () => change(() => routerApi.setModelEnabled(candidate.candidateId, true)) }, `加入模型选择 ${candidate.name ?? candidate.model}`))),
        h('h4', null, '一次有界真实验收'),
        h('p', null, '最多创建 1 个 Router Task、最多派发 2 次模型请求（包含标题或工具后续步骤）。官方当前不提供服务端输出 token 硬上限；此处使用完整输入预留、调用次数和绝对时限控制。'),
        h('label', null, '验收模型与账号 ', h('select', { 'aria-label': 'ChatGPT 验收模型与账号', value: selected?.candidateId ?? '', disabled: busy || !candidates.length, onChange: event => setCandidateId(event.target.value) }, h('option', { value: '' }, '请选择'), ...candidates.map(candidate => h('option', { key: candidate.candidateId, value: candidate.candidateId }, chatGptCandidateLabel(candidate))))),
        h('label', null, '验收 token 预留 ', h('input', { type: 'number', min: 1, max: 65536, step: 1, 'aria-label': 'ChatGPT 验收 token 预留', value: tokens, disabled: busy, onChange: event => setTokens(event.target.value) })),
        h('label', null, '验收绝对时限（毫秒） ', h('input', { type: 'number', min: 1, max: 120000, step: 1, 'aria-label': 'ChatGPT 验收绝对时限（毫秒）', value: durationMs, disabled: busy, onChange: event => setDurationMs(event.target.value) })),
        h('button', { type: 'button', disabled: busy || Boolean(state.lastDetectionTaskId) || !selected?.available || !selected?.enabled || !validBudget, onClick: async () => {
          const result = await change(() => service.runDetection({ candidateId: selected.candidateId, budget }));
          if (result) setDetection(result);
        } }, '运行 ChatGPT 有界验收'),
        state.lastDetectionTaskId && !detection ? h('p', null, `本账号的有界验收 Task 已创建：${state.lastDetectionTaskId}`) : null,
        detection ? h('article', null,
          h('strong', null, `验收记录 ${detection.taskId}`),
          h('p', null, `${detection.lifecycle} · ${detection.result}`),
          h('p', null, `请求 ${detection.ledger.callCount}/2 · token ${detection.ledger.tokens.total ?? '未知'} · 订阅现金费用未知`)) : null));
  };
}
