# T16 咨询协调共享接线证据

0.9.0 已将 `TaskCoordinationController` 接入共享 Host、RPC、Renderer 和构建闭包。源码验证完成；目标 Desktop 升级、公开 RPC、实际 companion、123 条旧 Task 深比较及重启验证仍由独立安装验收完成，因此本记录不单独代表 T16/#17 实际通过。

## 模块边界

唯一入口是 `afterAcceptance({ agent, turn, signal, acceptance })`。调用方必须先等待 T13 发布同一 Task、同一 revision 的 canonical acceptance，再调用本入口。模块通过 Host-only facade 读取 `exactTask`，并以 `{ acceptanceRevision, coordinationRevision }` 调用 `publishCoordination`；没有内存计数可替代持久 Task 状态。Task 冻结策略的 `enabled` 是整个 T16 自动协调总开关；缺失/关闭时零 steer、零新增 Call。Task 冻结的 Router `automatic:false` 同样暂停 T16，即使 T16 策略已启用。咨询候选配置和许可不能隐式开启自修。

首次可信、可修复失败先持久化 Task-wide self-repair intent，再用 `createUserMessage` 和 `agent.steer` 发布 `source.kind='router-self-repair'`、`form='notice'` 的同 turn 消息。它不调用 `SessionController.prompt`，不伪装人类来源，不创建 Task、agent 或预算。

同一 episode 由 `{taskId, blocking.id}` 稳定标识。相关证据 fingerprint 只包含阻碍关联的 requirement、verdict/reason、measurement/observed、可信检查 execution receipt 与局部 finding；排除 artifact/message id、revision、时间和全正文 hash。因此无关正文变化不会增加 evidenceVersion，T13 的派生 `selfRepairAttempted/newEvidenceVersion` 也不会重置持久计数。

同一 episode 在一次 self-repair 后出现相关新失败证据，或可信检查明确记录能力不足时，才可进行一次咨询。Host 冻结策略必须给出 candidateId、与 Task 一致的 objective、`objective-qualified` 依据、显式跨模型许可以及有限输出/总 forecast。固定模型另需显式许可。模块先构造最终发送的完整 messages，再以其包含 role/content/type/id/source 的 JSON UTF-8 字节数作为保守 input-token 上界，并加固定 output-token 上限；配置总上限、候选容量未知或不足时零预留、零派发。随后重新 capture canonical candidate，检查启用、文本能力和完整五元身份，先持久化 consultation intent，再走统一 `reserveCall(... purpose:'consultation') -> streamReservedCall(...)`；原 Task、预算和 signal 不变，调用方不自行 persist/settle。

咨询 payload 只有 Task/revision、当前 blocking、被引用 requirement 与相关 evidence，不含全会话、工具权限、私有 replay state 或凭据。建议长度有界，先保存 callId、candidate snapshot、文本 hash 和 notice id，再用 `router-consultation` notice 交回主 agent。建议本身不改 acceptance；只有主 agent 继续执行后的新验收证据才能 resolve episode。

意图状态在外部动作前持久化。每次持久化、candidate capture、预算预留或咨询流等长 await 之后，真正 dispatch/steer 前同步复核同一 Task、acceptance revision/hash、coordination revision、episode evidenceVersion/fingerprint、原 signal 与待处理的人类补充；任一变化都释放未发送预留或把建议标 stale，不发送旧 notice。恢复入口在读取当前 obstacle 或推进 passed/unconfirmed acceptance 前，先遍历持久 episode：self-repair `intent-persisted`，以及 consultation 的 `intent-persisted`、`call-reserved`、`advice-ready`，都会 CAS 持久化为 `delivery-unknown/stalled` 且不会自动重放；即使当前 acceptance 已通过、无法确认或换了 blocking 也不遗留 intent。相同 fingerprint 不重复 steer/Call；网络、限流、认证、预算、撤销、取消和 transport 原因不升级为任务困难。咨询失败保留原执行选择、产物与 acceptance。

## 共享接线与测试

`test/t16.coordination.test.mjs` 覆盖总开关、自动路由暂停、首次自修、相关/无关证据版本、能力不足、未知容量、固定保护、网络/研究/模型评审 fail-closed、重启未知派发、完整消息封装容量、stale acceptance、咨询失败及去重。`test/t16.controller.test.mjs` 保留真实 rc.2 Controller tracer。

`test/t16.integration.test.mjs` 使用真实 SessionController、AgentLoop、共享 Router Host 和 T13 canonical 字符规则，在一个 Task/turn 中取得 4→9→14 的真实测量，依次完成自行修正、相关新证据、一次咨询 Call、建议继续执行和最终通过。它还覆盖 Host 双 revision CAS、Task 策略冻结、固定 deny/grant、transport、预算等待的 extend/stop/revoke、重启持久化及旧 Task 原字段深比较。`test/t16.client.test.mjs` 通过真实 rc.2 Renderer/Typert/RPC codec 配置策略并显示 episode。

## 已接线合同

- `AcceptanceCoordinator` 的唯一 stopping listener 先发布 canonical acceptance，再 awaited 调用 `afterAssessment`；Router notice 的 requirement 入口仍只接受 `source.kind='user'`。
- Host-only `publishCoordination(taskId, { acceptanceRevision, coordinationRevision }, next)` 验证 schema 与双 revision CAS，先更新内存 owner，再持久化、flush 后返回；不进入 Typert/RPC。
- 公开 `setCoordinationPolicy` 配置 `{ enabled, candidateId, allowCrossModel, allowFixedModel, maxTokens, maxAdviceChars, forecastTokens }`。Task 开始时冻结它及 objective/selectionBasis；缺失候选只允许首次自行修正。
- build/package 纳入 `coordination.js`；Renderer 展示显式许可、有限输入输出和持久 episode。旧 Task 不新增 `coordination` 字段。

## 剩余验收

需要在目标 Desktop 以正式 0.9.0 包和冻结 companion 完成升级、默认策略、真实 4→9→14、预算等待、撤销、失败分类、Renderer、重启及旧 123 Task/config/原生默认逐字段深比较。T14 的来源网络阻塞保持独立，且在 T14 发布 canonical 研究失败可信谓词前，T16 对 research/model-review 继续 fail-closed。
