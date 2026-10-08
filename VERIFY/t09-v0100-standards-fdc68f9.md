# 结论：BLOCK

## Findings

1. **P1｜硬性违反** — `src/chatgpt-client.mjs:56-63`。在目标 rc.2 点击授权时，代码先执行 `window.open('about:blank')`；目标宿主 `main.js:11109-11112` 对弹窗一律 deny，仅当本次 URL 为 HTTP(S) 时才 `shell.openExternal`，因此返回 `null`，随后在第58-60行退出，连授权 RPC 都不会调用。违反 `docs/implementation/t09-chatgpt-oauth-contract.md:9`“监听启动成功后打开系统浏览器”和 `t09-acceptance-entrypoints-20261008-a83c4d1e.md` §1 的目标入口约束。应先启动授权，再将严格校验过的官方 URL 直接传给 `window.open(url, '_blank', 'noopener,noreferrer')`，并把宿主 deny/返回 null 视为正常外部打开语义。测试缺口：`test/client-harness.mjs:13-19` 为 `about:blank` 返回可导航 popup，未模拟 Electron handler。

2. **P2｜硬性违反** — `src/chatgpt-host.mjs:184-188,230-239,255-269`、`src/chatgpt-client.mjs:95`。推理实测只按 `model` slug 持久化；“删除 ChatGPT 登录”不清除该映射。账号 A 验证 `shared` 后删除凭据，再授权账号 B 的同名模型，页面仍显示 B 已验证。违反 `GLOSSARY.md:11-13`、`docs/implementation/ticket-contracts.md:14,28,46-47` 的完整候选身份及验证隔离规则。应按 candidateId/完整五元身份记录，或在身份替换时清除旧验证。缺少“账号 A→删除→账号 B 同 slug”回归测试。

3. **P3｜判断项：Duplicated Code** — `src/source-network.mjs:281-319` 与 `:460-495` 重复代理发现、DNS、地址授权及 DoH 回退；`:322-346` 又重复 `:189-211` 的直连固定/CONNECT agent 构造。典型重复片段为 `nativeAddresses ... find(authorized) ... proxyResolver(...)`。应让 reader 与 transport 共用 `routeFor` 及连接工厂，分别适配 throw/result 形态，避免网络安全修复双处漂移。

## 需求符合度

除上述问题外，未发现 AGENTS、领域术语/ADR 或冻结范围的其他标准违例；未见 Codex 配置/认证读取或 Computer Use。

## 测试与验证缺口

窄测 `node --test test/t09.client.test.mjs test/t09.host.test.mjs test/t09.network.test.mjs`：11/11 通过，但未覆盖目标 `setWindowOpenHandler` 和跨账号同名候选。

## 剩余风险

按约束未启动 Desktop、未执行真实 OAuth/网络模型；受控测试不能证明实际账号资格。
