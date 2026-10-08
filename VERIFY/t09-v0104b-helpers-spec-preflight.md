# 结论：BLOCK（禁止执行 b live）

## Findings

- **P1 — `t09-v0104b-helper-lib.mjs:76-84`；`t09-v0104b-renewed-claim-lib.mjs:50-78`**：要求“SAME accountId/issuedClientId/connectionId re-login”。claim 仅绑定准备时状态，未与 a 的已审 evidence 绑定；登录守卫仅将登录后身份与可漂移的 `beforeLogin` 比较，而未与 `priorEvidence` 比。受控复现把三项身份全部替换后守卫仍 PASS，可在不同账号身份上消费新授权。修复：prepare/apply 及登录前后都精确绑定 a restart evidence 的 accountId、issuedClientId、connectionId（并固定 config572、初始 unavailable）；增加三项分别漂移的负例。
- **P1 — `t09-v0104b-helper-lib.mjs:92-123`**：要求“未知用量不零/unknownusage guards”，但新 Task 守卫从不核 `call.usage` 与 `task.ledger`。受控复现：Call 已 `header-confirmed`、`dispatchStarted=true`、`usage=null`，ledger tokens/unknownTokenCalls/unknownPriceCalls 全零，仍 PASS。修复：按所有可能已派发 Call 核对已知 usage 汇总；未知 usage 必须使对应 token 汇总为 `null`、unknown 计数增加，价格未知同理，并补负例。
- **P2 — `t09-v0104b-relogin-detect.mjs:128-220`**：OAuth 开始后的 `finally` 只 dispose Renderer；虽白名单含 `chatGptCancelAuthorization`，从未调用。浏览器启动、轮询或后续断言失败会留下 waiting flow，回调仍可在脚本失败后改变授权。修复：跟踪 start/completion；异常时调用 cancel 并确认不再 waiting，保留原错误；补 browser/RPC 失败清理测试。

## 需求符合度

其余边界符合：proposal 仅 claim→null，apply 要新 human 文件 hash、manifest hash、显式 flag、停机 owner 与非重放 marker；预算/两请求/无 extension/retry/provider fallback、完整历史保全、schema-only native default、重启 availability 显式 BLOCK、全 Zstd frame 读取均有实现。

## 验证与剩余风险

独立运行合成/实际基线 guards 6/6 PASS，MJS syntax 与 PowerShell AST 全 PASS；上述两个反例也实测 PASS，证明测试缺口。未执行 live/RPC/CLI。T09 实际仍 BLOCK。

关键冻结 hash：`helper-lib` `8DBC9042…09B196A`，`claim-lib` `CC895D76…D7E5F50E`，`relogin` `48F7AF65…42EC2A3`，`launch` `E5966504…6D1002D`，`restart` `F58F426C…600F97E`；共审阅 14 文件。
