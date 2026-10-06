# T12 轻量起始路由证据

目标宿主为 Windows DSH Desktop 0.2.0-rc.2。T12 只消费连接注册表的只读 `CandidateSnapshot`；候选身份、授权、可用性、能力与报价以 T08 注册表为准，不建立第二套 pool、授权映射或价格来源。

## 阶段 1：策略模块

公开策略 seam 为 `selectInitialRoute(input)`。输入包含任务显式要求、完整候选快照、当前/固定/原生 pending 候选、目标、只读历史观察、候选 forecast，以及可选判断与校准许可。输出为 `execute`、`pause` 或 `assessment-required`，并携带快照 epoch、完整五元身份、candidateId、连接/auth revision、quoteVersion、选择理由和排除原因。

保持以下不变量：

- 先按授权、启用池、当前可用、模态、工具和上下文容量筛选，再按目标比较；不合格的低价候选不能胜出。
- 费用只比较同币种、同计费口径并且报价与用量 forecast 均完整的候选；token、速度和质量缺少可比证据时不伪造排序。
- 质量/速度/token 历史只采用来源明确、覆盖可比且验收为 passed 的实测记录；unconfirmed、配置声明与受控夹具不作为真实效果证据。
- 冷启动优先保留仍合格的当前候选，其次使用显式声明先验；仍无可比依据时按 candidateId 稳定选择并明确标记未知。
- 固定候选和原生 pending 不能被目标排序覆盖；两者冲突、候选失效或无候选时暂停。
- 语义判断默认不发生。调用方明确标记必要、启用且预算已批准后，只返回一次、最多 512 输出 token、purpose=assessment 的计划；实际调用必须由 T03 `reserveCall` → `streamReservedCall` 完成。无效或证据不足的结果不改变候选资格，合法结果只能单调增加任务要求。
- 校准默认关闭；请求校准时先返回预算和待授权状态，只有显式授权才标记 enabled。

`test/t12.routing.test.mjs` 通过公开函数覆盖目标差异、资格与能力排除、不可比报价/未知效果、冷启动、单候选/无候选、固定与 pending、判断预算/边界、补充要求、校准许可和快照歧义拒绝。

阶段 1 尚未接入 `system-prompt/assemble`、`agent/request`、原生 SessionController、Host RPC 或 Renderer；这些必须在 T08 共享注册表固定并合入后，通过真实 rc.2 Task 验收。阶段 1 结果不能单独关闭 #13。
