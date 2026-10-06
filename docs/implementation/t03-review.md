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

## 0.3.3 辅助调用修复与独立复审

固定实现 `1a9816e`、集成 `0256d4f`。67/67 完整任务回归、check、bundle、diff 检查通过。独立 Spec 复验原两项 P1 消失：真实三个 rc.2 标题模块生成独立辅助 Call，主完成后标题先等待预算；扩展同一 Task/Call 后累计24 token，主意图保持 possible。旧0.3.2录制状态升级、公开保存、再次重启保持未知；迁移、崩溃、咨询归属、停止与原signal的12项针对性检查通过。

原生预留按真实Call ID绑定，解决同step咨询被误认领、新turn header改写旧Call和停止旧标题Task误取消新Task。显式Host协作者采用 `reserveCall` → `streamReservedCall`；runner负责一次精确绑定、持久化意图和结算，不能再由调用方重复persist/settle。没有RPC任意Call授权。无可信来源的compaction及已结束Task手动标题刷新显式阻止并显示原因，属于已披露限制，不能宣称成功压缩。

Standards：0项硬性违反，1项判断性的Duplicated Code。历史迁移在已重启保存及仍在途分支重复判断相同旧协议歧义，应提取共同判断，分别保留各自status条件。当前两处分支一致，未发现因此导致的迁移错误。公开Cordis `internal/dispatch` 的使用有正式导出Events声明支持，只观察请求身份，未修改私有hook。

Spec 新增两项P2：

- 标题预算等待时移除模型再扩展，辅助Call正确零派发并设置MODEL_REMOVED，但Task终结忽略routingPauseReason，错误标completed/response-completed。应保留主产物及nativeLifecycle=completed，整体Task暂停并说明资格撤销。
- 位于Router前的公开流中间件同步拒绝标题请求，构造时创建的owner没有被消费；真实title wrapper只dispose deadline，不abort原signal，Task永久running。需要捕获消费前拒绝/关闭、释放未发owner并显示故障，不能依赖timer最终abort或把无法确认的派发归零。

两项均由独立审查者以真实三个Title模块和公开Controller完整任务复现；原作者统一修复。0.3.3候选尚未安装，不作为最终验收，#4继续保持打开。

## 0.3.4 修复与复审

固定实现 `1bb61bb`，集成 `e8256d1`。79/79完整任务回归、check、bundle和diff检查通过。公开 `internal/get` 作用域 facade 观察流构造及迭代生命周期，支持同步拒绝、懒拒绝、未消费done/return/throw；裸服务无法观察完整生命周期时显式拒绝。原两项P2经独立复验解决：撤销辅助模型后保留主产物并整体暂停；消费前拒绝不再永久占有任务。独立11项生命周期针对性检查通过。

Standards：0项硬性违反，0项判断性气味；旧协议歧义谓词已提取，两分支分别保留状态条件，公开facade没有新增重复或私有服务方法修改。

Spec新增P2：外层公开prepend流中间件调用 `next()` 并消费下游至标题usage12后抛错，内层Router生成器仍悬挂。外层收尾的owner.close在started=true时直接返回，既不关闭所属内部iterator，也不结算已观察用量。真实三个title模块已fallback、native主任务completed，但Router整体永久running；账本只保留主12，辅助usage变未知，stopTask也无法终结。需在外层终止时结束所属内部iterator并结算已观察usage；未报告消费保持未知，不能借用或清除另一Call。违反父规格任务内消耗可追溯和内部异常暂停要求。

独立公开完整任务复现为 `C:\Users\a1500\AppData\Local\Temp\router-review-t03\title-034-next-outer-reject.mjs`。原作者统一修复0.3.5。实际0.3.4安装六项操作及20条历史重启深比较已通过，审查者核对安全证据成立，但不覆盖本新增窗口，#4仍保持打开。

跨ticket接口核对另发现预留清理遗漏：真实 `agent/turn-stopping` 验收gate等待 `reserveCall(review, 原turn signal)`，预算不足时尚未返回callId、runner尚未构造。公开stopTask或原生Controller.cancel后整体paused且原signal已取消、主产物和12 token保留、辅助零派发，但review Call的status/reservation仍waiting。预留入口必须在失败/取消时释放自身未发Call；不能要求T13重复settle，也不能依赖只清理nativeReservation的turn/end。公开完整任务复现及安全JSON为 `C:\Users\a1500\AppData\Local\Temp\router-implementation\t13-review-reserve-cancel-034.{mjs,json}`，固定安装Host构建摘要一致。此项也由原作者在0.3.5统一修复，并交最终Spec复审。
