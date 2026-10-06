# DSH Router

免费、开源、本地运行的 DSH 插件。当前实现 T01 的可控完整任务入口，目标宿主是 Windows DSH Desktop **0.2.0-rc.2**，Cordis **4.0.4**。真实提供商接入、跨模型策略及效果收益尚未验证。

## 安装与试用

1. 在原生插件管理中安装构建生成的 `irishwei-dsh-router-0.1.0.tgz`，启用插件。
2. 打开原生设置中的 **DSH Router**。在会话模型菜单选择 **Router · 本地可控模型 / Controlled fixture**。
3. 发送 `Reply ROUTER_OK`，模型返回 `ROUTER_OK`；设置页点击 **刷新任务记录**，检查实际 provider/model、结果、配置版本及时间线。
4. **暂停自动路由** 后设置页仍可管理，任务继续沿用原生模型选择。重启保留开关和记录。
5. 发送 `[router:fail]` 验证本地连接故障与任务暂停；随后发送 `Reply RECOVERED` 可进行新任务。

可控模型只产生本地 fixture 响应；不会连接模型服务或产生真实费用，token 也是固定测试数据。响应完成的验收状态保持“无法确认”。插件不读写 Codex 配置或认证。

Host 保存状态至 **DSH_HOME/router/PROFILE/state.json**。页面不是执行状态来源。停用插件会释放可控 provider 和管理客户端；已记录的本地状态保留，再次启用后可查看。不要停用后继续选用已释放的可控 provider，应在原生会话菜单选择仍可用的模型。

## 开发验证

```powershell
npm ci --ignore-scripts
npm test
npm run build
npm run check
npm run bundle
```

`npm test` 使用目标版本的真实 Cordis、AgentLoop、LLM、Session 和原生 ModelSelection 公共接口，通过完整任务观察结果；外部模型仅用可控 adapter。自动路由不创建 Framework 实例，不改写全局默认。所有最终选择由原生 controller 与实际请求 header 确认。桌面安装/加载证据另见 `docs/implementation/t01-host-evidence.md`。

跨票公共记录保留 task/session/call 身份、selection、配置版本、执行状态与独立验收状态，供 T02/T03 增量扩展。T01 只有一个可控模型，尚未实现动态跨模型选择。
