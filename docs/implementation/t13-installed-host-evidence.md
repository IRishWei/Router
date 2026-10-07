# T13 实际桌面安装证据

2026-10-07，Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`、Cordis 4.0.4、Host protocol 4。官方 CLI 在专用 `desktop-validation-home` 安装 Router 0.6.1 和独立本地评审 companion 0.2.1，再由公开 PluginManager 激活。使用公开 RPC、真实 Controller/ToolRuntime 与实际桌面自带 Node 24.18.1/Electron 44.0.0；未使用 Computer Use、真实 API 或账号凭据。

最终代码 `5fcdade471ca3a6acb6972e9a0352f65e06fe565`，非作者集成 `5bcd0d9e9928322c9b944a5889c5dcdbf6f3da81`。Router 包123950字节，SHA-256 `C806B363746863CBDCBA5A994688C01E4912916265E8B2F6DA6E18701E5E16A6`；companion 包1747字节，SHA-256 `1EBA4D9B4D623EEE951883FAF114027EA65E741E17C880CC0102D3FFB1D9BDF6`。安装的9个模块与作者构建字节一致，集成根目录经 CRLF/LF 规范化后文本一致。Host SHA-256 `3C27A158F5688033710A4CEF9AA13059E354044C5A9DC8C5284BC06451F79999`，Renderer SHA-256 `6418F754B621D8CDE773FC3935EEEC1E94177213E8F5D1C674E5AA4275A88934`。0.6.0诊断包未安装。

最终一次验收20项全部通过：

- 总开关关闭时零验收；写作明确通过、失败、部分覆盖，以及引号内句号和重复字面结构顺序。
- 未指定程序产物时不检查；真实 Node 项目测试通过，故意减法实现测试失败而构建通过，整体仍失败；目录 junction 指向工作区外时拒绝且零工具执行证据。
- 显式跨模型许可下，严格匿名评审1个 Call通过，高风险冲突2个 Call后无法确认；未允许跨模型时零评审 Call，普通非评审 fixture 的无效 JSON最多2个 Call且无法确认。
- 6000字符完整正文超预留时 `REVIEW_INPUT_FORECAST_EXCEEDED`；64容量候选为 `REVIEW_CONTEXT_CAPACITY_EXCEEDED`；未知容量为 `REVIEW_CONTEXT_CAPACITY_UNKNOWN`。三者均保留产物、零评审 Call。
- 24 token预算下评审等待而未派发；扩展8192后原Task/Call继续，停止或候选撤销则未派发并暂停，原产物及无法确认状态保留。评审与执行同账本，整个Task最多2个评审Call。

临时 companion 的通过/冲突为明确预设的本地协议响应，每个 Call返回8 token用量。它证明真实请求、严格JSON、预算及冲突行为，不证明自然语言质量。主执行始终固定为 controlled-tools，评审不能替换它；全局默认保持 router-controlled/controlled。Node子进程无shell、隐藏窗口，明确 `ELECTRON_RUN_AS_NODE=1`，真实退出码、文件/输入/输出hash写入证据。

升级前98条完整 Task记录逐对象保留，最终118条完整记录（含失败、未知和暂停）保留。恢复原预算、自动路由、固定选择、池顺序和新验收策略默认关闭；配置版本212递增至244，storageError=null。临时companion经公开PluginManager移除，config/tasks/default均未改变；随后重启，118条Task、完整配置、全局默认深比较一致。最终专用进程PID27944，每次停止/重启核对PID、启动时间、exe及专用home。

原始证据在 `C:\Users\a1500\AppData\Local\Temp\router-implementation`：`t13-v061-before-upgrade.json`、`t13-v061-execution-evidence.json`、`t13-v061-restored-state.json`、`t13-v061-restart-evidence.json`、`t13-v061-bundle-{enable,remove}.json`、`t13-v061-artifact-hashes.json`、`t13-desktop-node-runtime-evidence.json`。含临时认证信息的私有日志不提交。受控通过仅适用于已检查的明确要求，不是整体质量或效率保证。
