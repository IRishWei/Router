# T09 0.10.7b 最终真实验收 — Spec

## 结论：PASS

## Findings

未发现阻断问题。

## 需求符合度

- 真实 Task `63898c17-7954-4912-8577-6a8e042bd469` 为 `completed`，结果精确为 `CHATGPT_CONNECTION_OK`（`t09-v0107b-real-task-evidence.json:265318-265363`）。两次实际 Call 均 `completed`，用量分别 6544 与 168；规范账本总计 6712 token、6143 ms（同文件 `265511-265718,265995-266015`），没有未知用量。
- 原生会话记录的流式文本拼接、最终 replay item 和可见 assistant 文本均精确为 `CHATGPT_CONNECTION_OK`（`t09-v0107b-native-session-decoded.json:1089-1208`）；Task timeline 以 `response-completed` 结束，`gpt-6.1-sol` inference 为 `verified`（`t09-v0107b-real-task-evidence.json:266061`）。这满足“只以 validated response.completed 成功”的当前响应一致性修复目标。
- 授权边界实际为 1 Task/2 requests、65536 token/120000 ms；extensions 为空，`automaticRetry:false`、`apiBillingFallback:false`（同文件 `278912,279112-279123`）。结合诊断阶段，父授权恰新增 2 Tasks/4 Calls；两阶段均无 retry 或扩额，授权已耗尽。
- 最终状态为 236 Tasks/547 Calls/config 596。独立比对确认原 234 Tasks 原字节语义不变；诊断后的 235 Tasks 在验收、配置恢复与重启证据中完整保持。配置值恢复到登录前基线，native default 的 provider/model/base/user 均保持；重启证据明确记录历史、配置、账号目录/推理/claim、连接身份和 native default 全部保持，且额外 Task/请求均为 0（`t09-v0107b-restart-evidence.json:278439-278449`）。
- owned PID 37568 已停止，包版本 0.10.7（`t09-v0107b-owned-final-stop.json:6-12`）；独立只读进程查询为 0 个 DSH。符合“成功即停”，没有继续 24 项开发或追加请求。

## 测试与验证缺口

本轮只审证据，未重跑测试、启动 Host 或发送请求。原始 SSE 未单独保存；修复通过端到端 native Renderer/public RPC、Task 终态与解码原生会话共同验证。

## 剩余风险

当前响应一致性故障已真实验证修复。父授权已全部用完；后续任何模型实验均需新的明确授权。
