# T13 基础验收证据

目标宿主为 Windows DSH Desktop 0.2.0-rc.2。阶段 1 在 `agent/turn-stopping` 的原 turn、原 signal 上检查最终已提交的 assistant 产物；`session/event` 只同步 messageId、seq、step、hash 和 revision，不等待模型、不追加消息。

## 阶段 1 seam 与不变量

`AcceptanceCoordinator` 只接受 Host 已认领的任务输入、受信检查计划和可选匿名 reviewer 配置。模型与 RPC 客户端没有提交 verdict 的入口。

- 只解析 `仅检查以下明确要求：` 后的有限字面语法：必含/禁止字面量、Unicode code point 长度、字面结构顺序、显式 Host 编程行为/测试/构建计划、普通或高风险 rubric。其他自然语言保持 unresolved/unconfirmed；不声称完整需求抽取。
- 写作检查绑定最终实际 assistant/message 的 messageId、seq、step、hash 和 artifact revision，不检查累加草稿。
- 编程检查只执行 Host 预先授权的固定计划，并通过公开 `ToolRuntime.execute` 经过原生 policy/guard 管线。模型文本不能提供工具名、参数或命令。行为、测试、构建分别覆盖；build passed 不能覆盖 behavior failed 或 tests 未配置。
- 确定性失败优先，不发起模型“投票”覆盖真实失败。部分覆盖、未授权检查、产物不完整、review JSON/引用无效、review 冲突或预算停止均保持 unconfirmed。
- reviewer 输入只包含匿名产物、requirementHash 和 rubric；provider/model、连接/账号、策略、费用、配置版本及原要求来源不进入正文。
- review 通过 T03 `reserveCall(taskId, ..., signal)` → `streamReservedCall(taskId, callId, request)`，调用方不重复 persist/settle。普通 rubric 一次；高风险、首次无效或 unconfirmed 时最多追加一次。整个 Task 的 review attempt 上限为 2，重入不重置。
- 结果使用 versioned Requirement、Artifact、Evidence、Review、Blocking IDs；blocking 记录 requirement/evidence 引用、artifactRevision、repairable 和 selfRepairAttempted，供 T14/T16/T22 读取。

真实 rc.2 Controller/AgentLoop/ToolRuntime 完整任务测试覆盖：明确写作成功、长度、结构失败、禁止项失败、部分覆盖；Host 编程行为失败 + build 通过 + test 未授权；匿名 review 记账；高风险冲突、无效 JSON；review 预算等待后扩展或停止；确定性失败不触发 review；工具 step 后只检查最终产物。所有 provider 均为本地受控 fixture，无网络、凭据或付费调用。

## 尚未整合

阶段 1 尚未把结果持久化到 Router Task、RPC 与 Renderer，也尚未消费 T08 `exactTask`、CandidateSnapshot/capture/assertCurrent。当前 review fixture 需在阶段 2 迁移为 T08 注册的、用户启用且可用的受控候选。

本阶段不注入自修消息：rc.2 没有 Router self-repair 的已声明 MessageSourceKind，不能把插件提示伪装成用户来源。一次自修协调、真实来源类型和 attempts 归 T16/共享 Host coordinator；T13 已提供稳定 blocking/repairable/selfRepairAttempted 字段，避免 T13 与 T16 各自重复“首次修复”。阶段 1 不能单独关闭 #14。
