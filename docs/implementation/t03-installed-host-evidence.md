# T03 安装宿主与重启验证

2026-10-07，实现 `b43888c`、集成 `8145666`，安装 `@irishwei/dsh-router@0.3.2`。目标 Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`、Cordis 4.0.4、Host protocol 4。安装验证发现辅助请求串用执行 Call，最终验收暂停，见末节。

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

独立双轴复审及旧版本真实崩溃→旧重启保存→升级→再重启全链见 [审查记录](t03-review.md)。统一入口为 `await reserveCall` → `await persistDispatchIntent` → 下游调用 → `settleCall`；持久化意图不是实际发送证明，调用方仍需最终同步资格和原 signal 检查。

上述四项公开 RPC 与重启深比较通过，但尚不满足 T03 最终验收。T05—T11 的授权、真实 API、账单和提供商内部 HTTP attempts，T18 的跨取消恢复，T21/T23 的真实实验与许可仍由各票验证；不关闭父规格或宣称整体路由收益。

## 阻断最终验收的实际差异

三个新完成任务的执行 Call 均为 `status=completed`、12 token、`dispatchStarted=true`，但 `dispatchIntent=blocked`，重启后仍原样保留。公开 PluginManager 库存核对仅安装一个 Router；完整 Desktop 同时启用原生标题生成插件。原始 RPC 脚本只读取快照，未改写 Call 或持久化文件。

公开安装模块源码与独立完整任务复现确认：原生标题请求在主请求旁并发生成，Router 按 session 复用执行 Call，第二入口拒绝时清掉首个入口的意图。这还可在主调用已进入、尚无 usage 时落盘并崩溃，导致重启错误归零；详见 [独立审查](t03-review.md)。由原实现者修复并补充真实标题服务集成测试，再重新打包、安装、核对辅助消费及重启。#4 暂不关闭。
