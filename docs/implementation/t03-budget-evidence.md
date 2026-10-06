# T03 任务账本与预算自动化证据

目标：Windows DSH Desktop 0.2.0-rc.2、Cordis 4.0.4、Host protocol 4。当前版本 0.3.3；工作分支 codex/router-t03 从集成 189418b 创建，初次提交前合并 0d0295e，0.3.1 审查修复时合并 9e553fa，0.3.2 提交前合并 ae9c945，0.3.3 修复合并47561d4。T01/T02 已完成目标宿主验收，本页覆盖 T03 的自动化完整任务与真实 Renderer/RPC；各版本的目标安装宿主验收由 root 单独记录，不把本页当作已安装的证明。

## 行为与共享入口

任务在真实 turn/start 创建，steer 和 queue 的归属取自公开 agent/inbox/claimed 的 turn 与消息/request 身份。所有调用保留完整 selection（connectionId、accountId、billingPath、provider、model）、taskId、独立 callId、purpose、稳定配置版本、真实 header/attempt、报价与预留。自动路由不写原生全局默认。

Host-only await reserveCall(taskId, details, signal) → streamReservedCall(taskId, callId, request) 是0.3.3协作者统一预算/派发/账本入口；runner负责绑定一次请求、await意图和实际结算，不另行 persist/settle。可声明 assessment、execution、review、consultation、retry、redo、auxiliary；实际策略不因此被实现。当前执行、原生 loop retry 和有来源的辅助调用走相同底层 reserve/persist/settle。低层persistDispatchIntent沿用reserve保存的原signal，只证明可能派发，不替代精确请求所有权。原生流在await后同步复查pending、资格和signal；显式调用方保留自己负责的最终原生选择检查。并发预留结算前仍计入预算，释放后唤醒同任务等待方复查，不另建预算。

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
- 未完成任务重启标记 HOST_RESTARTED，释放预留、不重放请求；可能已派发的意图及旧版本中缺少派发屏障的已确认 header 保留未知消耗，不能根据 dispatchStarted=false 推导零。仅有明确等待、未发送或新协议尚未写入意图的记录才排除实际消耗。跨取消/重启恢复及新 native turn 到原 taskId 的映射留给 T18。

## 验证与未完成项

0.3.0 新增 11 个完整任务测试和1个实际 Renderer/RPC 测试；连同既有28项，当时 npm test 共40/40，npm run check、npm run bundle 和 git diff --check 通过。既有“运行中存储失败”测试改为外部流已经开始后再触发磁盘故障，继续验证部分输出保留；派发前/扩展持久化失败测试覆盖不会发送的场景。package bundle 交给 root，目标桌面安装、公开 RPC 与持久化验收/独立双轴复审完成前不关闭 #4。

本票未认证真实提供商授权、官方报价/账单、隐式 provider 内部重试、协作策略效果或整体实验预算。未启动 paid calls，不改变父规格或关闭后续票。

0.3.0 交付包：artifacts/irishwei-dsh-router-0.3.0.tgz；SHA256 `F0509C7D51F49B5083975E7DDACB1369CC3C87B43914623B9E8107D6E91177F0`。包包含 Host、ledger、protocol、客户端 codec、patch、README 和 LICENSE，不附带第二份 Framework 或安装脚本。

## 0.3.1 审查修复与红绿证据

Spec P1 的真实 adapter 子进程先复现：旧实现派发标记写盘失败仍进入 adapter 一次；adapter 进入后退出，磁盘 prepared/reserved/dispatchStarted=false 被重启误计为未派发、零调用。修复增加 durable-intent-v1 屏障，持久化可能派发意图失败时 adapter 进入次数为零。adapter 已进入、实际派发标记写入失败后 crash，公开 Host 重启快照保留 interrupted、callCount=1、total=null、unknownTokenCalls.total=1，不重放请求。

| 新增边界 | 公开 Host 结果 |
| --- | --- |
| 意图写盘等待期间撤销模型 | 零下游、MODEL_REMOVED；当前进程确认未进入，账本零消耗。 |
| 意图写盘等待期间改变 native pending | 零下游、NATIVE_SELECTION_CHANGED，新的 pending 保留。 |
| 意图写盘等待期间取消原 signal | 零下游、BUDGET_STOPPED；仍使用 reserveCall 保存的原 signal，没有替换。 |
| 意图已持久化、adapter 尚未进入即 crash | 子进程 adapterEntries=0；重启只知道可能派发，callCount=1、完整 total 未知，uncertainDispatchCalls=1。意图不被显示为实际发送证明。 |
| 已证明未发送但清除意图写盘失败后 crash | 当前进程零 adapter/零消耗；磁盘仍保留 possible，重启保守计入未知，清除写盘失败没有伪装为成功。 |
| 0.3.0 模糊 header 迁移 | 无新协议的 prepared/header-confirmed/dispatchStarted=false 重启为 interrupted/未知；明确终态 not-dispatched 保持零；旧字符串限制在存储边界迁移为对象。 |

