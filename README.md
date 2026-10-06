# DSH Router

免费、开源、本地运行的 DSH 插件。当前提供两个本地可控模型、模型池管理、固定执行、任务账本和预算等待，目标宿主是 Windows DSH Desktop **0.2.0-rc.2**，Cordis **4.0.4**。真实提供商接入、评分策略及效果收益尚未验证。

## 安装与试用

1. 在原生插件管理中安装构建生成的 `irishwei-dsh-router-0.3.6.tgz`，启用插件。
2. 打开原生设置中的 **DSH Router → 连接与模型**，检查两个模型的启用状态、能力及兼容性置信度。取消勾选或移除的模型不会收到新的请求。
3. 在 **路由与预算** 开启自动路由，可固定 `Controlled fixture` 或 `Controlled tools fixture`。发送 `Reply ROUTER_OK`，本地模型返回 `ROUTER_OK`；**任务记录 → 刷新任务记录** 可查看实际 provider/model、结果、配置版本及时间线。
4. 只启用 `Controlled tools fixture`、解除固定，并使用没有原生待执行选择的会话发送 `Reply POOL_B`，自动请求会选择该模型。模型池为空时暂停并说明原因。
5. 运行中修改设置会显示 **待生效**，当前请求保持其有效配置，下一稳定请求使用期望版本。移除当前模型不会改变已开始的流；后续请求遇到失效固定模型会暂停。
6. **暂停自动路由** 后仍能管理设置，任务沿用有效原生模型选择。Router 池内已禁用或移除的模型仍被阻止。重启保留启用池、固定、开关和记录；升级从 0.1.2 保留原有暂停状态、配置版本和任务历史。
7. 发送 `[router:fail]` 验证本地连接故障与任务暂停；随后发送 `Reply RECOVERED` 可进行新任务。

可控模型只产生本地 fixture 响应；不会连接模型服务或产生真实费用，token 也是固定测试数据。响应完成的验收状态保持“无法确认”。插件不读写 Codex 配置或认证。

自动选择保留仍有效的上一模型，否则使用启用池中的首个候选，不进行评分或付费检测。固定模型不可用时暂停；与原生待执行选择冲突时保留手动意图，提示解除固定或在原生菜单选择固定模型。原生选择在组装过程中变化会暂停该步，避免提示词、通知和请求不一致。

0.2.1 修复派发前等待窗口：请求虽然已组装，等待期间目标被禁用或移除时，公开流入口仍会重新检查启用池并暂停。构造流迭代器不构成派发；通过 Router 检查并开始下游消费后，当前流保留原身份，不因随后修改而中断或换模型。固定或自动开关改变仍等待下一次完整组装，不影响有效旧快照的原生重试。

两个 fixture 的文本及本地协议兼容性已知；工具能力分别显示已知与声明，图像能力分别显示不支持与未知。未知图像能力不会被当作支持；本地候选收到图像任务时不会发送模型请求。宿主可能在任务进入前直接拒绝已知不支持图像的原生选择。工具等待验证依赖测试注册的工具，插件不向桌面安装等待工具。

DSH rc.2 存在原生边界：再次选择当前同一个模型时，下次请求可能不产生新 header，原生 pending 会继续保留。Router 不伪造消费，也不写私有选择状态。此时改变固定模型可能暂停；在原生菜单选择与当前 header 不同且有效的固定模型，实际请求产生新 header 后可恢复。`node scripts/reproduce-same-route-pending.mjs` 使用隔离目录重现此行为。

输出达到 token 上限、步骤被阻止或请求被取消时，记录保留部分输出及暂停原因。宿主进行请求重试时，每次调用独立保留状态和已报告用量。存储写入失败会暂停自动路由，设置操作报告保存失败；后续排队的旧配置不会覆盖此前持久化状态。

Host 保存状态至 **DSH_HOME/router/PROFILE/state.json**。页面不是执行状态来源。停用插件会释放可控 provider 和管理客户端；已记录的本地状态保留，再次启用后可查看。不要停用后继续选用已释放的可控 provider，应在原生会话菜单选择仍可用的模型。

## 任务预算与账本

