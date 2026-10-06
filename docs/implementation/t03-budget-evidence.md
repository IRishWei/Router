# T03 任务账本与预算自动化证据

目标：Windows DSH Desktop 0.2.0-rc.2、Cordis 4.0.4、Host protocol 4。版本 0.3.0，工作分支 codex/router-t03 从集成 189418b 创建，提交前已合并集成 0d0295e。T01/T02 已完成目标宿主验收，本页覆盖 T03 的自动化完整任务与真实 Renderer/RPC；0.3.0 的目标安装宿主验收由 root 单独记录，不把本页当作已安装的证明。

## 行为与共享入口

任务在真实 turn/start 创建，steer 和 queue 的归属取自公开 agent/inbox/claimed 的 turn 与消息/request 身份。所有调用保留完整 selection（connectionId、accountId、billingPath、provider、model）、taskId、独立 callId、purpose、稳定配置版本、真实 header/attempt、报价与预留。自动路由不写原生全局默认。

Host-only reserveCall → markCallDispatched → settleCall 是统一预算/账本入口。可声明 assessment、execution、review、consultation、retry、redo；这只是公共契约，不产生尚未实现的策略。当前执行和原生 loop retry 实际走相同入口。调用前持久化预留、等待预算，真正消费下游流时记录派发，结束时按报告用量结算。并发预留在结算前仍计入预留总数；结算释放后唤醒同任务等待方再检查。未来调用必须沿用该入口，不得另建预算。

公开预算命令为 setBudgetDefaults(budget)、extendTaskBudget(taskId, extension)、stopTask(taskId)。默认各项不限；修改默认只影响新任务。扩展只能增加仍活动任务的明确上限，保存成功后释放等待，不替换 signal、任务、turn 或 step。停止通过原生 Agent.cancel，属于取消；不能把取消说成可恢复等待。等待期间持久化失败会拒绝等待，使 native turn 终结并显示 STATE_WRITE_FAILED，避免等待泄漏。

价格按完整 selection 绑定，稳定组装时捕获，后续改价不重写已预留或历史调用。公开 setPriceQuote(provider, model, quote) 当前只派生已有本地身份或明确未知来源的 native 身份；报价不授予身份或推理权限，后续连接票必须提供真实连接身份和报价依据。本地模型只允许 fixture-reference。价格包含来源、实际日历日期、币种、口径、每百万 token 费率、推理重叠关系与置信度；账单始终 unconfirmed。没有账单或官方报价证据。

## 完整任务验证

测试运行真正的 rc.2 SessionController、AgentRegistry/Loop、ModelSelection、Session、Projections、SystemPrompt、LLM 与工具服务。外部模型传输、等待工具、文件系统故障是受控边界；无网络、API key、订阅登录或付费请求。任务从公开 create/selectModel/prompt 准入，观察公开 Router snapshot、真实 header、任务结果和投影，不直接调用模型或写私有 Host 状态。

