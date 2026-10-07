# T16 咨询协调阶段 1 证据

本检查点实现独立的 `TaskCoordinationController`，尚未接入共享 Host、RPC 或 Renderer，因此不代表 T16/#17 完成。

## 模块边界

唯一入口是 `afterAcceptance({ agent, turn, signal, acceptance })`。调用方必须先等待 T13 发布同一 Task、同一 revision 的 canonical acceptance，再调用本入口。模块通过 Host-only facade 读取 `exactTask`，并以 `{ acceptanceRevision, coordinationRevision }` 调用 `publishCoordination`；没有内存计数可替代持久 Task 状态。Task 冻结策略的 `enabled` 是整个 T16 自动协调总开关；缺失/关闭时零 steer、零新增 Call。Task 冻结的 Router `automatic:false` 同样暂停 T16，即使 T16 策略已启用。咨询候选配置和许可不能隐式开启自修。

首次可信、可修复失败先持久化 Task-wide self-repair intent，再用 `createUserMessage` 和 `agent.steer` 发布 `source.kind='router-self-repair'`、`form='notice'` 的同 turn 消息。它不调用 `SessionController.prompt`，不伪装人类来源，不创建 Task、agent 或预算。

同一 episode 由 `{taskId, blocking.id}` 稳定标识。相关证据 fingerprint 只包含阻碍关联的 requirement、verdict/reason、measurement/observed、可信检查 execution receipt 与局部 finding；排除 artifact/message id、revision、时间和全正文 hash。因此无关正文变化不会增加 evidenceVersion，T13 的派生 `selfRepairAttempted/newEvidenceVersion` 也不会重置持久计数。

同一 episode 在一次 self-repair 后出现相关新失败证据，或可信检查明确记录能力不足时，才可进行一次咨询。Host 冻结策略必须给出 candidateId、与 Task 一致的 objective、`objective-qualified` 依据、显式跨模型许可以及有限输出/总 forecast。固定模型另需显式许可。模块重新 capture canonical candidate，检查启用、文本能力、完整五元身份、上下文容量和 forecast 后，先持久化 consultation intent，再走统一 `reserveCall(... purpose:'consultation') -> streamReservedCall(...)`；原 Task、预算和 signal 不变，调用方不自行 persist/settle。

咨询 payload 只有 Task/revision、当前 blocking、被引用 requirement 与相关 evidence，不含全会话、工具权限、私有 replay state 或凭据。建议长度有界，先保存 callId、candidate snapshot、文本 hash 和 notice id，再用 `router-consultation` notice 交回主 agent。建议本身不改 acceptance；只有主 agent 继续执行后的新验收证据才能 resolve episode。

意图状态在外部动作前持久化。重启遇到 `intent-persisted`、`call-reserved` 或 `advice-ready` 会标记 `delivery-unknown`，不会自动重放。相同 fingerprint 不重复 steer/Call；网络、限流、认证、预算、撤销、取消和 transport 原因不升级为任务困难。咨询失败保留原执行选择、产物与 acceptance。

## 阶段 1 测试

`test/t16.coordination.test.mjs` 覆盖总开关、自动路由暂停、首次自修、相关/无关证据版本、能力不足、未知容量、固定保护、网络分类、重启未知派发、stale acceptance、咨询失败及去重。`test/t16.controller.test.mjs` 使用真实 rc.2 SessionController/AgentLoop/Router owned runner 和 controlled acceptance/CAS protocol fixture：一个 Task、一个 turn 内完成 `BAD1 -> self-repair -> BAD2 -> consultation Call -> advice -> FIXED`，保留两个自有 source notice、四个同 Task Call 和一次咨询计数。第二次失败的 receipt 是协议夹具输入，不是 T13/ToolRuntime 已接线的真实检查证据；正式接线仍须用 canonical T13 结果和真实 Host check 回归。

## 待共享接线

- T13 暴露 awaited post-assessment hook；Host 按“publish acceptance -> T16 afterAcceptance”固定顺序调用，不能依赖 Cordis listener 注册顺序。
- Router Task schema/migration 增加 `coordination`，并提供 Host-only CAS `publishCoordination(taskId, expected, next)`；此方法不进入 Typert/RPC。
- Task 开始时冻结 consultation policy；共享设置/UI 展示显式跨模型与固定模式许可、有限预算及 timeline。
- build/package 纳入 `coordination.mjs` 后，再做完整重启、预算等待/扩展/停止、候选撤销、Renderer 与 Desktop 验收。
