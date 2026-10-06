# T04 独立审查

固定基线 `main` / `7d882d45a134993703c6010f28be1d2cd1364863`，完整 `git diff main...HEAD`；本票定位 `git diff 189418b...HEAD`。审查实现 `ed54d0c`、集成 `5c71821`，Standards 与 Spec 由独立审查者完成。

## Standards

0 项硬性违反、0 项判断性气味。验证脚本使用 PowerShell 原生路径操作、拒绝复用 evidence 目录；Hidden 启动、停止前核对本次 PID/executable/start time、finally 还原 DSH_HOME。RPC 不输出 token/cookie 或任意 fetch 错误，公开证据不含认证。只读静态复审未重跑安装或读取 private 日志。

## Spec

0 项新增发现，可以按照 T04 明确允许的“不能运行时记录失败原因与最小适配范围”分支关闭 #5。审查者独立核对固定源码、许可、包 SHA、提交 fixture 与本机安全 JSON：CLI exit 1、真实 Desktop 公开 RPC 的 incompatible-version/changed=false、无候选或豁免与证据一致。

原包配置、同会话任务和局部移植均保持未验证，未声称效果优势。咨询/阶段切换/设置页的已有重合、最小接口适配、继续验证候选差异的决定，以及 T03/T16/T17/T21 衔接准确；不关闭父规格或解除真实实验许可。

完整验证脚本在目标 Desktop 执行 exit 0，证明预期拒绝断言通过；这不是兼容成功。Node、PowerShell 语法与 diff 检查通过。新增 owner stopped 标记只改变诊断记录，语法检查通过。所有本次 Desktop owner 已停止。详情见 [社区证据](t04-community-evidence.md)。
