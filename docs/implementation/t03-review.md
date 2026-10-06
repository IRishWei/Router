# T03 独立代码审查

固定基线为 `main` / `7d882d45a134993703c6010f28be1d2cd1364863`，完整命令 `git diff main...HEAD`。T03 增量为 `git diff 0d0295e...HEAD`，实现 `5fa2ede`，集成 `9da3681`。Standards 与 Spec 分别由独立审查者完成，未使用 Computer Use、用户凭据或付费请求。

## Standards

0 项硬性违反，1 项可能的 Primitive Obsession：`ledger.mjs` 把限制资源、币种、口径和说明编码为字符串，客户端通过 `startsWith` / `split` 再解析。改为结构化限制记录，客户端依据字段展示，避免修改文案影响通信结构。这是维护性判断，未发现已证实的展示错误。

## Spec

- P1：派发标记只异步写盘，实际 Adapter 已开始调用，但写入失败后立即退出，重启读取旧 `prepared/reserved/dispatchStarted=false`，将调用排除，token 总量和未知次数均为零。真实 rc.2 Adapter/Controller 独立复现。违反父规格“失败时用量未知不能记为零”。允许传输前需持久化可能派发的意图；意图后崩溃保留未知、不重放。新增等待写盘之后，必须在真正消费下游前同步复查当前资格、原生 pending 和取消 signal。
- P2：预留金额只取 `amount ?? 0`，部分报价完整金额未知时忽略已知下界。真实任务工具回调沿统一入口声明 consultation 预测，已知 USD 0.00026，任务 USD 0.00004 已耗完，仍获预留。预计本次及其他并发预留需计入同币种、同口径的已知下界，同时保留完整金额未知与不可执行项。

现有 T03 完整任务与 Renderer/RPC 测试 12/12 通过，完整集成回归 40/40、check 和 diff 检查通过；这些既有测试不能覆盖上述独立复现。修复前不关闭 #4，也不把已安装 0.3.0 的预算基础操作验证当作最终验收。

三个发现交由原 T03 实现者统一修复。修复提交、双轴复审、最终安装包和重启证据在通过后追加。

## 首次修复复审

修复 `35e927c`，集成 `ad0bb07`，版本 0.3.1。集成 50/50 回归、check、diff 检查通过；实际安装客户端与构建产物一致。安装验证脚本已跟进结构化 `blockedBy`，同一预算等待 Task 通过增加 2 token 完成，但最终安装验收仍等待复审修复后的包。

Standards：原字符串结构耦合已解决，0 项硬性违反；新增 1 项可能的 Mysterious Name。`markCallDispatched` 现在仅持久化可能派发意图，不证明实际传输，名称应改为 `persistDispatchIntent`，避免后续调用方误读返回状态。

Spec：原部分报价 P2 已解决，新的持久化等待窗口、失败零 Adapter、直接崩溃恢复未知均通过。原 P1 仍有一个历史迁移遗漏：实际旧 0.3.0 Adapter 开始调用后写盘失败并崩溃，旧版本重启误判 `not-dispatched/header-confirmed`，用户随后保存设置将其落盘；0.3.1 升级仅处理仍运行/等待和 prepared 记录，漏掉已经 `paused/HOST_RESTARTED` 的错误零消耗结论。独立审查者使用真实旧提交及 rc.2 Host 全链复现。需要识别此旧模糊记录并恢复未知，明确预算等待或未发送记录仍为零。

本轮 Standards 1 项判断、Spec 1 项 P1 残留，仍由同一实现者统一修复；#4 保持打开。
