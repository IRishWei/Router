# T02 模型池、固定与稳定配置证据

目标：Windows DSH Desktop 0.2.0-rc.2，Cordis 4.0.4，Host protocol 4。实现包版本 0.2.0。基线为集成分支 `b21b99a714257581807c0adb6db7a5810af7c736`；T01 已在真实桌面验收。本页记录 T02 自动化证据，真实桌面验收由 root 单独记录。

## 共享路径

沿用 T01 的 RouterService、Task、Call、Selection 和本地状态文件。模型池条目包含 connectionId、accountId、billingPath、provider、model 和 enabled；当前只有两个本地 fixture，不代表其他账号或连接已获授权。设置通过相同 Typert 服务发送命令，Host 保存配置版本，客户端不拥有执行状态。

每次 `system-prompt/assemble` 外层截取期望配置与公开 modelSelection.pending。原生 assembly、Router 返回的提示词变量、pre-step 通知与 agent/request 使用同一步快照。没有手动 pending 时选择固定模型、有效上一模型或首个启用候选。有 pending 时保留原生选择；与固定冲突、组装中发生选择变化、目标被禁用或移除时暂停。请求之前仍检查当前启用池，旧快照不能授权已撤销候选的新调用。

`agent/request` 返回完整 native config，保留原生 token 等字段；跨模型时不继承旧模型的 reasoningEffort。`llm/stream` 不替换路由。已开始的流与工具工作保持原快照；下一步 assembly 才应用新配置。每个 Call 保留 routerSnapshot、configVersion、真实 header config、attempt 身份及各次用量。固定只限制自动执行；暂停自动路由仍允许有效原生路径。

稳定边界是下一次完整 `system-prompt/assemble`，包括工具结果完成后的下一步。原生同 step 请求 retry 不重新组装提示词，因此继续此前已捕获的快照；运行中修改须等到完整组装边界才生效。T18 的故障替换不能在这样的 retry 中临时切换真实 route，否则提示词与 header 会冲突；新 route 必须建立同一快照的提示词、通知及完整请求。

## 自动化验证

`test/t02-harness.mjs` 启动真实 rc.2 SessionController、AgentRegistry、AgentLoop、SystemPrompt、LLM、Session、Projections 与工具服务，使用新建临时 DSH home。任务通过公开 create/selectModel/prompt 入口；模型传输和等待工具是可控外部边界，无网络、认证或真实计费。

| 场景 | 观察结果 |
| --- | --- |
| 仅启用 B，完整任务 | 实际 B 请求、结果、prompt 变量、header、lastUsed 一致；pending 为空；全局默认不变。 |
| 固定 B，native pending A | FIXED_MODEL_CONFLICT，零 Call；pending A 保留，未跨模型替换。 |
| 固定匹配、同路由与恢复 | 相同 B 继续实际 B，无重复 notice；随后固定 A 保守暂停；公开选择 A 后真实 header 消费 pending。 |
| 流中移除 B | 当前 B 请求完成并保留原版本；下一固定 B 请求 FIXED_MODEL_UNAVAILABLE，零 Call。 |
| 原生工具等待中固定 B→A | 客户端/Host 显示有效版本 2、期望 3；工具完成后同一 Task 下一 Call 使用 A/3，prompt/header 一致，仅一条 notice。 |
| 首次 CONNECTION、原生 retry | 同一步仍用 B/2；两次 attempt 分别记录 7 与 12 token；下一边界才用 A/3。 |
| assembly / pre-step 等待期间 native 选择变化 | NATIVE_SELECTION_CHANGED，零请求、零错误 notice，pending 保留；解除固定后原生路径恢复。 |
| 零启用候选、禁用、移除 | 分别说明 NO_ENABLED_CANDIDATE、MODEL_DISABLED、MODEL_REMOVED；即使暂停自动路由也不发送失效本地候选。 |
| 图像未知 | 真实本地附件 admission 后，B 的图像能力仍未知，NO_COMPATIBLE_IMAGE_CANDIDATE，零 Call、零 header。 |
| 旧状态迁移与重启 | 0.1.2 automatic=false/version=2/history 保留；新池和固定设置持久化，历史追加而非重置。 |
| 篡改池连接身份 | 读取系统文件后拒绝非本地已知身份，不能将池配置变成其他 provider/account 的授权。 |
| 实际 rc.2 客户端挂载 | 真实 Renderer/Cordis/Typert facade 显示置信度，勾选池与固定，运行同一任务，显示待生效/已生效并刷新相同记录；暂停仍可管理。 |

新增图像门槛的红断言先经过真实附件 admission，原实现完成任务且 pauseReason 缺失；加门槛后暂停且零请求。持久化身份红断言原来允许外部连接字段；修复后启动明确拒绝。其他逐片红→绿证据覆盖池启用、固定冲突、流/工具稳定边界、重试与 native 选择竞争；完整回归还保留 T01 的故障、用量、存储失败及客户端生命周期场景。

客户端 harness 仅替换 JSON Connection 传输和 DOM 容器；挂载、namespace 注入与调用 facade 使用未修改宿主模块。T02 设置 RPC 转发到同一个真实 RouterService，不使用另一份页面状态证明执行。

提交前验证：`npm test` 23/23；`npm run check`、`npm run bundle` 和 `git diff --check` 通过。`node scripts/reproduce-same-route-pending.mjs` 输出三个预期阶段。安装包文件为 `artifacts/irishwei-dsh-router-0.2.0.tgz`，构建产物通过宿主 peer 契约外置运行时，客户端只内联 codec。

## 原生同路由 pending 限制

公开 `selectModel(B)` 会保留 pending B；如果当前 request/header 已是 B，rc.2 构造下一请求时认为 header 相同而不追加新 header，原生 controller 的匹配消费不会执行。该问题在真实 SessionController/AgentLoop 中复现：先固定 B 并完成任务，再原生选择 B，第二任务真实 B 完成，但公开 modelSelection.pending 仍是 B。

运行 `node scripts/reproduce-same-route-pending.mjs` 可输出 same-route、conflict、public-recovery 三阶段。预期依次为 B 输出且 pending B；固定 A 后 FIXED_MODEL_CONFLICT/零 Call；公开 native 选择 A 后 A 输出且 pending=null。测试另核对通知仅一次、没有双选择和越池请求。

未伪造 request/header、修改私有 cached reader 或默认设置，也未追加 nonce 或无语义参数。自动路由不调用 selectModel。**同路由 pending 自动消费这一宿主行为仍未通过**；此包不声称消除了原生限制，也不据此关闭 T02。用户可解除固定保留 B 的手动意图，或在原生菜单选择有效且与当前 header 不同的目标，真实请求会消费匹配 pending。

后续 T12 策略必须把仍活跃的 native pending 当作选择所有权，不能视为过期或偷偷跨模型。T17 接管与 T18 故障替换也必须沿用该门槛；没有公开、可证明的释放机制时应暂停或要求公开恢复路径，不能用私有同步绕过。T03 可沿用每次真实 Call 和失败 attempt 结算，不从 pending 推断实际消费。

## 限制

两个模型和 token 均为本地 fixture；B 的工具声明不认证真实 provider 权限或能力。图像未知不执行检测或猜测支持。当前选择顺序不构成质量评分，不实现 T12、T03 或其他后续票。测试等待工具仅在 harness 注册，桌面包没有延迟设施。T02 桌面安装、实际 wire 交互及重启需另行验收。
