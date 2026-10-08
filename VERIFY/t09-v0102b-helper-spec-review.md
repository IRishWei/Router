# 结论：BLOCK（初版 helper）；尚未 detect

只读 capture 已完成且保持 231 Tasks / 538 Calls / config 566 / claim `null`，不受下述缺陷影响。T09 仍 OPEN。

## Findings

- **P1 — `t09-v0102b-helper-lib.mjs:42-54`**。本轮人类许可限定 `65536 tokens / 120000ms`、最多 1 新 Task / 2 模型请求、无重试或 API fallback；契约同时要求“不自动转用 API Key 计费或透明重试”。`assertRenewedTask` 仅检查一个新 Task、`maxCalls=2`、Call/可能派发数不超过 2，却不检查 `task.budget.limits`、扩预算记录、Task/每 Call 的 ChatGPT subscription identity/billing path，也不拒绝 retry。触发：产生一个两 Call 以内、但预算漂移、第二 Call 为 retry，或 selection 落到 API-key/其他 provider 的 Task。helper 会接受它，随后 restore/restart 证据可被错误标记为合规，形成不可重跑的真实验收假阳性并可能越过计费授权。修复应在新的 `-v2` helper 中精确绑定 65536/120000、无扩预算、同一 ChatGPT account/connection/candidate/provider、`billingPath=chatgpt-subscription`，拒绝 retry/API fallback；guard 增加预算、retry、billing/provider/identity 漂移的逐项拒绝用例。初版文件须保持原字节。

## 需求符合度

历史保全、单新 Task 与两 Call 总界、config/native default 恢复及重启断言结构正确（`t09-v0102b-helper-lib.mjs:22-40,57-81`）。restore 仅允许配置/设置公开 RPC，且复查新增 Task、claim、account、connection（`t09-v0102b-restore-config.mjs:23-60`）。stop 只接受精确 owner 并拒绝 foreign Desktop（`t09-v0102b-stop-owned.ps1:7-43`）。restart launcher 固定 0.10.2 包及 29 文件、要求 stopped owner/evidence、零 Desktop、全新日志并在 `finally` 恢复 `DSH_HOME`；发布前失败只按 PID/exe/start 回收本次进程（`t09-v0102b-restart-launcher.ps1:14-59`）。未见其他越界。

## 测试与验证缺口

现有 guards 仅覆盖第三次派发和历史篡改（`t09-v0102b-helper-guard.test.mjs:55-69`），未覆盖 P1 的授权边界。按要求未执行 live helper；detect 尚未发生。

## 剩余风险

真实非 SSE 来源仍未知；修复 helper 只能保证证据不误判，不能使实际 Responses 成功。

冻结初版 SHA-256：helper-lib `09738A61EBC41D4CC45490076653E2D75A90984E7D1F96EB569F753F30B0F571`；guard `52E794B1721CC5D294E69BD39CC2B685077AB8E1016DD0B35E0437B5837C830A`；preserve `410ECF585E89A4E2DC3917A5F66321E502E6BE4F4FE38B473FC76074E95AFA28`；restore `D0A71B1BEC19259D978D4B198F4B5B88F09C4BA16F24E9D5FBA0F5A32A65E98F`；stop `02486B8D50FC28C183A999B11F70DE81BF3B7CACC442EF5525F37D3F99B9C76B`；restart `E1CAECB05F3D8685C16D26D1081638C0B53D88BA5CD172313450B254210125AC`。
