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

## 来源读取与记录

`createHttpSourceEvidenceResolver` 只执行 GET；不发送 Cookie、Authorization 或环境认证，不读取文件，不执行页面内容或递归发现链接。默认仅允许 HTTP(S) 标准端口和公开单播地址；每个 redirect 重新解析并绑定已核验 DNS 地址，跨主机或未授权地址失败。测试用 loopback 必须由构造时 Host callback 明确授权，任务、模型和 RPC 不能提供该回调。

普通记录只保存去除 query/fragment 的 display URL、完整 URL hash、内容 hash、HTTP 状态、媒体类型、精确引文与定位；不保存整页正文或 query 值。正文过大、媒体不支持、断链、取消及不可信 adapter 返回值均以稳定 reason code 保持失败或无法确认。相同 requirement/artifact 版本只复用 Task acceptance/history 中通过引用链校验的持久化快照；无进程内跨重启缓存，新 artifact revision 会重新取得来源。

## 阶段验证与未接线项

`node --test test/t14.research-acceptance.test.mjs` 覆盖：200 无关页面、精确引文、缺失来源、404、冲突、无支持推论、页面指令隔离、query 隐私、私网与危险 redirect、大小限制、adapter 伪记录、固定来源数和持久化复用。

共享接线前仍需：对 DNS/redirect 全链路应用同一 deadline；将来源数、累计字节与时间限制提升为整个 contribution/Task 总量并按 canonical URL 去重；由 Coordinator 校验 contributor 输出及引用闭包，把 research 字段加入 history 白名单，并在同一 `agent/turn-stopping` awaited 顺序中合并、评审、发布。之后还需真实 Controller、Renderer/RPC、重启与目标 Desktop 验收。本阶段不能关闭 #15。
