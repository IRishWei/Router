# T08 最终目标桌面验收

2026-10-07。验收目标为 Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`，Cordis 4.0.4、Host protocol 4。使用官方 CLI、公开 PluginManager/Session/Router RPC 和独立 companion；没有使用 Computer Use、真实 API、付费调用或现有凭据。

运行时固定提交 `52ece6008500ae02b36861cd10b6beef8fc3b560`；验证脚本恢复顺序修复提交 `a911850b25bea568ac6de4b7802d5f4691b7fa21`；集成合并 `486ae9d0255156e9bacc5ee5bf66bd7f81c5a541`。Router 0.4.2 包 100,685 bytes，SHA-256 `EEBFBCC12333CD9BAF5DD0ED98267537F5A3D8118BAC797E35AC6DA9F777EA18`。Companion 0.1.0 包 1,397 bytes，SHA-256 `A44579731FEABB760D7B24CE76335E1396909A259295111651AC3FAB27FDA60C`。

实际隔离安装库的 package version 为 0.4.2；Host SHA-256 `F79AE27515E6B7DAAB644B003E48749D2903B1D1E6669F5A2BCEB05D3527BD25`，client SHA-256 `7E725C0A1D8404520DD6BB3B7357E5B7150EBE46C3559A954E59F4C979D74965`，与集成根目录和作者工作树构建一致。

## 最终完整路径

| 检查 | 实际结果 |
| --- | --- |
| 安装与发现 | 官方 CLI 安装独立 native companion，公开 PluginManager 激活；Router 通过公开 LLM 元数据发现 `router-t08-native-companion/controlled-native`，ownership=native-reference，默认未启用。 |
| 未启用对照 | automatic=false、fixed 清空后提交真实 Session Task；companion 收到零 Call。 |
| 主动启用执行 | 用户命令将 candidateId 加入启用池并固定，automatic=true；完整 Task 返回 `NATIVE_COMPANION_OK`，请求 provider/model 与候选及账本一致。 |
| 资源归属 | execution 5 input + 3 output = 8 token；同 Task 标题另 8 token，共 2 Call / 16 token；派发意图 possible、dispatchStarted=true。两次缺价均保持 unknown，未计零金额。 |
| 宿主移除 | 公开 PluginManager.removeBundle 真正卸载 companion；旧候选保留 unavailable tombstone。 |
| 移除后任务 | 旧 fixed candidate 的新完整 Task 暂停，CONNECTION_REMOVED、零 Call；原完成任务产物和记录保留。 |
| 移除后重启 | configuration、43 条完整 Task 记录、原生 modelCatalog.default 逐对象 deepEqual 保留。 |
| 恢复原配置 | 原模型池顺序、身份与 enabled、fixed、automatic、budget、prices 逐字段恢复；仅配置版本正常从 80 增至 90。 |
| 最终再次重启 | 恢复后的完整 configuration、44 条完整 Task 记录、default 全对象 deepEqual；storageError=null。 |

最终 candidateId `308fd4aa-8c95-4249-973a-5ec85d014541`；完成 Task `f293e606-5e41-4b0c-aaf4-7766744b4b20`；移除后暂停 Task `fa26e5f0-3af6-4bf2-910d-cfab73d0f4c4`。原生默认始终为 `router-controlled/controlled`。恢复后的模型池为原顺序 `[controlled-tools, controlled]`，fixed=controlled-tools、automatic=false；这些是隔离验收环境的原配置，不代表用户正常 profile。

## 失败诊断与复验

0.4.0 首轮独立审查的身份许可、同名 legacy、真实请求错归及无事件刷新问题未被接受。0.4.1 复审又发现 owned 元数据可冒充 controlled；最终 0.4.2 收紧该边界，通过复审后才执行完整桌面任务。

首轮 0.4.2 的执行/移除/重启成功，但额外严格检查发现旧验证脚本按目录顺序恢复，重排原模型池。先通过公开 RPC 恢复原值，再修复脚本为按原 `config.pool` 顺序恢复；修复经过独立双轴增量审查和定向回归。最终重新安装 companion 并执行上表整条路径，原配置恢复不需要手工修补。原 T03 的 38 条历史记录在升级时全部 deepEqual 保留，最终 44 条包含两轮验证新增任务。

原始证据仅保留在本次临时目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation`：`t08-v042b-{bundle-enable,execute-evidence,bundle-remove,before-removal,restart-evidence,removed-evidence,after-restoration,restored-restart-evidence}.json`。私有 launch log 含 localhost 身份令牌，不提交或展示。隔离 home 的每次停止/重启都校验所拥有 PID、启动时间、exe 和 home；没有操作正常 DSH profile 或 Codex 配置/认证。

本验收证明目标桌面的公开连接复用路径，不认证远端 API 账号、任意社区 provider 或其他宿主版本。