Spec P2 的两个完整任务测试分别先红于当前调用和另一并发预留的部分金额被当作零。修复按相同 currency/kind 计入 amount 或 knownSubtotal：当前预测完整 amount=null、已知下界 USD 0.00026 在剩余额度零时等待；另一预留的已知下界 USD 0.00026 与当前 USD 0.00002 一起参与判断。扩展后同一任务完成，amount 仍保持 null；引用价为有来源的本地 fixture 算式数据。

Standards 的结构化限制修复使用 {resource, currency?, kind?, reason}。真实 rc.2 Renderer/RPC 测试从公开快照验证对象字段并检查缺价/金额无法完整执行的页面说明；客户端不拆分编码字符串。历史字符串兼容仅在持久化读取边界处理。

这些新增测试仍通过 SessionController 完整任务、真实 adapter 与公开 Router snapshot 验证；子进程仅控制本地磁盘故障和退出，迁移 fixture 仅还原旧记录形状。没有网络请求、真实凭据、付费消费或 Computer Use。persistDispatchIntent 的 await 契约供 T12/T16 等 Host 调用方衔接；native pending 的最终检查由调用方所在原生流拥有，不扩展 T18 恢复范围。

0.3.1 新增10项派发/迁移/部分金额完整任务测试，真实 Renderer 测试更新结构化限制断言。最终 npm test 50/50；npm run check、npm run bundle、git diff --check 通过。交付包 artifacts/irishwei-dsh-router-0.3.1.tgz，SHA256 `26D6719FEC6710011AA65C8B7AA9FE530B99F48C0AD794558BD441EF7E6690C6`。本页不声明0.3.1已安装、已通过独立复审或已关闭 #4。

## 0.3.2 旧 Host 已保存重启记录的迁移

新增 Spec 回归使用真实0.3.0源码（集成9da3681）完整链路：本地 native adapter 进入1次，派发标记写入 EIO 后进程退出；旧 Host 重启误判 paused/HOST_RESTARTED、Call not-dispatched/header-confirmed、callCount=0/total=0，再经公开 setAutomatic 保存。0.3.1 升级仍误判为零，新增公开 Host 迁移测试先红于 not-dispatched 未变为 interrupted。

test/fixtures/t03-legacy-restarted.json 是上述真实旧 Host 保存的状态，另包含有来源的本地算式报价和预算默认，用于验证原身份、快照、报价及预算不被重置。正常回归直接加载这份记录，不依赖旧 Git 源码存在。修复仅识别无新 dispatchProtocol 且由旧 HOST_RESTARTED 留下的已确认 header 模糊记录；公开快照保留 interrupted、callCount=1、total=null、未知 token/金额调用1。公开保存并再次重启仍保持该纠正，不重放。

同一回归验证明确预算等待/proposed、旧重启 proposed、模型撤销产生的未发 header，以及新 durable-intent-v1 blocked 记录仍为零。没有重置 task/session/call 身份、配置版本、selection、输入、起止时间、报价、Router 快照、预留或预算扩展历史。真实旧源码全链另行复跑，修复后的 Host 升级公开快照同样显示 interrupted/未知。

Standards 的命名修复将 Host-only markCallDispatched 改为 persistDispatchIntent；绑定、原生流、测试调用与当前文档均使用新名，没有误导别名。它只持久化可能派发意图，必须 await；实际下游开始仍由原生流最终同步检查后记录。

最终 npm test 51/51，npm run check、npm run bundle、git diff --check 通过。0.3.2 交付包 artifacts/irishwei-dsh-router-0.3.2.tgz，87007字节，SHA256 `345BD093967335792875D6BA4F57D2F5A0336FE4CB7B6787E12C52F260C8168E`。没有 Computer Use、真实 Desktop 操作、付费请求或凭据操作；本页不声明最终安装宿主验收或独立复审已完成。

## 0.3.3 实际原生标题并发与所有权

安装Host发现completed/usage12/dispatchStarted=true却intent=blocked。真实rc.2 SessionTitleService、first-prompt provider及共享title-llm在同session发起独立deadline的辅助请求。旧guard按session借用主Call，aux拒绝又清除主意图，既会污染完成记录，也可在主adapter进入且usage未报告时将崩溃重启误计为零。真实3个Title模块完整Task测试先红于主intent=blocked，再绿为两个独立Call/24token；子进程主/辅助在途crash都保留已知12和另一个未知Call，不重放。