| 场景 | 结果 |
| --- | --- |
| 单次完整任务及算式 | input=8、output=4、cache/read/write/reasoning=0、total=12。声明 fixture 报价 input=2、output=6 每百万，参考值 USD 0.00004；源码测试已先红于缺少 setPriceQuote，再绿。报价来源/日期/币种、12 token 预留和实际结算保留。 |
| token 超限/扩展 | token 上限 10，预留 12，原生 header 尚无、账本派发数 0；增加 2 后原 task/turn/signal 完成，扩展历史和上限 12 持久化。红于缺少预算命令，随后绿。 |
| cache/reasoning 与币种 | 首次 input100/output80/cacheRead20/cacheWrite10/reasoning30/total210。推理包含输出，不再次计价；USD 0.00073。工具后下一 Call 为另一完整身份与 CNY 0.00008；任务 total222。没有合计币种，旧报价不被改价覆盖。越估算先红于缺少标识，再绿并记录 tokens/money。 |
| 停止预算等待/流 | 等待时停止，零 header、零派发，预留释放。流中停止保留 PAID_PREFIX 和 7 token；缺价费用未知，终态 BUDGET_STOPPED。响应名为 fixture 标记，不是付费证明。 |
| 原生失败重试 | 同任务三次 Call 为 execution7、retry未知、retry12。已知部分 19、完整 total=null、未知调用1，USD 已知部分0.000062且完整金额未知；不把失败未知当零。保持独立 attempt 与统一 accountingEntry。 |
| 补充与排队 | 工具执行中 steer CORRECTED 被当前 turn 认领；当前 Task 两次 Call/24 token。queue NEXT_TASK 进入后续 turn/new Task，消息/request 身份可追溯。红于缺少已认领输入记录，随后绿。 |
| 金额超限/扩展/重启 | 预留 USD 0.00004，fixture-reference 上限0.00003等待，扩展0.00002后同任务完成。等待期间改价为0不重写预留；重启读取原参考金额0.00004、扩展历史、上限0.00005。 |
| 预算等待期间撤销 | 固定 B 等待时移除 B，扩展后现有惰性 guard 阻止下游，零派发、MODEL_REMOVED、旧配置/身份保留；Call 不被误算为已耗用。派发数修正先红于账本错误计入未发送 attempt，再绿。 |
| 预算等待期间改 native pending | 原 A 已组装，等待期间选择 B；扩展后暂停 NATIVE_SELECTION_CHANGED，零下游，pending B 保留。先红于仍派发旧路由，再绿。也在惰性流边界再次检查，保持 T02 选择所有权。 |
| 扩展保存失败 | 文件系统 fault 导致扩展未持久化，RPC 报错；等待 turn 结束，STATE_WRITE_FAILED，无 header/result。先红于等待卡住，再绿。 |
| 耗时预算 | 0 秒上限在下一调用前检查已耗用时间并等待，显式增加60秒后同 Task 完成，保留任务/Call 耗时；下一次模型持续时间仍未知并显示限制。 |
| 真实配置客户端 | 原生 Renderer/Cordis/Typert/gateway 挂载同一服务。页面保存 token10，执行原生任务并刷新显示预算等待，增加2后同 Task完成、账本显示12 token/USD0.00004/来源日期/账单未确认。再保存0、停止下一 Task并检查 BUDGET_STOPPED。缺价且设 USD 金额上限时完整任务保留未知，实际页面显示缺价、费用未知、金额限制无法完整执行。初始红于预算输入缺失，随后绿。 |

客户端仅替换 JSON Connection carrier 和 DOM 挂载；字段、namespace、codec、RPC 返回及 Host 预算没有另一份伪造实现。用户已明确禁止 Computer Use，因此全部开发和验证使用代码/CLI/公开 Host API，无鼠标截图验证。目标安装宿主仍需 root 安装包并调用公开 HTTP RPC。

## 记账与可执行限制

- 输入是 uncached input；cacheRead/cacheWrite 单列，不重复作为输入追加。reasoning=included-in-output 时只展示子项，不增加费用；separate 才按独立费率，unknown 重叠关系不能完整估价。
- usage、total、缓存计数或适用费率缺失保持未知；提供商完整 total 优先，只有各输入/输出项和零推理都明确时才可派生总数。普通状态仅保存所需计数和报价字段，不保存凭据。
- 金额按币种和 api-calculated/subscription-reference/fixture-reference 口径分别累计，没有可信换算不合并。实际已报告用量算式仍是计算值，不是已确认账单。
- 缺价、native 未知预测、先前未知用量、不同币种等限制在 budget.unenforceableLimits 与客户端显示，只能检查已知部分。预测和服务端输出限制不是绝对账单硬上限；越估算记录真实用量。耗时采用记录时间差，下一调用持续时间不明，检查已耗用时间；不宣称能强制终止已派发请求。
- 已发出的调用保持原身份/快照；预留释放后仍复查当前池和 pending。自动暂停不绕过本地模型资格。未来 provider 内部 HTTP retry 可能不被 loop retry 观察，T05/T09 必须独立记账或限制，不据本票声称覆盖。
- 未完成任务重启标记 HOST_RESTARTED，释放未派发预留、不重放请求。跨取消/重启恢复及新 native turn 到原 taskId 的映射留给 T18。

## 验证与未完成项

新增 11 个完整任务测试和1个实际 Renderer/RPC 测试；连同既有28项，npm test 共40/40，npm run check、npm run bundle 和 git diff --check 通过。既有“运行中存储失败”测试改为外部流已经开始后再触发磁盘故障，继续验证部分输出保留；新的派发前/扩展持久化失败测试覆盖不会发送的场景。package bundle 交给 root，目标桌面安装、公开 RPC 与持久化验收/独立双轴复审完成前不关闭 #4。

本票未认证真实提供商授权、官方报价/账单、隐式 provider 内部重试、协作策略效果或整体实验预算。未启动 paid calls，不改变父规格或关闭后续票。

交付包：artifacts/irishwei-dsh-router-0.3.0.tgz；SHA256 `F0509C7D51F49B5083975E7DDACB1369CC3C87B43914623B9E8107D6E91177F0`。包包含 Host、ledger、protocol、客户端 codec、patch、README 和 LICENSE，不附带第二份 Framework 或安装脚本。
