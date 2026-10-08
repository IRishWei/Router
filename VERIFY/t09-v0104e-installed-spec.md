# 结论：BLOCK（T09 实际验收）；流程与保全 PASS

## Findings

- **P1 — 目标真实请求仍未完成。** 规格要求“目标桌面一次授权→返回→选择→完整请求可复现”（`docs/planning/dsh-router-v1/tickets/09-chatgpt-sign-in-task.md:18`）。Task `eefbe023-a0a9-4320-85c3-a5817bdfa41e` 的 detection 与 session-title 两次真实派发均以 `INVALID_RESPONSE` 失败（`t09-v0104e-real-task-evidence.json:276467-276501,276659-276697`）；原生记录显示 HTTP 200 但固定分类为 `content type: missing`（`t09-v0104e-native-session-decoded.json:1093,1121`）。Task 为 paused/unconfirmed，未出现 `response.completed`。影响：AC4 不成立，T09 保持 OPEN、9/24。修复方向：离线定位目标返回缺少 SSE content type 的原因；后续仅能在新的明确人类授权下新建验收 Task，不得续跑或替换本 Task。测试缺口：同一真实桌面链路尚无成功完整响应。

## 需求符合度

- 新授权文件 641 B、SHA `86B76B…6D695F`；UTF-8“确认”的 SHA 独立复算为 `36F33A…E09AE`，授权时间、0.10.4、1 Task/2 requests、65536/120000、forecast 2048、无硬输出上限/扩限/重试/刷新/API fallback 均匹配（授权文件 `:4-21`）。marker 仅应用既审 claim 轮换。
- 登录后保持相同 account、issued client、connection，发现 7 个模型且授权 URL 未持久化；Task 在登录完成后 634 ms 启动。两次 Call 均使用同一 subscription/provider/account，恰好 2 次实际派发，无第三次请求。
- Task budget 为 65536 tokens/120000 ms、extensions `[]`、maxCalls 2、forecast 2048；ledger `callCount=2`、所有 token usage 为 unknown、known 为 0、unknownPriceCalls=2，未把未知用量冒充零。
- 旧 232 Tasks/539 Calls 逐项保留；新 Task/2 Calls 在 restore、before-restart、restart 间逐项相同。恢复后为 233/541/config 578，claim 指向新 Task；账号、连接、catalog/inference、DeepSeek 配置和 native default（仅忽略派生 schema）跨重启保持，连接仍 available。重启证据标记 `PRESERVED`（`:276312-276322`）。
- 0.10.4 的 29 个安装文件沿用已封存哈希；7 个 Zstd frames 解出 19 records。PID 31700 已精确停止（stop `:6,9`），普通进程为 0；六组冻结保护检查均通过。

## 测试与验证缺口

未重跑 335 套件，符合本轮边界；未调用 DSH、RPC、网络或模型。

## 剩余风险

本轮 1 Task/2 requests 许可已全部消费，即使两次失败也不得继续请求或替换 Task。真实完整响应仍是唯一验收阻断项。
