# 结论：BLOCK

## Findings

- **P1 — `src/chatgpt-client.mjs:57`：目标 Desktop 无法启动 OAuth。** 规格要求“处理系统浏览器、state/nonce、PKCE、回调、取消和超时”，契约进一步要求“监听仅绑定 `127.0.0.1`，启动成功后才打开系统浏览器”。在 0.2.0-rc.2 主窗口点击 `Continue with ChatGPT` 时，代码先执行 `window.open('about:blank')`；目标宿主 `main.js:11109-11112` 只把直接 HTTP(S) URL 交给 `shell.openExternal`，并拒绝 popup。因而 `about:blank` 不会打开系统浏览器，返回空值后函数在调用 `startAuthorization()` 前退出；授权、回调和后续模型选择均不可达。修复方向：先取得一次性 URL，严格校验 `https://auth.openai.com/api/accounts/authorize`，再直接 `window.open(url, '_blank', 'noopener,noreferrer')`；宿主返回 `null` 是外部打开后拒绝 Electron popup 的正常结果，不应据此取消流程。

## 需求符合度

除上述阻断外，冻结 diff 已覆盖动态注册、issued client/稳定 host、PKCE/OIDC 校验、同账号目录、官方 Responses、统一 Call 预算/派发、两次请求上限及未知用量保留；未发现越界实现。目标桌面真实授权→返回→选择→完整请求尚未执行，不能宣布该 AC 通过。

## 测试与验证缺口

`test/client-harness.mjs:13-19` 自制可导航 popup，掩盖了目标宿主的 deny + `shell.openExternal` 语义。需加入与 `main.js:11109-11112` 一致的测试：直接官方 URL、`window.open` 返回 `null`、授权仍保持 waiting/可取消；另覆盖非官方 URL 不打开并取消。

## 剩余风险

修复后仍需按已批准上限完成目标 Desktop 的一次真实 Task、最多两次模型请求验收；本次未执行真实 OAuth 或模型网络。
