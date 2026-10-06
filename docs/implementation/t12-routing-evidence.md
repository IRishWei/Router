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

`runInitialAssessment(input)` 是模块阶段的 owned runner：只接受 `assessment-required` 决定，要求显式 forecast，将输出限制为不超过 512 token，沿用原取消 signal，并以同一 Task 调用 `reserveCall` → `streamReservedCall`。它传递完整 selection snapshot，不写 DSH `purpose`，也不自行 persist/settle；预算/取消导致的 reservation 失败不会进入 stream。正常结束但 JSON、要求或 finish 无效时只返回 `insufficient`，且只有携带实际 callId 的充分结果能补充要求。

资格已按 T08 canonical 字段拆分：`routerAuthorization.status=enabled` 是用户对 Router 的许可；`providerAuthorization.status=unknown` 保持未知但不等同拒绝，明确的 invalid/not-configured/revoked/unauthorized/disabled 才排除；可用性另看 `availability`。选择结果从嵌套五元 `identity` 原样复制，保留 candidate/revision/quoteVersion。

`test/t12.routing.test.mjs` 通过公开函数覆盖目标差异、资格与能力排除、许可/凭据未知分离、不可比报价/未知效果、冷启动、单候选/无候选、固定与 pending、判断预算/原 signal/一次预留/有界输出、无效结果、补充要求、校准许可和快照歧义拒绝。

## 尚待共享 facade 的整合点

- T08 合入后直接 import `candidateSnapshotSchema`，删除当前 `validateSnapshot` 过渡校验；以真实 `ConnectionRegistry.snapshot()/capture()/assertCurrent()` 取代测试构造，不复制 registry、pool、授权或价格入口。
- 在稳定 `system-prompt/assemble` 捕获当前 Task 输入、原生 pending、固定候选及 registry snapshot；在 `agent/request` 应用同一实际 provider/model、prompt 变量和通知，不调用 `selectModel` 或改全局默认。
- assessment 由 Host 协调器按整个 Task 限制最多一次，使用实际 TaskId、真实 registry capture 和 T03 runner；预算等待释放及每个新调用前由共享 facade 刷新公开 Host 资格并 `assertCurrent`。模块不能自行授权或重放。
- 将当前模型、理由、排除项、判断 callId/消耗/未知项发布到持久化 Task 与 RPC/Renderer；补齐文本、图像、工具、容量、预算扩展/停止、steer、固定+pending、重启的真实 rc.2 Controller Task 验收。
- 合并最新 integration 后更新 build/package 接线，运行全回归及独立双轴复审；阶段 1 结果不能单独关闭 #13。
