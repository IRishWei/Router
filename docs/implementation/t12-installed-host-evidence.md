# T12 实际桌面安装证据

2026-10-07，Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`、Cordis 4.0.4、Host protocol 4。通过官方 CLI 在专用 `desktop-validation-home` 安装 `@irishwei/dsh-router@0.5.1`。全程使用公开 RPC、真实 SessionController 和受控本地 provider，未使用 Computer Use、真实 API 或用户日常配置。

最终源码 `c9509aa82e5cbe0eb7eee0496f6c0709059ce2b3`，集成 `47e8893c0902355a02ca19b79982f7928341619c`。包 `artifacts/irishwei-dsh-router-0.5.1.tgz` 为109577字节，SHA-256 `D8CF464346FC56F411257394774C53F9F54710703199894FD2B980032DAC3FB0`。安装 Host、Renderer、protocol 与构建产物一致；routing 模块与作者构建字节一致，根 checkout 的 CRLF/LF 差异经规范化文本比较确认无代码差异。

最终一次验收 `v051d` 全部18项通过：五种目标、单候选、无候选、固定选择、图像准入种子及不兼容过滤、容量过滤、普通一次性判断及许可消费、过大判断上下文、受控有界判断、判断预算扩展/停止/撤销。每个派发的 execution Call 的 selection 与 canonical snapshot 身份一致，Host provider/model 与实际选择一致。速度/质量无可比证据时保持未知，受控报价只证明排序行为，不证明真实价格或效果。

图像在宿主先检查 Session 当前模型能力。验收先以真实文本 Task 将该 Session 路由到能力未知的 controlled-tools，再向同 Session 提交 PNG；Router 保守暂停且零 Call，没有修改全局默认。40000字节容量用例同样零 Call。17000字节判断输入超16 KiB，零 Call，`routing.assessment.reason=ASSESSMENT_CONTEXT_TOO_LARGE`，整体暂停理由仍为证据不足。

普通一次性判断产生1个真实 assessment Call，受控 provider 返回证据不足时暂停；下一个 Task 不再判断。受控工具判断产生 assessment、execution、标题3个 Call且统一记账。零 token 预算会保留原 assessment Call 等待；扩展后同 Task/Call继续，停止或候选撤销后不派发。校准预览为 `authorization-required`，没有新增 Task/Call。

升级前44条历史记录完整保留；验收脚本的前几轮失败只影响专用验证任务，错误为宿主图像准入及用例长度/理由字段假设，均记录后校正。最终共98条 Task，包含这些失败记录，没有丢弃。原配置值、模型池顺序、价格列表、固定选择、预算和自动路由状态恢复，版本递增至212；storageError为null。重启后完整98条 Task、配置、校准预览和全局默认逐项深比较一致。重启后的专用进程 PID38172，仅按 PID、启动时间、可执行路径和专用 home 核对后控制。

原始证据保存在 `C:\Users\a1500\AppData\Local\Temp\router-implementation`：`t12-v050-before-upgrade.json`（实际来源0.4.2）、`t12-v051d-execution-evidence.json`、`t12-v051d-restored-state.json`、`t12-v051d-restart-evidence.json` 和 `t12-v051-installed-artifact-hashes.json`。日志包含临时认证信息，仅本地保留，不纳入仓库。受控安装验收不认证真实账号、自然语言判断质量或效率收益。
