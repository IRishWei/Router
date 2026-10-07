# T13 基础验收证据

目标宿主为 Windows DSH Desktop 0.2.0-rc.2。独立模块在 `agent/turn-stopping` 的原 turn、原 signal 上检查最终已提交的 assistant 产物；`session/event` 只同步 messageId、seq、step、hash 和 revision，不等待模型、不追加消息。

## 独立模块 seam 与不变量

`AcceptanceCoordinator` 只接受 Host 已认领的任务输入、受信检查计划和可选匿名 reviewer 配置。模型与 RPC 客户端没有提交 verdict 的入口。

- 只解析 `仅检查以下明确要求：` 后的有限字面语法：必含/禁止字面量、Unicode code point 长度、字面结构顺序、显式 Host 编程行为/测试/构建计划及其 `工作区产物「相对路径」`、普通或高风险 rubric。分句保留 `「」` 内的句号，顺序检查从上一字面量的末尾继续搜索。其他自然语言保持 unresolved/unconfirmed；不声称完整需求抽取。
- 写作检查绑定最终实际 assistant/message 的 messageId、seq、step、hash 和 artifact revision，不检查累加草稿。
- 编程检查只执行 Host 预先授权的固定计划，并通过公开 `ToolRuntime.execute` 经过原生 policy/guard 管线。模型文本不能提供工具名、参数或命令。行为、测试、构建分别覆盖；build passed 不能覆盖 behavior failed 或 tests 未配置。
- 确定性失败优先，不发起模型“投票”覆盖真实失败。部分覆盖、未授权检查、产物不完整、review JSON/引用无效、review 冲突或预算停止均保持 unconfirmed。
- reviewer 输入只包含匿名产物、requirementHash 和 rubric；provider/model、连接/账号、策略、费用、配置版本及原要求来源不进入正文。
- review 通过 T03 `reserveCall(taskId, ..., signal)` → `streamReservedCall(taskId, callId, request)`，调用方不重复 persist/settle。普通 rubric 一次；高风险、首次无效或 unconfirmed 时最多追加一次。整个 Task 的 review attempt 上限为 2，重入不重置。完整 system+匿名 JSON payload 的 UTF-8 字节数作为输入 token 保守上界；输入、固定输出上限与 total forecast 结构一致，并受 canonical candidate context window 限制。配置预留不足、容量未知或不足时零 Call 并保持 unconfirmed。
- review 候选由注入的 Host-only `captureCandidate(candidateId, { signal })` 获取真实 registry capture，Call 原样保存 candidateId、五元 identity、selectionSnapshot 和 quoteVersion。默认不允许跨模型评审；只有明确 `allowCrossModelReview` 才可使用另一候选。每次评审同时要求正整数 `maxTokens` 和不小于它的 token forecast，真实请求携带该 `maxTokens`，且禁用透明模块级 retry。
- 结果使用 versioned Requirement、Artifact、Evidence、Review、Blocking IDs；blocking 记录 requirement/evidence 引用、artifactRevision、repairable 和 selfRepairAttempted，供 T14/T16/T22 读取。
- 结果通过 Host-only `exactTask(sessionId, turn)` 精确绑定原 Task，并由 `publishAcceptance(taskId, acceptance)` 写入 state owner；这两个入口不进入 RPC、Typert 或模型工具。
- 缓存和异步失效按 artifact 的 messageId、seq、step、revision、hash 等版本身份判断；相同正文的新 assistant/message 仍会重新验收。新 revision 将旧结论、要求、证据、覆盖、blocking 和结构化 review 以白名单 history 标记为 superseded，不复制模型原始 review 输出。

## 阶段 2 定向证据

真实 rc.2 Controller/AgentLoop/ToolRuntime 完整任务测试建立临时工作区，用户字面合同明确 `src/add.mjs` 与固定检查 ID；工作区中该实现故意做减法，`test/add.test.mjs` 断言真实加法行为。Host 固定计划经公开 `ToolRuntime.execute` 分别运行 `node --test` 与 `node --check`：行为测试真实失败、构建真实成功、未知测试计划保持 unconfirmed。计划与结果都绑定 workspace 内绝对路径、SHA-256、当前 assistant artifact revision、scope、planVersion、commandId、exitCode 和 outputHash；越界计划不会执行，伪造 revision 的结果不会成为证据。ArtifactRef 与 execution 只投影这些白名单字段，工具返回的额外私有 metadata 不进入 Task 记录。

