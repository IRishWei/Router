# T14 研究验收独立模块阶段证据

本阶段只实现 `src/research-acceptance.mjs` 的 Host-only contributor seam。模块不发布 Task 验收、不发模型调用、不预留或结算预算，也不向 RPC 暴露来源读取。唯一 `AcceptanceCoordinator` 后续负责校验引用完整性、合并证据、使用整个 Task 共用的至多两次评审、保存 history 与发布最终 verdict。

## 有限输入合同

用户要求仅识别以下逐行字面格式：

- `论点「…」必须有来源。`
- `论点「…」需要检查来源冲突。`
- `推论「…」必须由论点「…」支持。`

实际来源只从最终 assistant artifact 的以下逐行格式取得：

`研究来源：论点「…」引用来源「https://…」中的引文「…」。`

用户预置 URL 不会冒充回答已附来源；artifact 引用也不能新增用户要求。无法解析的用户研究条款产生 `RESEARCH_REQUIREMENT_UNRESOLVED`，不会静默通过。来源引用行从正文中排除，因此只在引用元数据中重复论点不算正文已提出该结论。

`createResearchAcceptance({ resolveSourceEvidence, limits }).contribute({ task, inputs, artifact, signal })` 返回版本化的 `requirements`、`evidence`、`sourceReferences`、`sourceSnapshots` 与 `reviewCases`。它不返回整体 verdict。`source-access`、`quote-binding` 与 `claim-support` 是不同 evidence aspect；只有后续严格语义评审能处理 `claim-support`。review case 只含匿名论点、正文 hash、用户/产物指定的精确引文及 Unicode code-point locator，不含 URL、账号、模型、预算或外部页面的其他正文。

共享协调器必须用 `validateResearchContribution(contribution, { taskId, artifact })` 接收结果。该边界严格校验字段白名单、Task/artifact 身份和完整引用闭包，并返回 detached、递归冻结的数据；伪造 snapshot content hash、quote locator、review case 引用或额外权限字段都会被拒绝。具体合并、history、统一两次 review 与公开观察面见 `t14-coordinator-wiring.md`。

## 来源读取与记录

`createHttpSourceEvidenceResolver` 只执行 GET；不发送 Cookie、Authorization 或环境认证，不读取文件，不执行页面内容或递归发现链接。默认仅允许 HTTP(S) 标准端口和公开单播地址；每个 redirect 重新解析并绑定已核验 DNS 地址，跨主机或未授权地址失败。测试用 loopback 必须由构造时 Host callback 明确授权，任务、模型和 RPC 不能提供该回调。

普通记录只保存去除 query/fragment 的 display URL、完整 URL hash、内容 hash、HTTP 状态、媒体类型、精确引文与定位；不保存整页正文或 query 值。正文过大、媒体不支持、断链、取消及不可信 adapter 返回值均以稳定 reason code 保持失败或无法确认。相同 requirement/artifact 版本只复用 Task acceptance/history 中通过引用链校验的持久化快照；无进程内跨重启缓存，新 artifact revision 会重新取得来源。

同一 contribution 使用单一 deadline 与原始取消 signal，包含 DNS、每个 redirect 和任意注入 adapter 的等待；结束时移除监听器。来源上限按 canonical URL 对整个 contribution 计数，fragment 不产生新资源；同一 URL 只读取一次，但可为不同论点绑定不同精确引文。Host-only transfer budget 在 reader 收到每个 chunk 时累计，redirect body、404/失败 body 与最终 2xx body 共用一个 `maxBytes`，后续来源只得到剩余额度；不采用页面声明的长度或计数。超过总数、总字节或总时间保持 `unconfirmed` 并记录稳定 reason code，不制造质量失败。

用户输入先检查 UTF-8 总字节再进入 DSL parser。artifact 另有固定字节上限，来源引用记录另有整个 contribution 的固定 `maxSourceReferences`；同 URL 重复引用也消耗引用记录额度。超限时不静默截断后继续验收，而是保留明确的 unconfirmed requirement/evidence，且不创建 review case。

## 阶段验证与未接线项

`node --test test/t14.research-acceptance.test.mjs test/t14.integration.test.mjs` 覆盖：200 无关页面、精确引文、缺失来源、404、冲突、无支持推论、页面指令隔离、query 隐私、私网与危险 redirect、大小限制、adapter 伪记录、固定来源数、持久化复用、引用闭包伪造，以及真实 Controller/AcceptanceCoordinator 的 Task/artifact identity。

共享接线前仍需：由 Coordinator 校验 contributor 输出及引用闭包，把 research 字段加入 history 白名单，并在同一 `agent/turn-stopping` awaited 顺序中合并、评审、发布。之后还需真实 Controller、Renderer/RPC、重启与目标 Desktop 验收。本阶段不能关闭 #15。
