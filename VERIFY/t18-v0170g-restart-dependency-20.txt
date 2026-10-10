# Controlled validation source contract

Reviewed source: 5e51bf3e3e40e1d05bffa4976cae1c5a263cafc7. Version: 0.17.0. Label: t18-v0170g.
Public RPC uses setRecoveryPolicy({policy:{...}}) and resolveTaskRecovery({request:{...}}); the Host service accepts the inner value.
Source fixtures and the Desktop fixture retain their own separately declared preset usage/counts.
This capture does not certify Desktop execution, production recovery, billing or model quality.

# T18 / #19 故障恢复合同（0.17.0）

基线为 T17 `547b8b188036a43f4f5627f4cb103598c0c9d3f0`。本合同描述源码、rc.2 完整 Native Task 与公开 RPC 的受控行为。真实模型质量、真实 API 权限、第二账号与实际费用仍属于最终交付门槛；本票不认证这些结果。

## 公开接口与起点归属

```js
await router.setRecoveryPolicy({
  enabled: false,
  automatic: false,
  alternativeCandidateId: null,
  maxTokens: 512,
  forecastTokens: 32768,
});
await router.resolveTaskRecovery({
  taskId, recoveryId, expectedRevision,
  action: 'retry-current', // 或 'stop'
});
```

输出均为已有 Snapshot；`config.recovery` 经严格 RPC codec 保留。新增参数使用严格 schema：输出上限 1–4096，完整输入与输出总预留 1–65536 且覆盖输出；候选只能引用当前已启用的 Host candidateId。action 只能绑定 UUID task/recovery 与正整数 revision；CAS 在首个 await 之前消费，重复操作不能产生第二个恢复派发。Host-only 的 `streamReservedCallWithRecovery` 只接收精确 consultation Call；不作为 RPC 暴露，也不授权其他 purpose。

新 Task 起点在自动路由与 recovery.enabled 同时开启时归属此恢复策略，策略保存在 Task 中。未归属、默认关闭、automatic=false 或原生专用检测的起点保留既有原生委托/检测限制。归属以后，关闭 automatic、禁用恢复策略、改变固定模型、撤销候选、改变授权 epoch 或配置 revision 都使待派发恢复失效，不能退回宿主无限重试。normal、always、先后加载的原生 retry plugin，以及外层忽略 Router stop 决定的 listener 都不能增加已归属 Task 的新模型入口。

## 冻结工程上限与状态

执行、咨询及接管共用同一个 Task 的 **最多 2 次额外恢复 grant**。进入规划即持久消费一次；拒绝证明、人工等待、取消或中途存储失败不退还次数。每次计划等待至多 **500ms**，累计计划等待至多 **1000ms**，均不自动扩额。可信 `providerRetryAfterMs` 大于剩余额度时暂停，不能提前重发。`waitMs` 记计划 delay；`actualWaitMs` 记录 backoff 阶段的实际经过时间（含持久化与调度），可超过计划值。这里没有操作系统墙钟硬上限。人工等待不消费 scheduled delay，但沿用原 Task 的耗时预算和停止信号。

恢复状态经过 planning → waiting-user（人工策略）/backoff → ready → call-reserved → completed；任一硬门失败转 paused。每个恢复 Call 使用新 callId，保持同 task/session/turn，原生重试保持同 step，并记录 recoveryId、sourceCallId、originatingPurpose 与 recoveryPhase。原失败 Call 保持 failed、原错误与实际用量；恢复完成只表示新响应完成，不改变 canonical 验收规则。标题、review、probe 与其他辅助调用仍逐 Call 对账；purpose 不用于绕过其既有次数限制。

`retry-current` 始终重试当前源模型。人工动作不会隐式切换配置的 alternative。仅 automatic=true、已明确配置 alternative、第二个 grant、没有固定模型/待执行原生选择时，才可尝试替代；替代仍必须通过下面全部证明。咨询保持一次逻辑 intent，`consultation.callIds` 列出全部实际尝试，最终 advice 绑定最后 Call，仍只交回一次。ready/delivered/delivery-unknown 的原意图不会重新消费。

## 故障事实与失败方向

新增 failure DTO 只保存 code、有效可信 HTTP status、正有限 retry-after 及有界 opaque requestId。不持久化 message、cause、body 或 headers。原 SDK failure 仍沿原生事件原样传播，故障类别与用户处理原因单列；敏感 marker 测试验证新增 Router Snapshot/磁盘状态不复制原错误文本。

| 已观察到的故障 | 恢复方向 |
| --- | --- |
| connection/network/transport/timeout/server 或可信 5xx | 仅在实际 usage 已知、无任何部分内容且完整证明通过时允许有限恢复 |
| rate-limit / 可信 429 | 遵守可信 retry-after；超过等待限额暂停 |
| 授权错误 / 401、403 / 实际 OAuth INVALID_GRANT 等 terminal refresh code | 重新授权；不发送新模型调用 |
| 明确额度错误 | 补充/检查额度；不把 429 额度错误当作一般限流 |
| text、reasoning、tool 或其他部分内容后失败 | 响应不完整，暂停；人工按钮不能绕过 |
| usage 未知、其他已派发 Call 用量未知、金额预算不可证明 | 明确保留未知并停止恢复派发；不当成零 |
| private replay、历史丢失、能力/容量/工具结果不可证明 | 拒绝交接并暂停 |
| plugin exception、停止、人工输入、候选撤权或持久化故障 | 停住所属 Task，保留已有输出、原生 artifacts 和账本 |

任务困难仍由 T16/T17 的可信 canonical 验收和阻碍证据判断。连接故障不创建 difficulty episode 或 takeover plan。失败、中断、未知及暂停 Task 不作为候选成功样本。

## 派发与副作用硬门

