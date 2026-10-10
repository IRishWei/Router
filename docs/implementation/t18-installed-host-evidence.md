# T18：0.17.0 目标 Desktop 受控验收

对应 [T18 / #19](https://github.com/IRishWei/Router/issues/19)。源码固定为 `5e51bf3e3e40e1d05bffa4976cae1c5a263cafc7`，基线为 `547b8b188036a43f4f5627f4cb103598c0c9d3f0`。开发沿用户批准的 Go 主线继续；本轮只使用公开宿主接口、真实 Native Task、实际安装 Renderer 和外部本地预设 Adapter，没有生产模型调用。

## 固定源码与安装包

作者最终完整原生套件 **588/588**，其中 T18 相关 **53/53**；非作者在集成分支合并后重新验证 **588/588**。build、check、diff 检查均通过。源码 Standards 与 Spec r3 分别通过，报告分别为 [Standards](../../VERIFY/t18-source-standards-r3.md)、[Spec](../../VERIFY/t18-source-spec-r3.md)，合并原始结果为 [merger](../../VERIFY/t18-merger-r3.json)。

实际包 `irishwei-dsh-router-0.17.0.tgz` 为 **244754 字节、38 个文件**，SHA256 为 `2DBE7055718996CF7479415EDAAC58B9A5E411863D5DBC672FAA06AAFD97F55F`。离线官方 CLI 安装退出码为 0；包、解包文件、实际安装文件与固定源码构建文件逐字节一致。安装身份见 [package identity](../../VERIFY/t18-v0170g-package-identity.json)。

安装后的独立 Standards：**PASS，文档规则违例 0、判断性 smell 0**；独立 Spec：**PASS，缺失/部分 0、范围扩张 0、错误实现 0**。原报告分别为 [Standards](../../VERIFY/t18-installed-standards-r1.md)、[Spec](../../VERIFY/t18-installed-spec-r1.md)。[最终复审索引](../../VERIFY/t18-final-review-archive.json) 单独记录完成阶段，原始失败、源码未安装及待审阶段保持原样。

## 完整任务行为

成功轮次为 `t18-v0170g`，**29 个场景全部通过**，包含 29 个独立准备 Task 与 29 个场景 Task，共 **58 个完整 Native Task、134 个 Call、132 次本地预设 stream**。其中 2 个 Call 为未派发并已释放的预留。29 次标题请求、9 次 advisor 请求均计入 132 次实际 stream，没有从账本中排除辅助请求。

预设已知用量为 **1048 token**；1 次 Call 用量未知，对应 Task 聚合仍为 `null`，未记为零。161 次原始 `llm` 入口观察中 94 次由真实 native AgentLoop 的 WeakSet 身份确认；入口观察与 Adapter 投影分别记录，不能换算成新增 stream。两个操作保护案例各执行一次工具 body，没有重复副作用。

| 覆盖 | 实际行为 |
| --- | --- |
| 网络、替代模型、固定模型、恢复次数耗尽 | 同一 Task/turn/账本恢复；固定模型不跨模型；总共最多两次额外恢复 |
| 限流等待、未知用量、部分响应、未知故障 | 保留原失败及未知项，超出可信恢复条件即暂停 |
| 容量、模型格式、工具协议、图像与完整历史 | 可证明时恢复，缺失或不兼容时保留明确拒绝原因 |
| 重复工具操作与无法证明的操作结果 | 各执行一次原操作，不重复执行；不确定结果暂停 |
| 咨询及接管 | 两个方向验证原策略与恢复策略的 cap；原生实际 cap 也参与最小值；输入、输出与总预留逐项核对 |
| 授权、额度、金钱预测未知、权限撤销 | 明确提示下一步；不自动更换账号、计费来源或扩额 |
| 人工重试、仅重试当前、停止、预算停止 | 精确 Task/recovery/revision CAS；终态不提供旧 Task resume，提示发送新任务 |

并发人工重试在公开 gateway 中为一次接受、一次 `gateway/internal` 拒绝，且最终只有预定 stream。该公开封装不能直接证明内部精确 CAS 错误码；内部 CAS 原因由独立完整 Native 源码测试支持。恢复等待上限为每次计划 500ms、累计计划 1000ms，不冒称整个操作系统墙钟时限。

完整 Task、准备 Task、原始请求、资源、策略、工具和动作收据见 [public proof](../../VERIFY/t18-v0170g-public-proof.json)；汇总见 [Desktop summary](../../VERIFY/t18-v0170g-desktop-summary.json)。

## 实际 Renderer 与只读重启

实际安装 Renderer 在 live 人工等待状态加载精确 Task/recovery/revision，然后执行一次真实公开 CAS stop。终态、按钮移除和公开 Task 一致，未调用 resume。原始结果见 [live Renderer](../../VERIFY/t18-v0170g-live-renderer-evidence.json)。静态 Renderer 与重启 Renderer 的记录见 [Renderer evidence](../../VERIFY/t18-v0170g-renderer-evidence.json) 和 [restart log](../../VERIFY/t18-v0170g-restart-renderer-run.log)。这属于实际 Renderer/HTTP RPC 自动化，没有截图或 Computer Use。

当前设置页只渲染最近 **20** 条 Task，存储中共有 58 条，早期 **38** 条未在该列表中覆盖；本轮没有声称全部历史均能在页面访问。超过 20 条的完整历史查看由 T19 继续实现。

受控和只读重启进程均按 PID、启动时间、可执行文件及专属 home 确认归属，并确认停止。只读重启新增 stream 为 **0**；58 个 Task、134 个 Call、账本、配置、全局默认与完整 counter 字节均保持一致。

整份 state 字节相等为 **false**：仅当前 fixture 的 14 条连接 registry 按启动前声明刷新 generation `+2`、registry revision `+28` 及时间戳；身份、顺序、状态、能力和交接合同不变，全部非连接字段及历史连接完全一致。实际 scope、前后字节和 hash 见 [restart state scope](../../VERIFY/t18-v0170g-restart-state-scope.json)。不能将限定字段一致改称整份存储字节不变。

## 原失败与驱动纠正

六个先行轮次均冻结且不重开。每项纠正在启动下一新 profile 前单独声明，原失败阶段和原执行来源不改写。

| 轮次 | 原失败及后续纠正 |
| --- | --- |
| a | 未等待原生首标题，未知用量正确阻止恢复；增加独立准备 Task 并等待所有标题结算，核对 nullable 聚合 |
| b | 工具协议拒绝正确，驱动预期用了错误错误码；改为源码公开合同的精确代码 |
| c | 咨询原调用预留正确，驱动误把总预留 ceiling 当实际预留；改为核对精确输入、输出及其和 |
| d | 并发动作被公开 gateway 泛化封装；保留完整公开错误，并限定其能够证明的范围 |
| e | 外部 counter 原子 rename 遇到 Windows EPERM；两个确定性文件锁 red 均零提交，修复后的两个 green 各一次提交 |
| f | live Renderer 在异步首 Snapshot 到达前查找按钮；有限等待真实按钮就绪后执行一次 CAS stop |

e 的永久修复仅在外部本地 fixture recorder：遇到 EPERM rename 最多等待 4 次、每次 20ms；不重试模型或工具。g 实际发生 **1 次 20ms** 的文件提交等待并成功；counter 保留该条记录。原锁持有者未经证明，确定性重现只证明被锁目的文件能够触发该失败。六项预启动说明分别保存在 `VERIFY/t18-desktop-validation-adjustment-1.md` 至 `-6.md`。

7 份 T18 冻结 manifest 共 **713** 个文件条目；独立复审验证 705 个非秘密条目，8 份 owner 秘密文件未打开或归档。原待审冻结记录为 [validation frozen](../../VERIFY/t18-v0170g-validation-frozen.json)，新完成索引为 [final review archive](../../VERIFY/t18-final-review-archive.json)。原始日志、实际执行的驱动与依赖副本、失败冻结记录和报告按字节归档，索引 SHA256 为 `BCDA531AA81204AAA6AF741CE200171047F03F21CB7423789DF66F5D31C20615`，归档文件总数为 **481**。

## 结论范围

通过的是固定 0.17.0 在目标 Desktop 的完整受控恢复、实际 Renderer stop 和终态只读重启。live pending 重启、真实 owned OAuth `INVALID_GRANT` 服务链仅有单独 Native 源码 fixture 支持，不能归入本轮实际 Desktop 证据。生产 Go/API 恢复、第二账号、实际账单、模型质量与收益仍未认证，保留最终交付门槛；本轮生产模型请求为 **0**。
