# T13 基础验收证据

目标宿主为 Windows DSH Desktop 0.2.0-rc.2。独立模块在 `agent/turn-stopping` 的原 turn、原 signal 上检查最终已提交的 assistant 产物；`session/event` 只同步 messageId、seq、step、hash 和 revision，不等待模型、不追加消息。

## 独立模块 seam 与不变量

`AcceptanceCoordinator` 只接受 Host 已认领的任务输入、受信检查计划和可选匿名 reviewer 配置。模型与 RPC 客户端没有提交 verdict 的入口。

- 只解析 `仅检查以下明确要求：` 后的有限字面语法：必含/禁止字面量、Unicode code point 长度、字面结构顺序、显式 Host 编程行为/测试/构建计划、普通或高风险 rubric。其他自然语言保持 unresolved/unconfirmed；不声称完整需求抽取。
- 写作检查绑定最终实际 assistant/message 的 messageId、seq、step、hash 和 artifact revision，不检查累加草稿。
- 编程检查只执行 Host 预先授权的固定计划，并通过公开 `ToolRuntime.execute` 经过原生 policy/guard 管线。模型文本不能提供工具名、参数或命令。行为、测试、构建分别覆盖；build passed 不能覆盖 behavior failed 或 tests 未配置。
- 确定性失败优先，不发起模型“投票”覆盖真实失败。部分覆盖、未授权检查、产物不完整、review JSON/引用无效、review 冲突或预算停止均保持 unconfirmed。
- reviewer 输入只包含匿名产物、requirementHash 和 rubric；provider/model、连接/账号、策略、费用、配置版本及原要求来源不进入正文。
- review 通过 T03 `reserveCall(taskId, ..., signal)` → `streamReservedCall(taskId, callId, request)`，调用方不重复 persist/settle。普通 rubric 一次；高风险、首次无效或 unconfirmed 时最多追加一次。整个 Task 的 review attempt 上限为 2，重入不重置。
- review 候选由注入的 Host-only `captureCandidate(candidateId, { signal })` 获取真实 registry capture，Call 原样保存 candidateId、五元 identity、selectionSnapshot 和 quoteVersion。默认不允许跨模型评审；只有明确 `allowCrossModelReview` 才可使用另一候选。每次评审同时要求正整数 `maxTokens` 和不小于它的 token forecast，真实请求携带该 `maxTokens`，且禁用透明模块级 retry。
- 结果使用 versioned Requirement、Artifact、Evidence、Review、Blocking IDs；blocking 记录 requirement/evidence 引用、artifactRevision、repairable 和 selfRepairAttempted，供 T14/T16/T22 读取。
- 结果通过 Host-only `exactTask(sessionId, turn)` 精确绑定原 Task，并由 `publishAcceptance(taskId, acceptance)` 写入 state owner；这两个入口不进入 RPC、Typert 或模型工具。
- 缓存和异步失效按 artifact 的 messageId、seq、step、revision、hash 等版本身份判断；相同正文的新 assistant/message 仍会重新验收。新 revision 将旧结论、要求、证据、覆盖、blocking 和结构化 review 以白名单 history 标记为 superseded，不复制模型原始 review 输出。

## 阶段 2 定向证据

真实 rc.2 Controller/AgentLoop/ToolRuntime 完整任务测试建立临时工作区，写入错误的 `src/add.mjs` 和对其断言真实行为的 `test/add.test.mjs`。Host 固定计划经公开 `ToolRuntime.execute` 分别运行 `node --test` 与 `node --check`：行为测试真实失败、构建真实成功、缺失测试计划保持 unconfirmed。计划与结果都绑定 workspace 内绝对路径、SHA-256、正整数 revision、scope、planVersion、commandId、exitCode 和 outputHash；越界计划不会执行，伪造 revision 的结果不会成为证据。ArtifactRef 与 execution 只投影这些白名单字段，工具返回的额外私有 metadata 不进入 Task 记录。

`program-checks.mjs` 提供 Host-only Node 工作区 checker。它只接受显式要求中的固定 `node-test`/`node-check` 计划名，通过 Host artifact resolver 获取当前 workspace、产物路径和 revision；不从 prompt 生成 argv。执行前后重新计算受限 workspace scope 的 inputHash，使用无 shell 的 `process.execPath --test` 或 `--check`，只发布 exit code 与输入/输出 hash。计划一次性消费；产物或 scope 在捕获后变化、路径越界、输入/输出过大、取消或超时均不会形成成功证据。共享 Host 接线仍需提供当前 Task 的 authoritative artifact resolver，并将此模块纳入最终 bundle。

评审测试通过 T08 `registerOwned` 注册并由用户配置启用受控候选，再经注入的 capture callback、统一 reserve/stream runner 完成同一 Task 的 Call 和 ledger。覆盖单次成功、高风险冲突、无效 JSON、JSON `null`、`null` finding 及顶层/finding 额外字段一次复核；review JSON 只接受协议列出的精确字段。另覆盖跨模型未授权零调用、token cap/forecast 不匹配零调用、传输失败暂停、预算等待后候选撤销零派发、扩展后继续及停止释放。两次评审 Call 持久化后实际重启 Router Host 并重建 coordinator，重放验收 event seam 不会重新 capture 或发起第三次调用，证据明确标记 `REVIEW_ATTEMPT_LIMIT`。评审输入不含 provider/model、账号、连接、计费、费用、策略、配置版本或要求来源；主产物在预算停止、资格撤销和传输失败后仍保留。

其余完整任务测试覆盖明确写作成功、Unicode code point 长度、结构失败、禁止项失败、部分覆盖、确定性失败不触发 review，以及真实工具 step 后只检查最终产物。所有 provider 均为本地受控 fixture，无网络、凭据或付费调用。

## 尚未整合

共享 `src/index.mjs` 接线、RPC/Renderer 展示、真实 Controller 驱动的重启再评估、steer/supersede 的整合测试与实际 Desktop 验收仍待后续。独立模块已消费现有 `exactTask`/`publishAcceptance`；测试 callback 用真实 T08 registry 数据适配尚未合入的 T12 `captureCandidate` seam，正式共享接线必须改用该唯一 Host capture，不能保留第二套快照投影。

本模块不注入自修消息：rc.2 没有 Router self-repair 的已声明 MessageSourceKind，不能把插件提示伪装成用户来源。一次自修协调、真实来源类型和 attempts 归 T16/共享 Host coordinator；T13 只提供稳定 blocking/repairable/selfRepairAttempted 字段，避免两个模块各自重复“首次修复”。上述共享接线和验收完成前不能单独关闭 #14。