同模型与替代恢复都使用 T17 共享的完整 canonical history、live Session query、真实工具定义/operation receipt、图像 byte/hash/pricing、能力/协议及上下文容量证明。证明不能用私有 replay 或摘要替换原输入；最终原生执行请求必须仍是 SDK 认可的原始 Native Request。实际 prepared handle 的模型事实与配置独立核对；最终原始 request 的消息、工具、图像、预算与 live cursor 再核对。

每个 await 后复查精确 Task/object ownership、源 inputs、acceptance/coordination revision、用户 inbox、原生 pending、live grants、candidate identity/auth/config 与存储。等待预算、实际准备、最终 Session observation、图像读取和持久化 dispatch intent 都在复查链中。最后同步复查与下游消费之间没有 await。新 callId 不代表可重做旧副作用：重复已完成 operation key、重复 callId、未知结果、未证明 operation 或祖先范围都被拦住；跨两个实际 Task 的 ambiguous root/迟到 child 不能绕过 guard，也不能把结果挂到后来新 turn 上。

替代必须当前启用、完整同 connection/account/billing 路径，unknown 身份不能证明相等，compatible-unconfirmed 不能证明替代计费授权。声明与实际 prepared model 的文本、图像、system/tool protocol、完整容量、输入与输出 reservation 都须可证明。固定模型始终保持固定；接管原 plan 的恢复还须原 notice 已可靠交回、原 plan 仍有效、目标相同及无部分响应，不再交回第二次 notice。

接管恢复同时遵守原接管许可与恢复许可。规划时冻结 `recovery.maxTokens` 为两套 `maxTokens` 的较小值，`recovery.forecastTokens` 为两套 `forecastTokens` 的较小值。完整输入、图像价格与容量证明、Native Request 分配、实际 prepared、最终请求和预算均使用这两个有效上限；两套独立派发门还核对精确 recovery/plan/Call 归属。恢复 Call 的 `reservation.tokens.output` 等于有效 max，`total` 等于有效 forecast，`input` 等于二者之差；该 Call 对应的 `takeover.plan.forecast` 保存相同预留。恢复最终请求与接管最终请求各自保存实际相同的 max 与 prepared 配置。两套原 policy 保留；首次接管和后续非恢复接管 Call 继续使用原接管上限，既有 Call 不改写。

执行、咨询与接管恢复均不能扩大原请求已经分配的输出许可。有效 `recovery.maxTokens` 同时受 recovery policy、所在 phase policy、原 logical request 的明确 max 和原实际请求配置限制。执行使用原 Native Call 的 `hostConfig.maxTokens`；咨询使用原 `coordinationPolicy.maxTokens`、logical request max 与实际 prepared `call.snapshot.maxTokens`；接管使用原 plan policy 和 Native 配置。缺少原请求的明确 max 时不凭空添加一个原上限，但仍受配置的 recovery/phase 上限约束。有效 forecast 为 recovery 与咨询/接管 phase forecast 的较小值；执行没有另一套 phase forecast，沿用 recovery forecast。

咨询重试创建采用有效 max 的 logical request，同时冻结该请求的完整 messages/tools/system 与 max 的 `requestHash`。实际 prepared options 重新绑定精确的 owned WeakMap 归属，最终门核对同一 intent、实际 Call、hash、prepared max 和精确 input/output/total reservation；复制 options 后通过公开 LLM 再进入不能继承该归属。所有实际尝试仍保留同一 intent 与 `consultation.callIds`，advice 只交回一次。原非恢复咨询使用原 coordination 上限。兼容连接的 owned 1024 预设是上限，不能提高明确 request max；兼容 Native 首次调用仍使用原 1024 预设，恢复使用冻结的有效 max。每一步规划、容量/图像证明、预算、allocation、prepared 和 final 都使用这个有效许可，原 policy 和已完成/失败 Call 保留。

## 人工等待与重启

人工按钮只存在于仍 live、awaited 的 waiting-user 边界。停止可取消待派发预留和当前 Task。修改许可/模型、用户 steer、原生 pending、停止或存储失败会唤醒等待并使旧 plan 失效。CAS action fulfilled 只表示消费了这个 live 决定，随后竞态仍可让硬门拒绝派发。

工具保护与故障处理共用暂停转换，统一设置 paused/reason、增加 revision、记录 timeline、持久化并唤醒 live recovery waiter。工具暂停保留原 failure/source/phase 与已消费次数、计划等待和实际等待；故障处理按原调用来源更新故障字段，不退还 grant 或清空已有历史证明。

终态和重启没有公开 resume 旧 Task 的能力。resolver 返回 `RECOVERY_NOT_LIVE_NEW_TASK_REQUIRED`；UI 明确提示修复后发送新任务，不会复活旧任务。重启时未完成 recovery 记 `RECOVERY_RESTARTED_UNKNOWN`，Task 记 HOST_RESTARTED，次数/计划等待/原始 Call 与未知状态保留；没有后台计时器、模型请求、advice、工具或私有状态复活。原 T17 和 T16 的 pending/restart 保护继续使用原合同。

原 Native `turn/end` 同时关闭尚未结束的恢复，不留下 `call-reserved` 等 live 状态。预算恢复等待上的 `stopTask` 实际终态为 Task `BUDGET_STOPPED` / recovery paused `RECOVERY_STOPPED`；waiting-user 的 resolver stop 通过原取消信号结束 awaited 边界，实际 recovery reason 为 `RECOVERY_CANCELED`。结束时保留 failure、source/Call、次数、等待与历史证明。读取这些已结束任务时，完整持久化 recovery 和 timeline 保持原值，不再改写成 `RECOVERY_RESTARTED_UNKNOWN`；resolver 仍拒绝复活旧 Task。