**路由与预算 → 新任务预算** 可设置 token、耗时和按币种/口径分开的金额上限，留空表示不限。预算默认不限，不自动开启真实付费请求。保存影响新任务；已运行任务保持原预算。预计下一次本地 fixture 调用需要 12 token，超限会在原生请求头和模型派发之前等待。点击 **刷新任务记录** 查看等待任务，再增加 token、秒数或适用币种的金额，扩展后沿用同一 task/turn/step 和原取消信号；选择停止则取消该 Task 仍运行的原生 turn 或辅助调用，保留历史与已报告消耗。

**任务记录** 显示输入、输出、缓存读/写、推理和完整 token 总数、任务耗时、逐调用归属、预留与结算。不同币种、API 计算费用、订阅参考价值和本地 fixture 参考值各自显示。报价快照保留完整连接/账号/计费来源、来源说明、日期、币种、费率、推理是否包含于输出及置信度。金额由实际报告用量计算，全部标为估算且账单未确认；不会把参考价值说成现金支出。没有报价时费用保持未知。当前没有官方价格或真实账单接入。

Host 的公开 `router/setPriceQuote` 设置命令接受 provider、model 和报价；当前按已知本地身份或明确标为未知来源的原生身份保存，不能借报价授予连接或调用权限。本地模型只接受 `fixture-reference` 口径，所有试验报价均为明确声明的算式测试数据。连接注册与官方价格发现由后续票实现。

失败或中断调用已报告的用量仍结算；缺失用量、缓存费率、推理重叠或完整价格时保留未知及已知部分。不完整金额预测仍把当前调用和其他并发预留的同币种、同口径已知下界计入预算，完整金额保持未知。原生模型没有可信的调用预测时不能完整执行对应 token/金额预测上限，页面显示限制；耗时只能在下一调用前检查已耗用时间。实际响应可能超过预留，账本会报告越估算，不承诺请求端或账单的绝对硬上限。

原生 `steer` 补充按已认领消息归当前任务；`queue` 输入属于后续 turn 和新任务。预算等待不取消 signal，取消后不存在公开的原 turn 恢复入口。0.3.1 在允许下游请求前持久化可能派发的意图，写入失败不进入 adapter；写盘等待结束后再次检查原 signal、模型资格和原生待执行选择。重启中的未完成任务标记 `HOST_RESTARTED`，不自动重复请求。只有可能派发意图、或 0.3.0 中无法证明未发送的已确认 header 时，保留未知消耗，页面明确说明实际发送无法确认。0.3.2 同时纠正旧 Host 已重启并保存为 `HOST_RESTARTED/not-dispatched/header-confirmed` 的模糊记录，保留原身份、报价和预算；有明确未发送证据的记录仍为零。跨取消/重启恢复属于 T18。

0.3.3 为原生标题生成分配独立 `auxiliary` Call，并保存 `nativePurpose=session-title` 和公开源事件/消息序列。标题与主请求各产生12个 fixture token 时，Task 共计24；标题也受同一预算约束。主 turn 完成后，所属辅助调用仍在途或等待预算时 Task 保持活动，扩展或停止仍生效，主结果保留。标题原 signal 在预算等待中保持不变；派发时将它与 Router 的 Task 停止信号合成，取消其中任一个均中止所属调用。旧标题延迟消费、同会话下一 turn 已运行时仍归原 Task，不按最新会话任务猜测。

0.3.4 保留主产物和原生完成事实，但辅助请求失败时 Task 暂停并显示原因。标题预算等待后撤销模型显示 MODEL_REMOVED；外层中间件在流消费前拒绝或关闭时释放未发送归属，不等待 deadline 取消。正常延迟消费仍保留原 Task；已入流后提前关闭保留报告 usage，未报告消耗保持未知。Router 通过 Cordis 公开服务读取 hook 为 plugin 的 ctx.llm.stream 提供读取范围内的 facade，不赋值或修改原生服务。缓存裸服务或 ctx.get('llm') 绕过该完整生命周期边界的辅助请求会在传输前以 AUXILIARY_LIFECYCLE_UNAVAILABLE 拒绝并记录原因；显式 Host 协作者使用 streamReservedCall，并消费或明确 return/throw 关闭返回的流。