辅助source来自公开session/title-llm-request，消息seq映射公开user/message的messageId，再绑定已认领Task inputs；Call保留sourceEventSeq/sourceMessageSeqs。所有权在公开Cordis事件构造边界捕获：官方@deepseek-ai/cordis@4.0.4导出Events接口的src/events.ts:326-351及lib/types/events.d.ts:213-238声明internal/dispatch(mode,name,args,thisArg)，注释其在公共事件交付前暴露event-bus diagnostics；package exports包含该声明及src。Router仅ctx.on观察llm/stream对象身份，不修改args/request/框架状态、不中断或重排next、不访问_hooks。实际core dispatch在waterfall监听器之前发出该事件，因此外层延迟消费和同session排队不能改归属。

native品牌流只取得native Call；非native已绑定stream只取得自己的Call。无派发owner入口不能清除别人的意图。新记录durable-intent-v2包含精确所有权保护，旧v1无此证明。允许的aux单独预留/报价/usage，purpose=auxiliary/nativePurpose=session-title；DSH purpose原样不被Router域purpose替换。调用前使用公开prepareCall，保存安全请求控制字段；停止派发使用原signal与Task-owned signal的合成，预算等待继续使用原signal，无替换或用户凭据。

native turn结束记录nativeLifecycle/nativeEndedAt；Task直到所属owned Call结束才终结。主已完成且title预算等待时可扩展或停止；停止直接唤醒waiter并中止所属派发，不依赖已空闲的Agent.cancel。已知流usage保留，未知不零化；预算等待crash重启保留主12、辅助未发0并标HOST_RESTARTED。公开标题源事件和消息身份绑定使延迟title仍归原Task，队列下一Task仅自己的12，不串账。

显式Host协作者用reserveCall→streamReservedCall；无sessionId的consultation完整Task回归只有1个consultation Call，总共3Call/36token，拒绝异route及重复绑定，不新增aux预留。该runner只暴露Host，不提供RPC任意Call授权。自动捕获当前验证首消息标题；无可信公开来源的compaction/其他aux、已结束Task手动刷新title会在传输前拒绝，bounded blockedRequests和实际Renderer/RPC显示AUXILIARY_TASK_UNAVAILABLE。没有修改native设置；未宣称支持成功压缩。

同step显式consultation在途回归先红于native执行仍prepared、咨询被native认领。修复将agent/request创建的精确Call ID与taskId/turn/step绑定，assistant-stream/start、request/header和原生失败结算只认这一预留；native retry也只参考上一原生预留。咨询延迟至主响应完成后仍无native hostAttemptId，释放后分别12、Task共24。晚标题回归切换下一Task为controlled-tools，先红于旧执行selection被新header改写；精确绑定后旧Call保留controlled。停止旧标题Task而下一原生turn在工具等待的回归先红于下一Task被取消；现仅该Task仍有原生执行时调用Agent.cancel，旧辅助停止直接控制所属Call，下一Task完成并保留自己的24。

新增Title完整Task回归覆盖24token、两次金额扩展至USD参考值0.00008、缺价2Call unknownPrice2、主结束后扩展/停止/原signal取消、辅助流停止保留已报告12、同session下一turn、无安全归属、三种crash重启及显式协作者绑定。目标版本3个title模块固定为0.2.0-rc.2开发依赖；不会打包第二份Host runtime。

历史迁移使用独立复审录制的真实0.3.2输入：test/fixtures/t03-legacy-title-restarted.json，SHA256 `F74753747288E86270A418A9D568A1F703C993B9C90ACE0D878C5D74A81C521F`。来源为集成47561d4/0.3.2及实际三个Title模块：主adapter已进入、标题辅助拒绝清除主marker、flush并退出、旧Host重启误判零、公开setAutomatic(false)保存；录制过程未改Call或持久化文件。旧版本公开Host加载该记录先红：not-dispatched、total=0、unknownTokenCalls.total=0。0.3.3公开Host加载后为interrupted、dispatchUncertain=true、total=null、未知调用1；不会把blocked称为实际已发送。

迁移只将旧无精确owner证明的v1、HOST_RESTARTED、header-confirmed/blocked/not-dispatched记录保守纠正；保留原Task/Call/Session身份、selection、输入、Router快照、版本、报价、预留及预算。已有真实usage的同形记录保留12并且未知调用0，公开保存后再次重启仍保持纠正。预算等待/proposed和新v2有证据的blocked未发记录保持零。正常测试只加载固定fixture，不要求旧Git源码存在；跨取消重放/继续仍属T18范围。

最终npm test 67/67、npm run check、npm run bundle、git diff --check通过；相比0.3.2增加15项真实辅助/显式所有权完整任务测试和1项真实旧输入迁移，已有Renderer/RPC及晚标题回归同步增强。交付包artifacts/irishwei-dsh-router-0.3.3.tgz，90143字节，SHA256 `96C0F63A0B2997DDC7B4AC8FCFE64B8FAF9BC6D9E210F6215DB12B2923B879F5`。所有传输均为本地有界fixture，未用Computer Use、真实Desktop、用户凭据或付费请求。本页仅声明代码/CLI/公开Host自动验收；独立双轴复审与目标安装RPC验收由集成owner完成。
