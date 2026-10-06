# DSH Router

免费、开源、本地运行的 DSH 插件。当前提供两个本地可控模型、模型池管理、固定执行与完整任务记录，目标宿主是 Windows DSH Desktop **0.2.0-rc.2**，Cordis **4.0.4**。真实提供商接入、评分策略及效果收益尚未验证。

## 安装与试用

1. 在原生插件管理中安装构建生成的 `irishwei-dsh-router-0.2.0.tgz`，启用插件。
2. 打开原生设置中的 **DSH Router → 连接与模型**，检查两个模型的启用状态、能力及兼容性置信度。取消勾选或移除的模型不会收到新的请求。
3. 在 **路由与预算** 开启自动路由，可固定 `Controlled fixture` 或 `Controlled tools fixture`。发送 `Reply ROUTER_OK`，本地模型返回 `ROUTER_OK`；**任务记录 → 刷新任务记录** 可查看实际 provider/model、结果、配置版本及时间线。
4. 只启用 `Controlled tools fixture`、解除固定，并使用没有原生待执行选择的会话发送 `Reply POOL_B`，自动请求会选择该模型。模型池为空时暂停并说明原因。
5. 运行中修改设置会显示 **待生效**，当前请求保持其有效配置，下一稳定请求使用期望版本。移除当前模型不会改变已开始的流；后续请求遇到失效固定模型会暂停。
6. **暂停自动路由** 后仍能管理设置，任务沿用有效原生模型选择。Router 池内已禁用或移除的模型仍被阻止。重启保留启用池、固定、开关和记录；升级从 0.1.2 保留原有暂停状态、配置版本和任务历史。
7. 发送 `[router:fail]` 验证本地连接故障与任务暂停；随后发送 `Reply RECOVERED` 可进行新任务。

可控模型只产生本地 fixture 响应；不会连接模型服务或产生真实费用，token 也是固定测试数据。响应完成的验收状态保持“无法确认”。插件不读写 Codex 配置或认证。

自动选择保留仍有效的上一模型，否则使用启用池中的首个候选，不进行评分或付费检测。固定模型不可用时暂停；与原生待执行选择冲突时保留手动意图，提示解除固定或在原生菜单选择固定模型。原生选择在组装过程中变化会暂停该步，避免提示词、通知和请求不一致。

两个 fixture 的文本及本地协议兼容性已知；工具能力分别显示已知与声明，图像能力分别显示不支持与未知。未知图像能力不会被当作支持；本地候选收到图像任务时不会发送模型请求。宿主可能在任务进入前直接拒绝已知不支持图像的原生选择。工具等待验证依赖测试注册的工具，插件不向桌面安装等待工具。

DSH rc.2 存在原生边界：再次选择当前同一个模型时，下次请求可能不产生新 header，原生 pending 会继续保留。Router 不伪造消费，也不写私有选择状态。此时改变固定模型可能暂停；在原生菜单选择与当前 header 不同且有效的固定模型，实际请求产生新 header 后可恢复。`node scripts/reproduce-same-route-pending.mjs` 使用隔离目录重现此行为。

输出达到 token 上限、步骤被阻止或请求被取消时，记录保留部分输出及暂停原因。宿主进行请求重试时，每次调用独立保留状态和已报告用量。存储写入失败会暂停自动路由，设置操作报告保存失败；后续排队的旧配置不会覆盖此前持久化状态。

Host 保存状态至 **DSH_HOME/router/PROFILE/state.json**。页面不是执行状态来源。停用插件会释放可控 provider 和管理客户端；已记录的本地状态保留，再次启用后可查看。不要停用后继续选用已释放的可控 provider，应在原生会话菜单选择仍可用的模型。

## 开发验证

```powershell
npm ci --ignore-scripts
npm test
npm run build
npm run check
npm run bundle
```

`npm test` 使用目标版本的真实 Cordis、AgentLoop、LLM、Session、原生 SessionController 与 ModelSelection 公共接口，通过完整任务观察结果；外部模型仅用可控 adapter。自动路由不创建 Framework 实例，不改写全局默认。T02 同时核对实际提示词变量、切换通知、请求 header 和原生选择投影。桌面安装/加载证据另见 `docs/implementation/t01-host-evidence.md`；T02 自动化证据及未通过项见 `docs/implementation/t02-host-evidence.md`。

客户端回归通过实际 rc.2 Slot renderer、Typert registry 和 API gateway 挂载设置页，检查任务显示、暂停 RPC、卸载和重新启用；仅 Connection 传输与 DOM 挂载使用测试边界。`node scripts/reproduce-client-mount.mjs` 可输出挂载错误、RPC endpoint 和渲染树。0.1.2 修复设置项访问 `remote.router` 时遗漏 Cordis 依赖声明导致的空白页；实际桌面安装与交互仍需原生验收。

跨票公共记录保留 task/session/call 身份、完整连接与计费来源 selection、请求配置、Router 配置快照、配置版本、执行状态与独立验收状态，供预算和后续策略沿用。T02 未实现真实授权、预算、咨询、接管、模型评分或学习。
