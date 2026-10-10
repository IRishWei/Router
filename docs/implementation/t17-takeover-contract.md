# T17 稳定边界接管合同

对应 [规格 #1](https://github.com/IRishWei/Router/issues/1) 与 [T17 #18](https://github.com/IRishWei/Router/issues/18)。0.16.0 实现咨询后有新可信失败证据时的一次同 Task 接管。`TaskTakeoverController` 管理完整性证明、候选与策略重验、工具语义绑定和持久计划；实际请求、取消、预算、Call 与结算仍由现有原生 AgentLoop 和 Router 统一入口拥有。没有创建独立 prompt Task、复制原生请求、修改全局默认或提供商认证配置。

## 授权与触发

公开 `setTakeoverPolicy` 接受严格 `{enabled,candidateId,allowCrossModel,allowFixedModel,maxTokens,forecastTokens}`。默认关闭、无候选、两个许可 false、输出512、总预留32768；输出1—4096，总预留1—65536且不少于输出。启用须选择当前池内已启用的 Host-owned candidateId。接管许可与 T16 咨询独立。

Task 开始冻结策略、目标偏好和固定候选。T16 已可靠交回咨询，随后 canonical 验收出现新的相关证据 fingerprint/episode/version，才触发接管。无新证据不再次规划；每个 Task 的接管 attempts 最大1。固定任务仍须独立 grant；执行期间当前策略、自动开关、固定选择、启用池、连接配置与授权代际必须仍符合冻结合同。Task 计划记录这些依据和精确源/目标身份。

## 可携带历史与公共 Session 证明

PortableHistory 保存全部原生可见 messages 的 id、role、完整 content、sourceKind、toolCallId/isError，全部图像引用、已完成工具 receipts 和完整 toolHistory。原始 Task.inputs messageId/contentHash、acceptance requirementHash 逐项绑定；原用户约束、原文本和已完成工具内容不能以摘要或占位替代。新 Router/原生通知可追加，旧消息必须逐字保留。

Portable message DTO 精确规则为 `{id,role,content:structuredClone(message.content),sourceKind:message.source?.kind??null}`；仅当原生 `toolCallId` 为非空值时附加 `{toolCallId,isError:Boolean(message.isError)}`。因此原生工具消息省略 `isError` 时，DTO 明确归一为 false；非工具消息不添加该字段。任意其他 source 元数据和 signal 不进入公开 DTO。

新读取通过公开异步 `sessionQuery.observeSession(sessionId,{signal,projectionMode:'none'})`，每个 lease 均 dispose。必须是 live、同 attached Session 对象当前 cursor 的连续完整 immutable cut。使用当前公开 projection catalog 的 `foldSurface`，将同 cut 的 `fold.projectedMessages` 交给 `deriveEventMessage`，在没有 await 的比较窗口精确核对 attached `deriveMessages`；最终再次核对实际原生 request.messages。catalog 的定义身份、type/project 函数在每个边界重验。

记录的 proof 如实为 `source:'live',mode:'none',projectionAsOfSeq:null`，另含 sessionId/cursor、inheritedEventCount、interpreterTypes、contentGeneration0、messagesHash 及实际 tool/call→tool/result 序列身份。此证据证明当前 native 可见对话的一致性；不宣称 provider wire projections 完整。rc.2 首个 Task 的 `all` 模式 wire projection codec 失败保留外部诊断；none 路线不新增 priming 文本 Task 或费用。

出现 replacement、contentGeneration、压缩、offloaded 图像、缺失或不匹配 cut、无法表达的 role/content 时拒绝。任何历史 message.source.replayState 均拒绝，包括同 adapter 的不同 model；provider private replay 不进入 DTO，也不通过协议名称推断可移植。

## 候选、实际准备与容量

Owned model 可声明 `handoff:{protocol:'dsh-canonical-v1',toolProtocol:'function-json-schema-v1'|'unsupported',confidence:'declared',source}`。缺项、旧持久化缺项保持 unknown。捕获绑定真实 connection/account/billing/provider/model、authEpoch、connectionConfigRevision 和声明 hash。声明与本地受控协议验证不同，不等于任意 serializer 已验证。

目标同时需要 candidate 文本能力和精确公共 model 的文本模态、`systemPromptUpdate:'in-history'`，正整数 owned maxContextTokens 与精确 contextWindow。工具内容需要明确 tools capability/function-json-schema-v1；历史工具变更还需 `toolUpdate:'in-history'`。全部实际 schemas 都经过公开 object JSON schema 校验；文本 Task 也计算系统提示与完整工具 schemas。

Router 在公开 `llm.prepareCall` 服务读取 facade 中观察原始 config 对象对应的实际 one-shot prepared handle，await 后验证精确 owner、候选、配置及 resolved→prepared 模型事实一致，然后返回原 handle。不会创建或冒充 native request。最终 `isAgentLoopRequest` 原对象在公开 llm/stream 入口核对；adapter 可能合法收到原生运行时的 projection copy，两者不可混为 native ownership。

准备和最终原生请求分别计算完整 JSON UTF-8 字节数上界，加逐图像 visual tokens/text bytes 与配置输出上限；必须装入两份容量的最小值以及用户配置 forecast。最终计算含全 messages/system/tools/toolHistory。配置的完整 forecastTokens 进入原 Task 预算预留，未派发释放。图像逐个公共 readImage 核对 exact ref/sha256 原字节；candidate 和精确 model 图像能力、目标公共 imageRequestPricing 的逐图像正安全整数估算缺一则拒绝。声明估算不构成服务端或账单绝对硬上限。

拒绝原因按实际检查顺序保留首个失败：grant/候选可用性/portable handoff 声明先于历史证明；历史、操作结果和语义证明先于目标格式；route 中先检查 text 与 system in-history，再检查图像模态；prepare 中先检查完整工具协议/schema，再核对图像 bytes/估算，最后检查容量未知/超限与 forecast。最终请求也先重验 prepared facts、历史和工具/图像，再检查容量与预留。因而完整 Desktop 系统已带 tools 时，toolProtocol unsupported 对应 `TAKEOVER_TOOL_PROTOCOL_UNSUPPORTED`；容量小且工具协议也不支持时先报工具协议，不能为得到某个原因而绕过先前检查。

## 工具语义与副作用

真实公共 `ToolDefinition` 可携带 Router 扩展 `routerOperation:{version:1,effect:'read'|'side-effect',idempotencyKey:string|null,source,confidence:'declared'}`。这是 Router 合同，不能声称 SDK 自带该字段。真实 tools/pre-execute/result token 绑定实际定义和完整 call/result receipt；不是按工具名加参数 blanket 去重。

副作用必须有实际非空字符串幂等 ID，operationKey 绑定完整 schema、operation 声明和该 ID。已完成 callId 复用拒绝；新 callId 但 operationKey 重复也在 body 前拒绝。新 callId 合法重复读允许。缺少语义或幂等 ID、pending/unknown 结果暂停。

Process-private semanticBindingId 绑定实际 registry `.get()` 的定义对象、execute/render/output schema、project/finalize、concurrency、timeout 与声明。公开 tools/change 只失效相关定义：同名同参数 schema 的 execute/output/operation 替换也失效，临时撤销后恢复原定义仍不能复用旧证明；不相关注册不取消接管。receipt/guard 以真实 assistant tool-call/root tree 为归属；独立 Host 验收工具不冒充对话中的模型 tool receipt。函数和执行 token 不持久化，重启后的旧历史工具无法证明相同语义，保持 unknown。

公共通用 nested Tools.execute 的 child 不一定出现在平面会话。实时 registry binding/result 观察同 Session native execution tree：outer completed 不能掩盖 pending/unknown child；所有 completed receipts 都必须有 portable flat 表示，否则明确 `TAKEOVER_TOOL_HISTORY_UNSUPPORTED` 并暂停。完整 raw cut 中 PTC start/settle log-only 记录也直接拒绝；target outer grant 不授权 child，公共 guard 在 child body 前拒绝。此版不声明 PTC/nested 协议兼容，也不丢弃 child 后继续派发。

运行期 ancestry 以已观察的真实 registry parent token、native root 和 agent scope 关联；子调用缺 agent、root/agent 冲突、parent 未观察或已完成时不能继承许可。已完成 parent 的进程内 lineage 保留以拒绝延迟 child；Task ID/turn 在归属时冻结，后续同 Session 新 turn 不能接收旧 child receipt。只有 claimed root 匹配多个活动 native 树时，对各可能树保留 unknown 并拒绝 child，不把模糊归属当作已证明 owner。Ancestry 在 definition 查询前保存，与工具语义 binding 独立；缺 definition、缺 agent 且 parent 未归属的组合也保留 matching native root 的可能 Task 归属。每个已关联 token 从 pre-execute 起维持 unsettled，收到公开 result 才结束；缺 definition 的 child 停在公开 execute wrapper 时同样阻止接管。普通 UNKNOWN_TOOL 仍经过 pre-execute；参数不可 JSON 化等准备失败则可直接发出 result，跳过 pre-execute/guard。此类没有自身 binding/ancestry 的 early result 仍按活动 matching native root 的冻结 Task owners 保留 unknown。真实 error result 归入原 Task，公开错误码来自 `result.error.info.code`，不虚构缺失 code。关联证据不能授予 child 许可。这些 token/agent 绑定不持久化；没有 agent/parent/root 公共关联的独立 Host 操作不冒充模型工具记录，也不宣称能够识别任意插件内部的隐藏副作用。

公开 Tools.guard 不是跨任意异步 plugin wrapper 的 definition 锁，SDK body 会重新 resolve 定义。检测到 guard 后相关定义变化时，receipt 不再保留旧 operation completed 证明，记为 unknown 并阻止后续接管/重放；已经由其他 wrapper 启动的 body 不能追溯取消或认定副作用回滚。该范围是基于受控 registry owner 声明和公开变化事实的防重，不能宣称任意插件下 execute 被冻结。

## 计划、真实 owner 与持久状态

`task.takeover` 含 version1、revision、attempts、plan、timeline。Plan 包含可信依据三项、acceptanceRevision/requirementHash/coordinationRevision、源 actual owner、目标完整 capture、policy、portableHistory、noticeMessageId、最新 callId、forecast/imageForecast、finalRequestHash/finalRequest、state/reason、canonical acceptanceVerdict。Host-only publication 使用三轴 CAS；RPC 不能提交 plan、proof 或 verdict。

| 观察事实 | 记录 |
| --- | --- |
| notice intent 已保存；steer 未确认 | intent-persisted；异常 delivery-unknown/paused |
| notice 已可靠交回 | notice-delivered |
| 实际组装通过完整性/能力/容量 | prepared |
| 同 Task Call 已预留 | call-reserved |
| 最终 native DTO 已保存 | dispatch-intent；仍无下游接受证明 |
| 进入下游 stream/adapter | dispatch-started，executionOwner.confidence possible |
| 观察到实际响应 | dispatched，confidence response-observed |
| 完成并重新 canonical 验收 | completed；acceptanceVerdict 分别 passed/failed/unconfirmed |
| 首响应前失败 | dispatch-unknown/paused，消耗未知 |
| 部分响应后失败 | interrupted/paused，已观察到 owner，未报告消耗未知 |
| 未派发撤权/不兼容 | refused，释放预留并保留原 owner 或明确 paused |

`plannedSelection` 是计划目标。Task 开始已启用接管时才维护 `executionOwner:{candidateId,identity,callId,turn,step,confidence}`，其余 Task 可为 null，实际 Call 记录仍保留。该字段是最后真实派发记录；仅生成 plan、进入 iterator 或保存 intent 都不能表示成功接管。正常 target tool 跟进更新最新 finalRequest，因此成功终态 plan.callId、finalRequest.callId、executionOwner.callId 相同；较晚准备失败时不要求三者相同。早期固定/跨模型grant拒绝且未捕获目标时 target/plannedSelection 均 null，界面目标尚未确认。

FinalRequest DTO 保留实际 taskId/sessionId/turn/step/callId/provider/model/maxTokens、完整 portable messages、完整 tools/toolHistory/system、实际 prepared 公共 facts/config/defaults 与同 cut Session proof。`finalRequestHash=SHA256(JSON.stringify(finalRequest))`，是该审计 DTO 的绑定，不是未知 provider wire bytes hash；signal 和任意 source 私有元数据不复制。每个真实 Call、usage 与费用仍进入原账本。

所有 prepare/query/attachment/persist/budget await 后复核 live 资格、人工/原生 pending、Task 输入、验收与协调 revision、同 plan、历史和工具 owner；最终 intent 保存后同步复核 cursor，期间没有 await 再进入下游。等待预算时仅 `setModelEnabled(target,false)` 即可唤醒并以 `MODEL_DISABLED` 拒绝预留、停止本次接管，不需扩额；该原因由通用候选资格检查先于接管 capture 重验产生。固定/策略/自动开关改变则按实际边界返回 `TAKEOVER_POLICY_CHANGED` 等对应原因。原生手动选择或新 user steer 优先，保留其 pending 内容和原输入。

Host 重启将持久 pending 状态一次性降为 delivery-unknown；possible dispatch 则 dispatch-unknown，已观察到响应则 interrupted。保留原 Task/turn/Call、源/目标、完整审计、已知用量及未知费用，永不自动重新发送。实际原生 retry policy 也不能重复 possible/unknown target 调用。T18 的恢复不在此票实现。

## 界面与真实限制

设置页独立 grant、候选、输出和总预留字段通过公开 setTakeoverPolicy 保存。活动与历史任务分别展示接管前执行候选、计划目标、最后派发记录、状态/原因/次数、可信 episode/version 和验收。possible 清楚显示“可能已派发，尚无响应证据”，不显示已完成转移。

当前 Go/兼容/ChatGPT 公开能力无法证明上述完整合同，保持拒绝；普通候选发现不自动授予 handoff。测试使用实际 rc.2 原生 Task/Renderer 与本地可控 adapters，没有远端模型费用、视觉质量或真实效果证明；真实效果 #22、官方 API/第二账号等最终 #25 门槛仍保留。
