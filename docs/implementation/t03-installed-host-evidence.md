# T03 安装宿主与重启验证

最新已安装验证版本为 0.3.5，固定实现 `24673cf`、集成 `5a24499`。六个新完整任务及重启验证通过，详见末节；独立复审另发现并发未绑定预留失去预算扩展/停止入口的遗漏，当前仍不满足最终验收。旧版本的缺陷与验证保留作为修复依据。独立代码复审结果记录在 [审查记录](t03-review.md)。

2026-10-07，实现 `b43888c`、集成 `8145666`，安装 `@irishwei/dsh-router@0.3.2`。目标 Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`、Cordis 4.0.4、Host protocol 4。该轮安装验证发现辅助请求串用执行 Call，未作为最终验收。

通过官方 `dsh plugin --profile desktop add` 更新已有独立验证 home。包 SHA256 为 `345BD093967335792875D6BA4F57D2F5A0336FE4CB7B6787E12C52F260C8168E`；安装 Host 与构建产物 SHA256 同为 `20676156410DC0C728DE0C4263734AFF73A17FF1C2BFA8FBE4B697A88E4D8C93`，客户端同为 `FDB2F18A8B0E2460CA28058215129CA84D605DD1E3B6ADDA645129AF357E7B66`。

## 实际任务

所有任务通过安装宿主公开 HTTP RPC 的 `session/create`、`session/prompt` 准入，由同一 `router/snapshot` 核对结果、Call、预算和账本。使用独立进程自己的 launch URL 在内存中交换 cookie，遵守官方 Connection 信封；token/cookie 不打印、不保存到证据，不读取认证文件。没有 Computer Use 或额外 GUI 点击。

开始时保留 automatic=false、固定 B、配置 version=18 及十条历史任务，包括 T01/T02、0.3.0 基础验证和 0.3.1 的一个扩展任务。最终新操作如下：

| 场景 | 实际观察 |
| --- | --- |
| token 等待及扩展 | Task `8b4c1b9a-9075-45b2-82d8-89e05527f022`，上限10、预测12，在真实 header 之前等待，未派发账本数0。增加2后同 task/turn/call 完成 `RPC_BUDGET_RESUMED`；12 token、fixture 参考值 USD0.00004、扩展历史1。 |
| 等待时停止 | Task `18d6e3f4-81b5-4b95-986a-43cf81670929`，上限0，停止后 `BUDGET_STOPPED`，空结果、未派发、预留释放、账本调用数0。 |
| 金额等待及扩展 | Task `c097df04-0ffd-4772-a2c0-12d4dee8f9e8`，fixture-reference 上限 USD0.00003，预计0.00004等待；增加0.00002后同 Call 完成 `RPC_MONEY_RESUMED`，参考金额0.00004，报价来源保留。 |
| 删除报价后调用 | Task `82aea983-4fb3-4fce-90bc-10038427962e` 完成 `RPC_UNKNOWN_COST`；unknownPriceCalls=1，金额保持未知，结构化限制记录指出无法完整执行金额上限。先前已捕获报价的任务仍为 USD0.00004。 |

参考报价为 `fixture:installed-host-t03`、2026-10-07、USD、declared、fixture-reference；输入2/输出6每百万 token，缓存费率0，reasoning included-in-output。各完成 Call 的 input8/output4/cache0/reasoning0/total12；这是受控协议与算式证据，没有真实 API 支出或账单确认。每个任务验收仍为 unconfirmed。

## 重启持久化

完成所有操作并 flush 后，新任务默认恢复不限预算，配置 version=24。仅停止已核对 executable、启动时间和独立 home 的本次 PID3900，以相同 home 和 `Start-Process -WindowStyle Hidden` 重启为 PID36696。新进程公开 RPC 与重启前配置、全部14条任务及 Call、结果、预算扩展历史逐项深比较完全一致；storageError=null，原生默认仍为 A。没有修改全局默认、正常 DSH profile 或 Codex 配置/认证。此处证明独立进程重启，不声称普通 GUI 退出操作。

安全原始证据留在 `C:\Users\a1500\AppData\Local\Temp\router-implementation\t03-installed-host-rpc-evidence.json` 和 `t03-installed-host-restart-evidence.json`；验证脚本为同目录 `t03-installed-host-verification.mjs`。`*.private.*.log` 可能含短期 launch URL，不属于公开证据。

## 验收范围

51/51 集成回归、check 和 diff 检查通过。缓存/推理子项、不同币种、部分及未知用量、原生 retry、steer/queue、越估算、耗时、部分报价及并发预留、存储失败、派发等待撤销/pending/取消、崩溃与历史迁移在真实 rc.2 Controller/AgentLoop 的完整任务中验证。真实 Renderer/Cordis/Typert/RPC 自动化验证界面的保存、等待、扩展、停止及未知文案，见 [自动化证据](t03-budget-evidence.md)。本页没有用 RPC 冒充 GUI 点击。

独立双轴复审及旧版本真实崩溃→旧重启保存→升级→再重启全链见 [审查记录](t03-review.md)。本轮旧手动调用契约已被 0.3.4 的 `reserveCall` → `streamReservedCall` 取代；新 runner 负责持久化、派发前检查与结算，协作者不能重复执行这些步骤。

上述四项公开 RPC 与重启深比较通过，但尚不满足 T03 最终验收。T05—T11 的授权、真实 API、账单和提供商内部 HTTP attempts，T18 的跨取消恢复，T21/T23 的真实实验与许可仍由各票验证；不关闭父规格或宣称整体路由收益。

## 阻断最终验收的实际差异

三个新完成任务的执行 Call 均为 `status=completed`、12 token、`dispatchStarted=true`，但 `dispatchIntent=blocked`，重启后仍原样保留。公开 PluginManager 库存核对仅安装一个 Router；完整 Desktop 同时启用原生标题生成插件。原始 RPC 脚本只读取快照，未改写 Call 或持久化文件。

公开安装模块源码与独立完整任务复现确认：原生标题请求在主请求旁并发生成，Router 按 session 复用执行 Call，第二入口拒绝时清掉首个入口的意图。这还可在主调用已进入、尚无 usage 时落盘并崩溃，导致重启错误归零；详见 [独立审查](t03-review.md)。由原实现者修复并补充真实标题服务集成测试，再重新打包、安装、核对辅助消费及重启。#4 暂不关闭。

## 0.3.4 安装与重启验证

2026-10-07，通过相同官方 CLI 将独立验证 profile 更新为 `@irishwei/dsh-router@0.3.4`。包为 `artifacts/irishwei-dsh-router-0.3.4.tgz`，91,437 字节，SHA256 `8FC8D8805A0D448000337C190C04C78E6D848A1D82F8E9955B3FD779F91A253C`。安装 Host 与根构建产物同为 `ED4EF4EB867DCAEDC1BE71AB80F8F61A38DFA7AB7BD1A9A005D08A9D4DA759C3`；客户端同为 `38BF362EA7BD2EFF6373F5EE2CE5689F5675700DD8A2EF45FFDE6320E2763C50`。

确认旧独立进程 PID36696 的路径、启动时间及 home 后停止；新安装验证进程 PID4772 通过 `Start-Process -WindowStyle Hidden` 启动。全部操作使用该进程的公开 HTTP RPC，保持正常 DSH profile、Codex 配置/认证与原生默认选择不变。自动路由初始仍为 false，保留14条旧任务与配置 version24。

| 场景 | 实际安装宿主观察 |
| --- | --- |
| 主调用及标题分别等待、扩展 | `c338d84a-c14e-409b-a691-5af36d79165f`：token10时主调用未发；增加2后主产物 `RPC_V034_BUDGET_RESUMED`，标题独立等待且主意图保留。增加12后同 Task/turn 完成，两 Call 各12 token、累计24，两次扩展，参考值 USD0.00008。 |
| 零预算停止 | `00672463-58d2-4f49-b437-c1feb5df2054`：调用前等待，停止后 paused/BUDGET_STOPPED、空产物、0次派发、预留释放。 |
| 主完成后停止标题 | `a4603b1b-83f6-45c9-ab94-2ead26bb733c`：保留主产物 `RPC_V034_MAIN_RETAINED` 及已用12 token；标题等待时停止，paused/BUDGET_STOPPED，辅助 Call 未发且预留释放。 |
| 标题等待期间撤销模型 | `57de4389-1b6c-4d24-b137-bebcc6af6792`：移除 controlled 后扩展预算，整体 paused/MODEL_REMOVED；nativeLifecycle=completed，主产物 `RPC_V034_RETAINED_REMOVAL` 与12 token保留，标题未发、预留释放。随后重新启用候选。 |
| 金额预留与辅助调用 | `0cf578d1-39bb-4792-b176-f21e51cfd498`：USD0.00003时主等待，增加0.00002后主完成、标题等待，再增加0.00003后两 Call 完成，累计 USD0.00008，各自保存原报价。 |
| 缺价保留未知 | `46d6cc58-69dc-41e4-976a-cbe5a90125df`：完成 `RPC_V034_UNKNOWN_COST`，两 Call、24 token、unknownPriceCalls=2，金额为空并显示限制不可完整执行；此前任务的已捕获金额不变。 |

新完成 Call 均为 `dispatchIntent=possible`、`dispatchStarted=true`、usage12、reservation settled；不再出现0.3.2执行调用被标题覆盖的矛盾。旧0.3.2已知12 token记录保留历史字段和消耗，不能把修复后的新派发一致性追溯宣称为旧版本行为。

报价为 `fixture:installed-host-t03-v034`、2026-10-07、USD、declared、fixture-reference；输入2/输出6每百万 token，缓存0、reasoning included-in-output。每 Call input8/output4/cache0/reasoning0/total12，仍是受控算式证据，无真实 API 支出或账单确认，任务验收状态仍为 unconfirmed。

所有操作结束后恢复不限预算，配置 version35。仅停止已核对身份的 PID4772，并以相同独立 home 隐藏重启为 PID35108。公开 RPC 将配置、全部20条任务及其 Call/结果/扩展历史与重启前逐项深比较，完全一致；三条新完成双 Call 任务的派发标记一致，storageError=null、原生默认不变。

安全证据为 `C:\Users\a1500\AppData\Local\Temp\router-implementation\t03-v034-rpc-evidence.json` 与 `t03-v034-restart-evidence.json`，脚本为 `t03-installed-host-v034.mjs`。旧证据另存 `t03-v032-*`；短期 launch token/cookie 只在内存使用，私有进程日志不属于公开证据。

根集成回归79/79、check与差异检查通过；完整原生标题、外层中间件拒绝/关闭及早退、原signal、未知/已知用量、同step咨询绑定、并发turn、崩溃与旧状态迁移由真实rc.2完整任务自动化补齐。配置页由真实Renderer/Cordis/Typert/RPC自动化验证，无 Computer Use，不声称进行了额外 GUI 点击。

Host协作者使用 `await reserveCall(taskId, details, signal)` → `streamReservedCall(taskId, callId, request)`；runner绑定一次请求并持久化意图、检查当前资格与signal、结算，调用方不再手动persist/settle。原生标题通过作用域内 `ctx.llm` 生命周期入口及可信消息身份归属；裸服务入口无法观察完整生命周期时明确拒绝，显示 AUXILIARY_LIFECYCLE_UNAVAILABLE。无可信归属的压缩或已结束Task手动标题仍显式阻止，不能宣称成功压缩支持。

T05—T11的授权、真实API、账单与透明HTTP attempts，T18的跨取消恢复，T21/T23的真实实验许可和T24的目标宿主依赖安全处理仍由各票验证；本轮不关闭父规格或宣称整体路由收益。

独立 Spec 审查者逐项核对本页六阶段安全 JSON 及重启深比较脚本，确认这些观察成立；另以公开完整任务复现外层中间件消费已报告用量后终止的遗漏。该窗口不在本次六项正常安装操作范围内，修复与最终安装证据完成前 #4 保持打开。

## 0.3.5 安装与重启验证

官方CLI更新相同独立home为0.3.5，固定实现 `24673cf`、集成 `5a24499`。包92,517字节，SHA256 `EA41C65E3062F443D2CF0ED3B86E4234F26D35412EBF8A4200F9A2B454811FEC`；安装Host与根构建同为 `D310C6D81A62B97B8C2C26715ECC9492D82AB8BD6D9190F1F2DE2AB42782ECAE`，客户端同为 `38BF362EA7BD2EFF6373F5EE2CE5689F5675700DD8A2EF45FFDE6320E2763C50`。

确认并停止旧独立PID35108，新安装进程PID41140；验证后按同样身份检查停止并隐藏重启为PID1316。沿用公开RPC六场景，marker/报价来源版本更新为V035/v035，主及标题各12、共24 token，金额USD fixture-reference0.00008，缺价2次未知；零预算停止、主产物保留的标题停止和MODEL_REMOVED暂停均成立。

| 场景 | 新Task ID |
| --- | --- |
| 主及标题token等待、扩展 | `61cb05bc-1ae3-4d0c-9e86-0829ab870f3c` |
| 零预算停止 | `0672eed2-c835-4cc3-bd9f-aa66f105b781` |
| 主完成后停止标题 | `e855bd30-e30a-4f69-823b-d91261a6c227` |
| 标题等待期间撤销模型 | `6c24710c-ef00-44cd-a88d-77636230466e` |
| 金额等待、分别扩展 | `043dc622-3ed8-4d86-8d3b-65d35e2a16f5` |
| 缺价保持未知 | `1a7521c7-1429-486e-8d21-b8441ce643b8` |

重启前配置恢复不限预算、version46，原20条历史加6条新任务。公开RPC对配置、全部26条Task/Call/结果/扩展及原生默认深比较相等，新完成Call均possible/started=true，storageError=null。安全证据为同一临时目录 `t03-v035-rpc-evidence.json`、`t03-v035-restart-evidence.json`，脚本 `t03-installed-host-v035.mjs`。

根94/94回归与check通过，原外层隐藏usage关闭及review取消窗口已独立复验；新增并发reserve在主turn结束前尚未绑定runner的Task保活遗漏仍待0.3.6修复。因此本轮安装正常路径证据成立，尚不关闭#4。全程无CU、真实API支出、正常profile或Codex认证改动。
