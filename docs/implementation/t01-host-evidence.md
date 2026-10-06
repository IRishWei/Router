# T01 宿主接入与验证证据

日期：2026-10-07。T01/#2 已通过目标 Windows Desktop 的安装、页面、完整可控任务、暂停、停用/重新启用及进程重启验收。自动化与真实桌面证据分别记录如下。

## 实际目标与接入依据

只读分析实际安装的 `E:/Program Files/DeepSeek Harness/resources/app.asar`：Desktop / DSH **0.2.0-rc.2**，build `04f392c9ddd144fa426da2045178797da6db6c11`，Cordis **4.0.4**，Node **24.18.1**，pnpm **11.7.0**，host protocol **4**。

源码指针均相对于 ASAR 的 `dsh/node_modules/@deepseek-ai/`：

- `dsh-agent-loop/lib/index.js:1179`：`agent/request` waterfall 在 `llm.prepareCall()` 与 durable request/header 前执行。插件 await next，返回完整 config，不在 llm/stream 替换已绑定 adapter。
- `dsh-agent/lib/index.js:181`：原生 ModelSelection 在组装时保存 session-local 选择；Router 不创建第二套运行循环或 Framework。
- `dsh-api-session-controller/lib/index.js:284`：native pending/lastUsed 选择；匹配 request/header 后消费 pending。
- `dsh-llm/lib/index.js:1833`：使用 Host 的 `registerAdapter` 注册真实 `router-controlled/controlled` 路由，其 metadata/catalog 与最终请求使用同一 pair。
- `dsh/lib/profile-boot-BZ2ZjNWi.js:259`：`profileContext.home` 为 DSH_HOME，状态按 profile 保存在该目录的 router 子目录。
- `dsh-client-ui-settings-models/lib/client.js:4059`：原生 `settings.section` 注册入口，Router 客户端按同一 slots 契约注册。
- `dsh-api-gateway/lib/client.js:1798`：native unary Remote 返回 `{ok:true,value}` / `{ok:false,error}`，Router 客户端解包后才读取状态。
- `dsh-typert-loader/lib/index.js:273`：Host 自动读取包的 `./typert`；Client 显式 `remote.$mount({package,descriptors})`。Zod codec 独立打包进客户端，React 由原生 ModuleLoader 提供。

T01 使用实际 native 可控 provider/model pair，既不使用 virtual→real 映射，也不调用 `sessionController.selectModel` 自动写默认。用户显式选择仍遵循宿主原生保存默认行为；自动记录与观察不会改变默认。

## Red → green 与外部任务入口

已确认 seam：完整任务请求、最终选择、结果与记录、故障及重启。测试引用目标 rc.2 的实际公开服务；开发 Node 为 **24.19.0**，与安装内置 Node 有补丁版本差异。

| 垂直片 | Red 观察 | Green 行为 |
| --- | --- | --- |
| 可控完整任务 | 新实现入口缺失，测试失败 | 完整 AgentLoop 任务输出 ROUTER_OK，header、记录与选择一致，验收仍无法确认 |
| 暂停、重启、原生路径 | native task activeSelection 为 null | 设置重启持久化；独立 native adapter 完成任务；全局默认不变 |
| 基础连接故障 | fault classification 缺失 | CONNECTION 作为连接故障暂停本任务；用量未知；随后新任务恢复 |
| 实际原生选择链 | call 无 header-confirmed 状态 | 实际 SessionController.create/selectModel/prompt；pending 被消费，lastUsed/header 相同，两次任务无重复切换notice |
| 原生配置客户端 | 未解包 RemoteResult 导致配置页渲染失败 | 实际 React 组件显示完整任务记录与无法确认状态；暂停设置收到正确状态 |
| 不完整终态 | 原生 max-tokens 任务错误记为 completed | partial输出及7token保留；task暂停、call interrupted，blocked/取消也保持暂停原因 |
| 原生重试逐次结算 | 首次 assistant/attempt 永久 prepared、已报告7token丢失 | 公开 assistant-stream start 绑定 hostAttemptId；durable settlement 独立归属call，失败7token和重试12token均保留 |
| 设置排队写失败 | 磁盘异常仍成功返回设置；后续旧enable快照可落盘 | 新写入在执行前重查storageError；设置明确失败，重启仍读到此前持久化false/version2 |
| 执行中存储异常 | 正常模型响应覆盖存储异常暂停 | 保留输出；路由/task仍暂停，验收无法确认 |

命令：`npm test` **11/11 通过**；`npm run build` 和 `npm run check` 通过；`npm run bundle` 生成 **0.1.2** 可安装 tgz。包内容为 Host/Client/codec、patch、元数据、README 和许可证，不包含 node_modules 或另一个 Cordis Framework。

实际 native controller 测试只替换外部 HTTP carrier 的 route registration；SessionController、modelSelection projection、SessionQuery、附件文字准入、FileUploads、AgentLoop、LLM 及 Session 均为实际目标版本实现。无图片、真实授权或付费网络请求。客户端回归使用真实 rc.2 Cordis、Renderer、Typert registry、Gateway 和 RPC codec，仅替换外部 Connection JSON carrier 与 DOM 挂载；真实桌面 wire 和生命周期另见下节。