`program-checks.mjs` 提供 Host-only Node 工作区 checker。它只接受显式要求中的固定 `node-test`/`node-check` 计划名，从真实 Session header 取得 workspace，并将用户明确的相对产物路径解析为 realpath；不从模型输出猜文件或生成 argv。未写路径、路径不存在、越界/遍历、非 Node 源文件均为 `CHECK_NOT_CONFIGURED`，未知检查 ID 为 `CHECK_NOT_AUTHORIZED`，两者都不执行工具。执行前后重新计算受限 workspace scope 的 inputHash，使用无 shell 的 `process.execPath --test` 或 `--check`，只发布 exit code 与输入/输出 hash。目标 Desktop 的 `process.execPath` 是 Electron 可执行文件，因此子进程检测到 Electron 时显式设置 `ELECTRON_RUN_AS_NODE=1`；正式宿主 runtime 探针已由集成验收方确认 Node 24.18.1/Electron 44.0.0 可通过 spawn/close 返回真实退出码。计划一次性消费；产物或 scope 在捕获后变化、输入/输出过大、取消或超时均不会形成成功证据。

评审测试通过 T08 `registerOwned` 注册并由用户配置启用受控候选，再经 T12 已合入的唯一 Host-only `router.captureCandidate`、统一 reserve/stream runner 完成同一 Task 的 Call 和 ledger。覆盖单次成功、高风险冲突、无效 JSON、JSON `null`、`null` finding 及顶层/finding 额外字段一次复核；review JSON 只接受协议列出的精确字段。另覆盖跨模型未授权零调用、token cap/forecast 不匹配零调用、传输失败暂停、预算等待后候选撤销零派发、扩展后继续及停止释放。两次评审 Call 持久化后实际重启 Router Host 并重建 coordinator，重放验收 event seam 不会重新 capture 或发起第三次调用，证据明确标记 `REVIEW_ATTEMPT_LIMIT`。评审输入不含 provider/model、账号、连接、计费、费用、策略、配置版本或要求来源；主产物在预算停止、资格撤销和传输失败后仍保留。

其余完整任务测试覆盖明确写作成功、Unicode code point 长度、结构失败、禁止项失败、部分覆盖、确定性失败不触发 review，以及真实工具 step 后只检查最终产物。真实 Controller steer 在 review 预算等待期间进入同一 Task；旧产物结论保留为 superseded 历史，新产物与新要求重新检查，且整个 Task 仍受两次 review Call 上限约束。所有 provider 均为本地受控 fixture，无网络、凭据或付费调用。

## 共享 Host 接线

0.6.1 在 Router Host 中安装 coordinator 和 Node checker。验收默认关闭；公开 `setAcceptancePolicy` 只接受严格的有限策略：总开关、评审开关、Host candidateId、显式跨模型许可、1—4096 的输出上限及最大 65536 的输入与输出总预留。新配置默认总预留 4096；已持久化的旧值不静默提高。每个 Task 在 `turn/start` 冻结策略，设置变更只影响新任务。review 使用唯一 Host-only `captureCandidate` 和统一 `reserveCall`/`streamReservedCall`；`exactTask`、`publishAcceptance`、candidate capture 和 runner 均未进入 RPC/Typert。

真实 Controller 回归覆盖默认零验收、开启后的确定性验收、真实临时 Node 项目的 ToolRuntime 检查、跨模型零调用拒绝及显式授权后的 canonical Call。重启回归保留策略、旧 Task 证据，并证明重启后的新完整 Task 继续使用持久策略。实际 Renderer 通过 rc.2 Slots/Typert/API Gateway 保存有限设置并展示证据、覆盖和整体质量限制。0.6.1集成后179/179测试、check与git diff-check通过；目标Desktop安装、20项真实任务及118条完整历史重启检查已通过，见 [安装证据](t13-installed-host-evidence.md)。

本模块不注入自修消息。一次自修协调、producer 来源类型及 attempts 归 T16/共享 Host coordinator；T16可通过公开 merge-extensible MessageSourceMap 声明 Router notice，再在 awaited 验收边界用 agent.steer 继续同 turn。SessionController.prompt 硬编码人类来源，不能用于插件指令。T13 只提供稳定 blocking/repairable/selfRepairAttempted 字段，避免两个模块各自重复“首次修复”。
