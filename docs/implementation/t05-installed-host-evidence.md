# T05：0.7.4 实际安装宿主证据

2026-10-07，Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`，Cordis 4.0.4，Host protocol 4。通过官方 CLI 安装至专用 DSH_HOME，再使用实际桌面进程的公开 PluginManager、Typert Router 和 Session RPC 验证。未使用 Computer Use，未读取正常 DSH/Codex 配置或认证，未发出官方 API 推理或付费请求。

## 发布包与代码归属

最终作者提交 `d4b874916069e83ee2df10a62bf1f41c4640a683`，非作者集成 `fc384a70f99dc070663e85bf80e4a254e4abc4ff`。`irishwei-dsh-router-0.7.4.tgz` 为 134692 bytes，SHA256 `AB587207A117852ED2026F760124BBA700E083EE74FC5AF39944EB6991800A54`。实际安装的全部16个 lib 文件与已审查作者构建逐字节一致，与集成构建在换行归一化后完全一致。

0.7.2 的安装暴露遗漏 deadline 模块，Router RPC 为 HTTP404；0.7.3 补齐模块后，连接管理成功，但检测因未声明 sibling Fiber 的 SessionController 依赖返回 gateway/internal。0.7.4 通过真实发布包闭包与 sibling Fiber 回归修复两项，并完成最终实际验证。0.7.2/0.7.3 是失败诊断版本，不能作为验收通过版本。

## 最终实际用例

| 用例 | 结果 |
| --- | --- |
| 保存两个新 Router-owned 测试凭据并分别连接 | PASS；账号、连接和同名模型候选身份分离，新候选默认禁用，普通快照不含凭据。 |
| 仅启用显式诊断候选，以1 token、10000ms运行检测 | PASS；创建真实 Task 并在预留阶段 waiting；完整输入保守预留35738 token，调用保持 proposed，`dispatchStarted=false`。停止沿用同 Task，最终 not-dispatched/BUDGET_STOPPED。 |
| 断开保留凭据，再连接 | PASS；新连接/候选身份默认禁用，不继承旧许可。 |
| 删除另一个 Router-owned 账号 | PASS；只删除指定自有记录，不影响第一个账号和原任务/配置。 |
| 保留一个测试连接后重启 | PASS；全部 Task、配置、默认模型及 owned 连接元数据深比较一致；随后通过公开生命周期接口删除全部测试连接和凭据。 |

升级前118条完整 Task 全部保留；最终新增一个真实但未派发的检测 Task，共119条。配置值、池顺序、固定选择、自动开关、预算和验收设置恢复；配置版本仅因已执行的设置命令递增。默认模型未改变。测试凭据仅为专用 credential store 中新生成的无效值，不是实际 API 授权；普通 Router state 与公开响应不含它们。

## 原始证据与剩余门槛

原始证据位于 `C:/Users/a1500/AppData/Local/Temp/router-implementation/`：`t05-v074-before-upgrade.json`、`t05-v074-installed-hashes.json`、`t05-v074-execution-evidence.json`、`t05-v074-before-restart.json`、`t05-v074-restart-evidence.json`、`t05-v074-cleaned-state.json`。失败证据另存 `t05-v072-installation-load-failure.json`、`t05-v072-recovery-evidence.json`、`t05-v073-detection-service-failure.json`。原始进程日志和登录材料保持私有。

真实 DeepSeek API 推理、账号资格及实际费用仍未验证，T05/#6 保持打开。后续需用户安全保存自己的 API Key，并明确授权有限预算的检测 Task。实际桌面的完整系统输入大于初始检测表单的4096 token上限时，会先等待；用户授权后应通过统一 Task 预算扩展继续同一任务，不能抬高全局默认或另建绕过账本的请求。
