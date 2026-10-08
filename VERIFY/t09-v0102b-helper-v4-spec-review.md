# 结论：PASS（v4 cleanup helper）；T09 实际仍 BLOCK / OPEN

未发现阻断问题。v4 可用于完成现有 b 轮的 before-restart、restart 与 owned stop；不得再创建 Task 或发模型请求。

## Findings

无。

## 需求符合度

- `nativeDefaultStableView` 仅排除 `settings/describe` 每次动态生成的顶层 `schema`（`t09-v0102b-helper-lib-v4.mjs:22-29`），保留 namespace 的 `ns`、value、user、base、revision 及其余所有字段。before-restart 与 restart 均通过该稳定视图精确比较（`:108-118`；`t09-v0102b-preserve-v4.mjs:36-47`）。这修正派生 schema UID/refs 的假失败，不放宽配置值或持久化状态要求。
- v3 的 1 Task/2 请求、65536/120000、无扩预算/retry/API fallback、动态 account-scoped provider、subscription identity、Call.taskId/candidate/selection/snapshot，以及历史 Task/config/account/connection 保全断言均原样保留（`t09-v0102b-helper-lib-v4.mjs:58-105`）。
- 三个 v4 SHA-256 与给定值一致；初版、v2、v3 文件保持原字节。未见 scope creep。

## 测试与验证缺口

独立运行只读 guards：5/5 通过。schema UID 变化正例通过，value/user/revision 漂移均被拒绝（`t09-v0102b-helper-guard-v4.test.mjs:74-85`）；真实 baseline 生产 Task 形状及 v3 全部正负例继续通过。按要求未执行 live helper、Desktop 或模型调用。

## 剩余风险

b 轮实际 Task 已消耗唯一 Task、产生 1 个 Call 但 0 dispatch；Native 明确返回“ChatGPT access token expired; sign in again”。因此 AC4 的完整请求仍未完成，T09 不能判定通过。v4 只保证 cleanup 证据正确，不改变该真实限制。

冻结 v4 SHA-256：lib `8CFEC9A73C6AE5213CDC310414AC4F2783DC16D9B66333E19233663CF4A86C4F`；guard `94C13AC62E5E573ABB0C4F9369E2D69CD45C8821303D410B639A168F9FA49018`；preserve `4CFE2309ACB4542B04B3E7BDA776CAC6B8F6662874BE5BB9076D3442D87A0E47`。
