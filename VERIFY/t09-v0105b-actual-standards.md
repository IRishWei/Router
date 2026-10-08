# T09 v0.10.5b 实际验收 Standards 审查

## 结论：BLOCK（实际推理 NOT PASS）；工程保全 PASS

## Findings

- **P1 — `src/chatgpt-responses.mjs:539-556`**：官方真实请求已流出唯一完整文本块 `CHATGPT_CONNECTION_OK`（`t09-v0105b-native-session-decoded.json:1118`），随后 `response.completed` 被判为 `Completed Responses output disagrees with streamed output`（`:1130,1157`）。Task 因此以 `paused/MALFORMED_RESPONSE`、`acceptance: unconfirmed` 结束（`t09-v0105b-real-task-evidence.json:276975-277638`），核心套餐推理路径无法形成成功终态，违反“成功完成推理分别记录、只以 `response.completed` 完成”的契约（`docs/implementation/t09-chatgpt-oauth-contract.md:15-17`）。先用只读安全元数据确定 completed output 与 stream 的精确结构差异，再仅规范化语义等价表示；内容、顺序或工具调用差异仍须 fail closed。补充捕获形状的回归测试，同时保留真实不一致拒绝测试。

## 需求符合度

有界执行满足许可：1 Task、2 次真实 dispatch、65536 tokens、120000ms、约5689ms；无扩额、重试或 API Key fallback（实际证据 `:277688-277698`）。两 Call 为 failed/interrupted、usage 均 null，canonical ledger 将两次用量统一记 unknown（`:277168-277400,277668-277673`），未伪记零。

恢复与重启独立断言通过。最终 raw state 为 9068103 bytes / `9D228D…D3AB`，234 Tasks、543 Calls、config 584；旧 233 Tasks 与 claim 前 raw 投影逐对象完全一致（`t09-v0105b-final-state-identity.json:4-13`）。最终 owner PID 4584 已停止，DSH 进程为 0；72 个准备文件指纹校验通过。普通证据未发现 token、code verifier 或完整授权 URL。

## 测试与验证缺口

当前证据没有 completed output 的安全结构对比，尚不能判断哪一层表示差异。许可已消耗，不得用真实重试补证；仅可离线补充安全元数据与失败结算。

## 剩余风险

输出文本出现不等于推理成功。T09 应按合同第29行保持打开，修复后需新的明确许可才能再次真实验收。
