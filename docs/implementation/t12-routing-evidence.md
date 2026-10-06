# T12 轻量起始路由证据

目标宿主为 Windows DSH Desktop 0.2.0-rc.2。T12 消费 T08 `candidateSnapshotSchema` 与 `ConnectionRegistry`，不建立第二套候选池、身份、授权或价格来源。

## 实现边界

`selectInitialRoute(input)` 先筛 Router 许可、池启用、当前可用、模态、工具和上下文容量，再按 balanced/cost/tokens/speed/quality 比较。费用仅在币种、计费口径、报价和 forecast 均可比时排序；token、速度和质量只采用来源明确、覆盖可比且验收 passed 的实测。Host 另以要求、当前输入内容和完整上下文生成版本化 SHA-256 工作负载指纹；只有指纹完全相同、产物完整、显式要求覆盖完整且无失败/未覆盖项的历史样本才标记为 comparable。不同输入或有限验收通过仍保留为真实测量，但不参与排序。缺少可比证据时保留仍合格的当前候选，或使用显式声明先验，最后按 candidateId 稳定选择并显示未知。单候选直接执行，无候选暂停；固定选择及原生 pending 优先且仍须通过资格检查。

用户许可与提供商凭据证据分开：`routerAuthorization.status=enabled` 才可进入池；`providerAuthorization.status=unknown` 保持未知，明确 `unauthorized` 或 `error` 才阻止。Call 固定保存完整 connectionId/accountId/billingPath/provider/model、candidateId、registry/config/auth epoch 与 quoteVersion，后续 header 不重写身份。

普通任务从已准入用户消息、历史模态、受控工具要求和上下文大小推导要求，不扫描项目。语义判断默认关闭；用户开启许可后，可通过公开 UI/RPC 为下一个 Task 一次性 armed。判断输入包含已推导要求、最近 12 条会话上下文和当前 Task 已认领用户输入，图像只传媒体类型而不复制二进制；序列化内容超过 16 KiB 时不产生 Call，明确记录 `ASSESSMENT_CONTEXT_TOO_LARGE`。受控语义标记只用于确定性要求补充测试。

判断在同一个 Task 内调用一次 `runInitialAssessment`。Host 先通过唯一 `captureCandidate` 取得 assessor 的完整 canonical snapshot，身份或 revision 变化即暂停，不临时换候选。调用沿用原 signal，经共享 `reserveCall` → `streamReservedCall` 执行，Host 当前请求输出上限 128 token，模块硬上限 512 token；模块不 persist、settle 或重放。长 await 后会复核任务输入/要求 revision。合法结果只能增加要求，无效 JSON、非正常结束、上下文变化或证据不足不能改变资格。预算等待、扩展、停止和派发前资格复查均由共享 runner 处理。

## Host 与 RPC

Host-only `captureCandidate(candidateId, { config?, signal? } = {})` 先刷新公开资格，再返回 canonical registry capture 的 detached clone。显式 config 只接受 Router 在稳定组装边界产生的快照；该方法不进入 Typert RPC。T13 等 Host 协作者以返回值作为 `selectionSnapshot`，不得自行拼接身份或 revision。

新增 RPC：

- `setRoutingObjective({objective})`
- `setSemanticAssessment({enabled})`
- `requestSemanticAssessment({})`
- `previewCalibrationBudget({})`

校准预览只持久化 `authorization-required` 的候选数、token、已知金额与未知价格数，不产生 Task/Call，也不授予执行许可。

Renderer 可设置五种目标、启用有界判断、为下一个任务明确请求一次判断、查看校准预算，并在当前任务和历史中显示实际模型、目标、要求、理由、排除候选、未知比较及判断 Call。自动路由只在稳定 `system-prompt/assemble` 应用真实 provider/model，不调用原生 `selectModel`，因此不修改全局默认。后续工具 step/retry 保留 T02 已有稳定边界和 native pending 行为。

## 自动化证据

`test/t12.routing.test.mjs` 覆盖：资格与能力先筛、五种目标差异、不可比证据、冷启动、固定/pending、许可与凭据未知分离、判断许可与预算、单调补充、校准预算、canonical schema 及 shared runner 所有权。

`test/t12.task.test.mjs` 使用真实 rc.2 SessionController、Cordis、Renderer 前的 Host 事件和实际受控 adapter，覆盖：

- 目标选择后 prompt/header/adapter/Call 五元身份一致；
- 图像、工具和容量要求在派发前过滤；
- 判断 Call 与执行 Call 同属 Task，并记录真实用量；
- 普通一次性判断请求携带真实 Task 输入且只消费一次，过大上下文零派发；
- 判断 Call 的 selectionSnapshot 等于 canonical Host capture；
- 判断预算等待后通过原 Task 扩展恢复；
- 固定与 native pending 不被目标覆盖；
- 不同工作负载的实测不能参与速度排序；相同指纹且验收覆盖完整时方可比较；
- Host capture 返回 canonical snapshot 且不暴露 RPC。

`test/t12.client.test.mjs` 用真实 Renderer 配置目标、判断和校准预览，检查路由理由、排除项、判断状态；预览前后 Task/Call 数量保持不变。

构建将 `routing.mjs` 纳入 Host bundle，修正版本为 0.5.1；0.5.0 包保持不可变且不用于最终安装。源码验证为 `npm test` 143/143、`npm run check` 通过、`git diff --check` 通过；`artifacts/irishwei-dsh-router-0.5.1.tgz` SHA-256 为 `D8CF464346FC56F411257394774C53F9F54710703199894FD2B980032DAC3FB0`。安装宿主脚本使用 `C:\Users\a1500\AppData\Local\Temp\router-implementation\t12-installed-host-validation-seam.md`，由 root 在隔离 Desktop home 验证并恢复原配置与历史。

## 已知边界

受控判断标记和工具标记只用于确定性宿主验收，不声称完整自然语言分类。一次性公开触发使真实合格候选在有界 Task 上下文内判断，但模型建议仍不能覆盖用户要求或 Host 资格。容量估算采用保守的 UTF-8 输入大小，仅在超过 8192 时要求候选提供明确容量，避免把缺少公开容量元数据的普通短任务全部拒绝。校准仅交付预算预览；实际消耗资源的校准需要后续显式授权流程，不能由本票预览触发。0.5.1 已完成本目标 Desktop 安装及受控任务验收，见 [安装证据](t12-installed-host-evidence.md)；真实模型效果、费用优势仍需独立证明。
