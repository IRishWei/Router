# T04：社区兼容证据与复用决定

2026-10-07，基于集成 `189418b`，在 T02/#3 关闭后验证 [T04/#5](https://github.com/IRishWei/Router/issues/5)。结论：继续验证 Router 的证据、预算和统一交互；当前不把 oh-my-dsh 整包作为运行依赖。保留咨询工具形状和纯规则作为局部借鉴候选，尚未移植源码。社区兼容失败不证明 Router 的质量、费用、速度或体验更好，父规格及后续效果门槛不变。

## 固定候选与许可

候选为 [llmpolska/oh-my-dsh](https://github.com/llmpolska/oh-my-dsh/tree/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd)，commit `38c826b30e1598dbd74a5f52a74ab3e7e9a7accd`，包 `oh-my-dsh@0.1.0`。原 manifest、bundle patch 和源码未修改；从固定源码运行 `npm pack --ignore-scripts`，产物 SHA256：

```text
8C002A2992FA27EFBFE2116C365189D41380D6CB3F485846DB7D056677E4AA30
```

[MIT 许可](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/LICENSE) 允许使用、修改和分发；复制源码或实质部分时需保留 `Copyright (c) 2026 llmpolska` 及完整许可。该 tarball 包含 LICENSE。本票只提交验证脚本、证据和决定，没有把社区源文件复制进 Router，也不以 MIT 许可证明接口兼容。

目标为已安装 Windows DSH Desktop `0.2.0-rc.2`，build `04f392c9ddd144fa426da2045178797da6db6c11`、Cordis 4.0.4、Node 24.18.1、Host protocol 4，与 [T02](t02-desktop-evidence.md) 的目标一致。使用该安装附带的官方 CLI 与实际 Desktop exe，不使用 npm 的另一套宿主来替代目标。

## 实际安装与桌面拒绝

在全新无凭据 home 中完成下面路径，未使用 Computer Use：

1. 用实际 Desktop 初始化独立 `desktop` profile；等待其 localhost endpoint 就绪，只停止已核对 executable、PID、启动时间的本次进程。
2. 官方 `dsh plugin --profile desktop add <原 tarball>` 实际完成 pnpm 的包安装阶段，随后因兼容性拒绝，exit **1**。不是依据旧 peer 范围推断安装结果。
3. 官方诊断明确报告 `oh-my-dsh@0.1.0 is incompatible with dsh 0.2.0-rc.2`，12 项 DSH peers 均为 `^0.1.0-rc.6`，exact-version exemption 未启用；安装器报告恢复 `package.json`、`pnpm-lock.yaml`、`node_modules`。拒绝前后 profile manifest SHA256 相同。
4. 用同一独立 home 重启实际 Desktop，通过官方 Connection 的 localhost browser-session exchange 与公开 HTTP RPC 查询 `pluginManager/listBundles`、`listPlugins`、`listVersionExemptions`：无候选 bundle、无候选 plugin、exemptions 为 `{}`。
5. 再经真实桌面设置后端的公开 `pluginManager/installBundle` 尝试同一 tarball，返回 **`application=failed`、`changed=false`、`error.code=incompatible-version`**，structured incompatible 记录包含相同候选、运行时和 12 项 peers。宿主从两次校验报告了重复候选记录，不将记录数误当为两个插件。再次查询仍无候选 bundle。
6. 验证结束停止本次 owner；`.agent-presets/oh-my-dsh` 未创建。没有授予豁免、放宽 peers、改正常 DSH profile、读取认证文件、调用 `session/prompt` 或模型。

开始直接向全新 home 执行 CLI 时，宿主曾要求先打开 Desktop 初始化 profile；这仅是初始化要求。完成初始化后得到的兼容拒绝才是本票的运行结论。验证脚本第一次错误假定 structured incompatible 只有一条，后按真实重复记录修正；完整成功轮的两条原始结构记录保存在 [可检查证据](fixtures/t04-community-compatibility.json)。

**可运行范围：原包在目标 rc.2 未被激活。** 安装失败阻断配置命令、同会话选择、咨询和可控模型任务；这些均保留为未验证，没有绕过 gate 后宣称安装→配置→任务成功。T04 接受条件明确允许不能运行时保留失败原因与最小适配范围，因此可关闭的是社区门槛调查，不是社区运行兼容或效果比较。

## 可复现入口

前置条件为退出其他 DSH Desktop 实例。Electron 单例跨 `DSH_HOME`，脚本检测到已有 DSH 进程会停止验证；不会终止其他实例。`EvidenceRoot` 必须是不存在的新目录。宿主安装位置不同可传 `-DesktopExe` 与 `-DshCli`。

```powershell
git clone https://github.com/llmpolska/oh-my-dsh.git C:\Temp\oh-my-dsh-t04
git -C C:\Temp\oh-my-dsh-t04 checkout --detach 38c826b30e1598dbd74a5f52a74ab3e7e9a7accd
& .\scripts\verify-community-compatibility.ps1 `
  -SourcePath C:\Temp\oh-my-dsh-t04 `
  -EvidenceRoot C:\Temp\router-community-t04-evidence
```

[验证主脚本](../../scripts/verify-community-compatibility.ps1) 对每次 CLI/桌面启动局部设置并还原 `DSH_HOME`；[RPC 脚本](../../scripts/verify-community-host.mjs) 使用宿主公开信封和 Plugin Manager methods，不导入私有宿主方法。cookie/token 仅在内存中用于会话交换，不打印、不进入提交证据；Desktop 自身启动日志存为本地 `*.private.*.log`，其中可能含短期 launch URL，不能公开这些原始日志。提交证据只有版本、包摘要、拒绝结构及资格状态。

实际成功轮目录为 `C:\Users\a1500\AppData\Local\Temp\router-implementation\community-desktop-validation-pass-20261007`；CLI install.log、pack.json、summary.json、host-rpc.json 和 owner 记录留在本机。验证脚本 exit **0** 表示预期兼容拒绝和未激活断言通过，并不表示社区插件兼容。

## 已有能力、公开契约与最小适配范围

以下源码判断均限定于固定 commit，未因 README 的功能声明认证目标桌面功能。实际桌面验证只覆盖上面的官方拒绝和未激活状态。

| 能力或边界 | 固定源码已实现 | rc.2 复用条件与本票状态 |
| --- | --- | --- |
| 咨询 / 评审 | [agent.js:794](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/agent.js#L794) 的 `omd_advisor`、`omd_review` 将局部问题及证据交给 strong tier，结果返回原主 agent。 | 单 agent 咨询的概念、输入形状可借鉴；未做局部移植或原包调用。不能复用其 helper 代替 T03/T16 的预算、调用身份、用量账本、超时和固定模型约束。 |
| 模型流 | [streamText:1004](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/agent.js#L1004) 使用 `llm.stream` 的 one-shot `system`、messages、signal。 | rc.2 公共 GenerateOptions 支持这条形状；不代表整包运行。辅助调用须捕获 immutable target，不能在 await 后从可变配置重新归属；需记录 usage、截止时间、输出上限和截断状态，`max-tokens` 的 ok=true 不认证有效验收。 |
| 阶段切换 / 错误升级 | [routing listeners:597](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/agent.js#L597) 按 plan/build 或错误数解析 tier；main 调用 [ensureHeader:259](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/agent.js#L259) 手工追加 `request/header`。 | 不移植 header 写入。自动选择必须遵守 T02 的 prompt assembly 稳定快照、真实 `agent/request`、派发资格复查、native pending/manual 和固定选择；让宿主真实请求生成 header，不能用记录修改证明实际切换。 |
| 纯 tier 优先级 | [pure.js:101](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/pure.js#L101) 的 `resolveTierSpec` 无 I/O，输出 strong/cheap/vision/null。 | 可作为有许可的纯规则候选；不决定 Router 的最终授权选择，不覆盖池资格、预算、manual/fixed、容量和能力。当前仅源码审查，未复制或局部适配。 |
| 设置页 / 配置 | [client.js:345](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/client.js#L345) 已有 `settings.section`；[config.js:156](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/config.js#L156) 使用旧 `settings.register`。 | settings.section/ModuleLoader 的公开注入模式可参考。旧 namespace 注册在 rc.2 没有相同公开方法，需改为当前 Framework 配置 ownership、revision/RPC；client inject 的旧 dsh-client-runtime 需核对/替换。原配置页未运行验证。 |
| 凭据投影 | [viewFromState:82](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/config.js#L82) 返回普通 `imageApiKey` 字段；host 自定义 `/omd/config`。 | 不复制这种 secret 投影。使用正式 credential 入口及 redacted UI/普通记录；自定义 HTTP handler 的当前鉴权/注册契约未验证，不移植它充当 Router 配置通信。 |
| preset / admission / 流包装 | [index.js:161](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/index.js#L161) 复制旧 preset、尝试更改默认；[index.js:504](https://github.com/llmpolska/oh-my-dsh/blob/38c826b30e1598dbd74a5f52a74ab3e7e9a7accd/lib/index.js#L504) 包装旧 apiProxy；agent 包装私有 `llm.streamWithRegistration`。 | 整包移植需要当前 agent-preset/SessionController 接口重构与 lifecycle 证明；不复制旧 preset、不改全局默认、不 monkeypatch admission/私有 LLM，不采用 worker/subagent 路径。 |

Framework 的 `^4.0.1` 与当前 4.0.4、schemastery 的 `^3.18.1` 与当前 3.18.4 本身可相容；实际拒绝来自 DSH peers。把 DSH peers 改到 rc.2 只解决版本声明，还需要以上实接口适配与可控完整任务、客户端挂载、热重载/卸载、选择一致性测试，才能重新接受社区运行路径。T04 没有执行这些适配，也没有证据要求本票移植整包。

## 重合、候选差异与后续票衔接

咨询、plan/build 阶段切换、同会话模型配置、错误升级及设置页在社区源码中已经存在，不能成为 Router 的独创功能或收益结论。社区 README 的便宜/强 tier 目标同样不等于实测节省。

| 候选区别 | 验收证据 | 效果评估与状态 |
| --- | --- | --- |
| 要求驱动的验收和无法确认 | T13—T15 应验证规则/测试/评审覆盖与结果来源，执行完成不能当整体通过。 | 需比较各任务类别的质量和失败/无法确认；当前双方均未作可比实验。 |
| 全任务预算与资源归属 | T03、T16—T19 验证咨询、评审、重试、重做计入原任务；未知用量不记零。 | 完整可比消耗数据才能支持费用或 token 改善；本票没有模型调用，不产生节省数字。 |
| 手动选择与稳定生效 | T02 已建立真实请求/日志/native projection 一致性及 pending 限制；T12/T17/T18 沿用。 | 自动化契约通过不证明日常交互更好；需要安装、管理和任务流程对比。 |
| 观察、影子计算与有限试用 | T20—T23 验证资格、持久化比例、回退和不完整证据处理。 | T21 真实实验预算与 T23 用户开启许可继续有效；T04 完成不会授权真实试用。 |
| 统一连接与三页管理 | T05—T11、T19 验证官方接入、连接身份、能力置信度及日常管理。 | 社区现有设置页是比较基线；改善必须以同目标的操作流程证据证明。 |

决定是**继续验证自研的候选差异，局部参考公开接口与咨询形状，不接入旧整包**。T05—T11 优先复用经过各自真实授权/推理测试的宿主接入组件；不能把此次拒绝扩展成“社区 providers 均不兼容”。T16 若复制 advisor/纯规则片段必须保留 MIT 声明，且接到 T03 唯一调用账本；T17 的主模型切换沿用 T02，不采用社区伪 header。T21 的社区基线若仍不能在同一宿主适配运行，应明确标注 baseline unavailable，不能将其失败计为 Router 获胜，也不能跳过父规格的效益决定。

T04 六项验收按“无法运行时记录原因和适配范围”分支已满足。未验证项仍为原插件配置/同会话任务、社区效果和局部移植运行；这些没有被标为通过，也没有修改或关闭父规格。
