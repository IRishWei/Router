# T14 唯一验收协调器接线合同

本文件记录 T14 独立模块接入唯一 `AcceptanceCoordinator` 的 Host-only 合同。0.8.0 已完成共享 facade、Renderer 和构建接线；来源读取、candidate capture、Task 发布和 awaited hook 均未进入 RPC。

## Contributor 信任边界

协调器在取得 `exactTask(sessionId, turn)`、当前用户 inputs 与最终 artifact 后调用：

```js
const raw = await research.contribute({ task, inputs, artifact, signal });
const research = validateResearchContribution(raw, { taskId: task.id, artifact });
```

`validateResearchContribution` 严格拒绝额外字段，核对 Task/artifact 身份、版本化 ID、requirement→claim→source reference→snapshot→evidence→review case 的完整引用闭包，以及 anonymous excerpt 与已定位 quote-binding 的 hash/locator 一致性。返回值是 detached、递归冻结的数据；它没有 publish、budget、candidate、tool 或 RPC 能力。`SourceSnapshot` 不允许保存网页正文、query 或凭据，只保存安全 display URL、hash、状态和类型。

协调器必须捕获 contributor 异常并生成 `unconfirmed / CONTRIBUTOR_INVALID`，不能使 `turn-stopping` 丢失主产物。长 await 后继续使用 T13 现有的 signal、input revision、artifact identity 与 pending inbox 检查；失效结果进入 superseded history，不覆盖新 artifact。

## 合并、coverage 与 history

`result.research` 保存完整 validated contribution。`requirements` 合并 research requirements；`evidence` 保留所有定位证据，但 coverage 对每个 research requirement 只读取其 decisive evidence：claim/inference 使用 `claim-support`，无法解析的要求使用 `requirement-interpretation`。`source-access`、`quote-binding` 和 `artifact-claim` 只作支持证据，不能重复计数或把 200 页面提升为 passed。

`historyEntry` 显式白名单并 structured-clone `research`，保留 source/claim/hash/quote/locator/reviewCase 字段；不保存 resolver 临时 body。相同 requirementHash+artifact identity 从当前 acceptance/history 复用 SourceSnapshot，新 artifact identity 重新读取并把旧 research 标记 superseded。旧 Task 没有 research 字段时保持原记录，不批量迁移。

## 单一评审额度

research `reviewCases` 只请求评审，不授权调用。协调器把 T13 rubric 与 research cases 排入同一队列，并先读取 `task.calls.filter(call => call.purpose === 'review').length`；整个 Task 最多两次。每次仍使用同一 canonical `captureCandidate`、明确 cross-model 许可、有限 input/output forecast、原 signal 和 `reserveCall → streamReservedCall`。

研究评审输入只含 case 的匿名 claims、source excerpts/hash/locator。严格输出必须逐 requirement 指定 verdict、artifact claim quote、source quote/hash 与解释；额外字段、虚构 quote/hash、错 requirement 或冲突结论均无效。普通 case 至多一次；高风险、首轮无效或 unconfirmed 可用剩余额度再一次。评审只能更新对应 `claim-support`；访问成功本身仍不能通过。

## 公开观察面与待验收

RPC 继续只返回 Task 快照，不新增 fetch/review 工具。Renderer 在现有验收区显示 claim、来源安全地址、access/quote/support 三类状态、冲突/断链/限制原因、review Call 与 superseded history；不显示网页正文或 query，也不提供由外部内容触发的权限/预算操作。

`test/t14.integration.test.mjs` 使用真实 SessionController、唯一 AcceptanceCoordinator、真实 Router Task/artifact 和本地 HTTP source 验证合并发布、严格 research review、rubric/research 共用两次总额度、预算等待后扩展/停止/撤销、来源读取期间 steer、持久化重启，以及 citation 不能替代正文结论。`test/t14.client.test.mjs` 通过真实 Renderer 与既有公开 RPC 验证安全地址和 access/quote/support 状态，并确认没有新增 fetch/source/research RPC。目标 Desktop 安装验收仍由集成负责人执行。