0.3.5 同时关闭外层中间件手动 `next()` 后遗弃的所属内部流。已经观察到的 usage 即使没有转发给最终消费者也会结算；只收到文本前缀则保留未知消耗。标题和显式咨询的外层拒绝、结束、停止或取消均保留主结果并结束所属 Call，其他调用的持久化意图保持原归属。评审等调用还在 `reserveCall` 等待预算、尚未返回 callId 时，停止或原 signal 取消由统一入口释放未发送预留，调用方无需补结算。预留和请求归属使用原 signal；adapter 接收原 signal 与 Router 停止信号的合成，取消原因保留。

0.3.6 将尚未绑定流的并发预留也纳入 Task 生命周期。主 turn 已完成时，正在写盘、等待预算或已返回 callId 的预留仍保留同一 Task 的扩展和停止入口；扩展后可绑定原 Call 并结算。停止、原信号取消或停用会释放未发送的预留，随后绑定的 runner 被拒绝。旧 Task 停止不会取消同会话下一 turn。Host 调用方在预留成功后应绑定并消费或关闭 runner，或者取消其提供的原信号；原生请求与 runner 精确接管绑定后的取消责任。

只有公开源事件能证明归属的自动辅助请求才可发送。当前验证首消息标题；手动刷新已结束任务的标题、没有可信来源映射的压缩或其他辅助调用会在传输前阻止，`blockedRequests` 和设置页显示 `AUXILIARY_TASK_UNAVAILABLE`。未修改原生功能设置，也未验证成功压缩。旧0.3.1/0.3.2的无精确所有权 v1 标记可能被辅助失败清除；模糊重启记录升级后保留未知，不把旧 `blocked` 当作未消耗证明。新调用使用 `durable-intent-v2`。

## 开发验证

```powershell
npm ci --ignore-scripts
npm test
npm run build
npm run check
npm run bundle
```

`npm test` 使用目标版本的真实 Cordis、AgentLoop、LLM、Session、原生 SessionController 与 ModelSelection 公共接口，通过完整任务观察结果；外部模型仅用可控 adapter。自动路由不创建 Framework 实例，不改写全局默认。T02 同时核对实际提示词变量、切换通知、请求 header 和原生选择投影。桌面安装/加载证据另见 `docs/implementation/t01-host-evidence.md`；T02 自动化证据见 `docs/implementation/t02-host-evidence.md`，实际安装宿主的页面、公开 RPC 任务及重启证据见 `docs/implementation/t02-desktop-evidence.md`。

客户端回归通过实际 rc.2 Slot renderer、Typert registry 和 API gateway 挂载设置页，检查任务显示、暂停 RPC、卸载和重新启用；仅 Connection 传输与 DOM 挂载使用测试边界。`node scripts/reproduce-client-mount.mjs` 可输出挂载错误、RPC endpoint 和渲染树。0.1.2 修复设置项访问 `remote.router` 时遗漏 Cordis 依赖声明导致的空白页，已在实际目标桌面确认恢复。

跨票公共记录保留 task/session/call 身份、完整连接与计费来源 selection、请求配置、Router 配置快照、配置版本、执行状态与独立验收状态。后续判断、执行、评审、咨询、retry、redo 使用 Host-only `await reserveCall(taskId, details, signal)`，再消费 `streamReservedCall(taskId, callId, request)`：该入口精确绑定一次请求、验证 provider/model 和原 signal、await 持久化意图、派发并按实际报告用量自动结算；调用方不另行 persist 或 settle，不需要给 request 添加 sessionId，也不得把 Router purpose 写成 DSH purpose。它不暴露为 RPC，不授予模型授权。原生执行自动走同一底层预算、持久化意图与结算规则。低层 `persistDispatchIntent` 必须 await，只有可能派发意义，不能代替请求所有权绑定。原生流派发前同步复查 pending、资格和 signal；显式协作者也须保留自己负责的最终原生选择检查。限制记录使用 `{resource, currency?, kind?, reason}`，客户端按字段展示。当前实际覆盖执行、原生 retry 和有源事件证明的标题辅助调用；其他策略由后续票实现。T03 自动化证据见 `docs/implementation/t03-budget-evidence.md`，目标安装宿主由集成分支另行验收。