存储故障测试在文件系统边界注入一次EIO，其余写入及重启读取使用真实临时目录；仅检验当前进程的故障状态和旧排队写入保护，不承诺磁盘不可写时能持久化失败标记。Host可注入的 `routerFileSystem` 只提供 writeFile/rename，常规运行直接使用Node原生文件API。

## 共享契约与限制

- task/session/call 身份分开。独立宿主 turn 产生任务，补充输入仍在该 turn 内；selection 含连接、账号和计费路径，未知账号/计费不会伪造。
- authoritative selection 来自 durable header；未变更请求继承 header，在 assistant/message 归档时再次确认。每次调用保留 taskId、attempt、purpose、configVersion 与快照。
- 响应完成与验收通过分开；T01 acceptance 固定为 unconfirmed，后续 T13 增量填充证据。
- fixture token 是固定可控数据；没有真实 API 计费、预算或收益结论，T03 在同一记录基础上增加资源账本。
- T01 仅单个可控模型。T02 增量增加池、固定及稳定边界生效；不得实现另一条选择/执行旁路。
- state.json 以串行临时文件写入与 rename 持久化。写失败关闭自动路由并保留管理状态；无效 schema 不擅自覆盖。重启时未结束任务标记暂停。
- 没有读写 Codex 配置、认证或原用户 DSH profile。隔离桌面运行要同时确认 Electron singleton/userData 与 DSH_HOME；只改变 DSH_HOME 不足以证明实例隔离。
- `npm audit --omit=dev` 报告目标 DSH peer 的 Office→libreoffice-kit→fflate 依赖链 8 项 moderate，源头为同一 ZIP64 解析 advisory。Router 不打包或调用 Office 链，没有升级目标宿主依赖。

## 真实桌面 red → green

0.1.1 由用户原生安装并启用，一个组件运行中。设置侧栏出现但内容为空；内容断言失败。已安装的 `lib/client.js` 与集成构建 SHA256 同为 `29910C1FCD5C63B504A8FCAAAB381A7E794C73CB1DDB33F11E0189BDB896BD1B`，排除旧包缓存。真实 Electron DevTools 显示 `cannot get property "remote.router" without inject` 和 `slot entry crashed in 'settings.section'`。原直接渲染 React 组件的测试遗漏了 Cordis 依赖检查。

修复提交 `98a61d2`：父插件先挂载 Remote namespace，再加载显式声明 `remote.router` 依赖的设置子插件；使用宿主生命周期清理子插件、slot 与 namespace。真实 rc.2 Renderer 回归先复现旧版错误，再证明新版加载和卸载/重载。集成提交 `b53b58f`。

验收在隔离 `DSH_HOME` 的真实已安装 Desktop 进行；使用安装自带 `dsh plugin --profile desktop add <tgz>` 更新包，不改桌面依赖。没有读取或修改原用户 profile。0.1.2 tgz SHA256：`15EA0B20C7AC3CFEEF7B994A3B5D0F4DC4DBCFBFDEAEA538B77B5F581B2E18F1`；安装后的 client 与构建 SHA256 同为 `DF3AB57FD8221F485575B03A6F89A56BF26C77C4BEB06190BA3FF6BC13034CD4`。

| 桌面验收 | 实际观察 |
| --- | --- |
| 设置加载与 Host RPC | 显示自动路由已启用、配置版本 1、暂停按钮与空任务记录；内容断言由 red 转 green |
| 暂停保存 | 点击暂停后显示已暂停、版本 2；真实 state.json 保存 `automatic:false` / `version:2`，设置入口保留 |
| 暂停后的原生任务 | 原生模型菜单显式选择 Controlled fixture，发送 `Reply ROUTER_OK`；原生会话输出 ROUTER_OK，12 个可控 token，无付费请求 |
| 请求/状态/记录一致 | task `6106b988-9256-4e46-b512-1b84bf839350`、session `8482e86c-1266-4d20-b82c-bcd4bc380ae7`；durable header 与记录均为 `router-controlled/controlled`，call 为 header-confirmed/completed，配置版本 2；设置实际 RPC 显示同一 pair、结果及“验收：无法确认” |
| 停用与再次启用 | 原生插件开关停用后 Router 设置槽消失，原生通用设置仍可用；重新启用仅出现一个 Router 设置项，版本 2 和任务记录保持 |
| 完整进程重启 | 正常“应用 → 退出”，确认原 owner 进程退出，再启动同一隔离 profile；原生会话和 Controlled fixture 选择恢复，Router RPC 显示已暂停/版本 2、同一 task 与 ROUTER_OK |

基础连接故障、截断、取消、重试与磁盘故障由上节外部完整任务入口验证。T01 桌面与可控任务门槛通过；真实提供商授权、跨模型自动路由与收益门槛仍由后续 ticket 验收。
