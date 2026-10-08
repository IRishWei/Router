# 结论：PASS（v3 helper）；实际 T09 仍待 detect

未发现阻断问题。v3 关闭初版与 v2 的 Spec 缺口，可用于已获许可的唯一 b 轮 Task；许可仍严格限 2 个模型请求且禁止扩预算、重试和 API fallback。

## Findings

无。

## 需求符合度

- `t09-v0102b-helper-lib-v3.mjs:49-83` 精确验证 1 个新 Task、历史 231 Tasks 不变、`65536 tokens / 120000ms / money=[]`、`extensions=[]`、`maxCalls=2`、forecast 2048（仅预估）、最多 2 Calls/可能派发、无显式 retry。
- provider 由 baseline `accountId` 推导为生产值 ``router-chatgpt-${accountId}``（`:11,68-74`），并将 capture、active selection、每 Call 的 `taskId`、candidate、selection 与 selection snapshot 绑定到同一 ChatGPT subscription account/connection/provider/model（`:75-81`）；不接受 API fallback。
- restore 在任何配置写入前执行完整 Task 断言，只开放配置/设置 RPC，并在写后复查 Task、claim、account/connection 与 native default（`t09-v0102b-restore-config-v3.mjs:23-60`）。preserve-v3 只处理 before-restart/restart-check，不重复 capture（`t09-v0102b-preserve-v3.mjs:13-46`）。初版和 v2 文件保持原字节；四个 v3 SHA 与给定值一致。

## 测试与验证缺口

独立运行纯内存/只读 guards：4/4 通过。其真实 baseline 用例克隆既有生产 Task/Calls 完整形状并作为唯一新 Task 验证（`t09-v0102b-helper-guard-v3.test.mjs:113-126`）；负例覆盖预算、扩展、retry、静态 source provider、fallback、身份和 candidate 漂移（`:85-110`）。未运行 live helper、Desktop 或模型。

## 剩余风险

helper PASS 只证明验收边界不会误判；尚无 b 轮真实 `response.completed`。detect 后仍须按 v3 完成配置恢复、重启持久化与 owned stop，T09 才能依据实际结果重新判定。

冻结 v3 SHA-256：lib `9789DEA01B153B5202EAB5122EEBAC00D4BF9846EFB281610B2546CAF9E0120D`；guard `B46F58E27702C4937F5E076616FA5E006FC1512F6578F815054D3564CB02ED9E`；preserve `42035FB75C7BD1B06E07498603ABC1993DF6D55CB22E9475567C6D101F0EA1A2`；restore `10C0EB112102E4A5AAF7E99D1441E55D3C6EFBF1290F1B759358051BAB90810C`。
