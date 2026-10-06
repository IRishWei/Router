# T02 独立代码审查

固定基线仍为 `main` / `7d882d45a134993703c6010f28be1d2cd1364863`，完整命令 `git diff main...HEAD`。本票增量定位为 `git diff 38ba7f2...HEAD`，审查集成 `03042ad`，实现 `86cc3f4`。Standards 与 Spec 分别由独立审查者完成；真实桌面另验收。

## Standards

0 项硬性违反，1 项可能的 Duplicated Code：Host 绑定和 Remote 装饰两次列举 RPC 方法，protocol descriptor 第三次维护同一集合。未来增加命令容易漏同步，应从公开 descriptor 派生方法集合，绑定另加 flush。当前方法没有已知不一致，此项是维护性判断。

## Spec

1 项 P1：组装后预算等待可绕过模型撤销。在公开外层 agent/request hook 中 await next 后等待，期间禁用 B，尚未进入 llm/stream；释放后实际 rc.2 Controller/AgentLoop 仍向 B 派发并完成。违反 T02 的未启用模型不能收到请求及共享契约的旧快照不能授权新调用。

审查者通过临时仅验证有效性的公开 llm/stream guard 独立证明：禁用/移除阻止下游请求并暂停；fixed 变更期间的合法同 step 重试保持原 B 快照与 7+12 token；暂停路由且池全禁用时合法非 Router 原生路径仍执行。正式修复需覆盖预算等待、已有流与重试，不能通过换 route/config 解决。

同模型手动重选后的 native pending 无法保证消费，独立复现一致；这是已披露的宿主行为限制。共享文档原“匹配后必消费”的推断已按实测修正为尊重残留 pending、冲突则暂停，并使用公开手动不同目标选择恢复。没有更改父规格，也不以伪造 header 或修改私有状态宣称修复宿主。T12/T17/T18 沿用这一约束。

T01 独立回归 11/11 通过；集成完整回归 23/23、check、diff 通过，但新增撤销窗口用例必须先 red 再修。上述发现由同一 T02 实现者修复，Issue #3 保持打开，待正式修复复核和真实桌面证据。

## 修复复审与验收

正式修复 `a6af4c6`，集成 `51906ee`。首次消费公开惰性流 generator 时同步复查当前模型资格，已开始的流继续原快照，每次 retry 重新检查资格；保持 route/config/signal。新增等待后禁用、移除、构造未消费 iterator、retry 撤销及合法 native 路径完整任务红→绿。RPC 名单改由同一 descriptor 派生，flush 单独绑定。

Standards 独立复审：0 项硬性违反、0 项新增判断性问题，原重复名单发现已解决。

Spec 独立复审：原 P1 已解决，0 项新增可操作问题。审查者独立在真实 rc.2 Controller/AgentLoop 验证七类撤销、已有流、retry、固定变更及 native 取消行为；同路由 pending 限制的安全暂停和公开恢复与父规格一致。

集成 `npm test` 28/28、`npm run check`、`git diff --check` 通过。0.2.1 真实桌面页与迁移、实际安装宿主公开 RPC 的池/固定/暂停完整任务以及重启持久化均已通过，见 [T02 目标验收](t02-desktop-evidence.md)。按照用户要求，后半段验证使用 CLI 与公开 RPC，没有继续 Computer Use。

Spec 审查者最终只读核对六项条件和两份实际宿主 JSON，确认配置 version=9、五条任务及调用历史在重启前后完全一致，可诚实关闭 #3。原生 pending 限制及后续票约束继续保留，不关闭父规格。
