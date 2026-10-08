# 结论：BLOCK（实际验收）；安装保全与 cleanup PASS

T09 保持 OPEN。b 轮安全地暴露凭据过期并完成保全，但没有产生完整 Responses 请求或结果。

## Findings

- **P1 — `t09-v0102b-real-task-evidence.json:10,203-209`；`t09-v0102b-native-failure-summary.json:42`**。规格要求“目标桌面一次授权→返回→选择→完整请求可复现”。唯一获准 Task `8471898a-8454-4085-b79e-a6f6c5f00cc6` 因 `ChatGPT access token expired; sign in again` 暂停为 `UNKNOWN`；唯一 Call 为 `not-dispatched/proposed`、reservation released、usage `null`，实际模型请求为 0。故安全拒绝成立，但 AC4 的完整请求不成立。该许可按 Task 计已耗尽，不能恢复 Task、重开 deadline 或把未派发的 0/2 请求转给新 Task。应保持 T09 OPEN；后续只有在独立修复和新的明确许可下才能重新验收，不能用本轮 cleanup 或受控测试替代真实成功。

## 需求符合度

- 人类许可为 1 Task/2 请求、65536/120000、无 retry/API fallback（`t09-v0102b-human-authorization.json:7-15`）。实际 Task 使用同一 ChatGPT subscription provider/account，`maxCalls=2`、forecast 2048、无扩预算；无 dispatch、retry、fallback 或伪造 usage。
- baseline 231 Tasks/538 Calls/config566；恢复后 232/539/config572。独立逐对象比较确认旧 231 Tasks、唯一新 Task、claim、config、DeepSeek、account 与 native default 全部保留。
- 重启严格 v4 检查因 `connection.available: true→false` 失败；expiry audit 只确认连接身份不变、过期连接变为不可用，并明确 `connectionAvailabilityPreserved=false` 与实际 `BLOCK`（`t09-v0102b-restart-evidence.json:275697-275710`）。不得称为全 metadata PASS。
- 安装 0.10.2 的 29/29 文件仍匹配源包。PID 3160 与重启 PID 30992 均精确停止（两个 owned-stop 文件 `:6,9,12`），ordinary Desktop=0。

## 测试与验证缺口

没有 `response.completed`、完整输出或已知 usage；0.10.3 的过期提示修复属于后续源码工作，不改变本轮事实。

## 剩余风险

账号在重启后保持不可用，真实请求能力仍未证明；历史 b Task及其 `UNKNOWN` 必须保持原样。
