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

## 第二次修复与代码复审

修复 `b43888c`，集成 `8145666`，版本 0.3.2。旧版本已重启并保存的误判记录纠正为 `interrupted/dispatchUncertain`，保留身份、报价、配置、预算和扩展；明确未发记录仍为零。常规回归使用真实旧 Host 录制的输入，无历史 Git 源码依赖。方法改为 `await persistDispatchIntent`，绑定、调用、测试和当前说明同步。

Standards 本轮独立复审：0 项硬性违反、0 项新增判断性问题，原 Primitive Obsession 与 Mysterious Name 均已解决。

Spec 本轮代码复审未发现新的迁移问题。审查者重新运行真实旧 Adapter 已进入→写盘 EIO→退出→旧 Host 重启保存→升级0.3.2，确认调用数1、完整用量未知、未知次数1；公开保存后再重启仍保留，不重放。预算等待/proposed、非重启撤销和新协议明确未发送记录仍为零；原部分报价及持久化等待窗口已在上一轮独立验证，本轮未改其行为。

集成 51/51 回归、check、diff 检查通过。安装 Host/客户端与构建产物摘要一致；预算扩展、停止、缺价及14条历史重启深比较通过，见 [安装宿主验证](t03-installed-host-evidence.md)。随后安装宿主字段核对发现并发辅助请求缺陷；这些检查不能据此视为最终验收。

## 安装宿主差异：辅助请求借用执行 Call

P1：0.3.2 三条实际完成的执行调用出现 `dispatchIntent=blocked`、`dispatchStarted=true`。实际 Desktop 的公开 `dsh-session-title` 在 header 后异步生成标题，使用同 session 的独立 LLM 请求。Router 的 `llm/stream` 仅按 session 取执行 `#inflight`；标题请求再次持久化同一 Call 时遭拒，却在 catch 中清掉执行调用的派发状态。

原实现者使用真实 rc.2 LLM waterfall 并发调用确定复现。独立 Spec 审查者使用真实 SessionController、SessionTitleService 和公开 title provider 注册完成完整任务复现：标题失败而主任务成功，账本留下上述矛盾。进一步在主 Adapter 已进入、尚无 usage 时让标题请求触发并将清零状态落盘，直接退出并重启后，新协议记录被误判为未发送，调用数/token/未知次数均为零；无需存储故障即可丢失潜在消费。

需要隔离执行与辅助请求的 Call 所有权，拒绝无所有权入口时不得改写另一调用的持久化意图。允许消费的辅助请求也必须有独立预留、结算和 Task 归属，涵盖主 turn 已完成时仍在途或等待预算的生命周期；只过滤辅助请求会漏记额外消费。此问题仍交原 T03 实现者统一修复。#4 保持打开，0.3.2 不作为最终验收版本。
