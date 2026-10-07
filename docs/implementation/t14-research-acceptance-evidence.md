# T14 研究验收实现证据

0.8.0 把 `research-acceptance` contributor 接入唯一 `AcceptanceCoordinator`。用户合同仅识别 `仅检查以下研究要求：` 下的来源、冲突和推论三种有限语法；来源必须由最终 assistant artifact 以固定 citation 语法声明。citation 行不计作正文论点，缺少实际论点以 `CLAIM_NOT_IN_ARTIFACT` 失败且不调用评审。

Contributor 只返回版本化 requirements、evidence、source references/snapshots 和 review cases。Coordinator 在 Host 信任边界严格校验字段及完整引用闭包；研究 coverage 每项只读取 `claim-support` 或 `requirement-interpretation`。`source-access`、`quote-binding` 和 `artifact-claim` 保留为可定位事实，不重复计数，也不能因 HTTP 200 或精确引文单独提升整体 verdict。旧结论与完整 research 证据按白名单进入 superseded history，新 artifact identity 重新读取来源；重启直接保留旧 Task，不批量改写历史。

默认验收及匿名评审仍关闭。公开策略保持 `{enabled:false,review:{enabled:false,candidateId:null,allowCrossModel:false,maxTokens:256,forecastTokens:4096}}`。开启研究评审后，它与普通 rubric 共用整个 Task 最多两个 review Call；使用唯一 canonical candidate capture、原 signal、统一 reserve/stream runner、Task 预算与账本。请求只含 artifact/requirement/case hash、绑定 claims 和精确 source excerpts/hash/locator。输出严格绑定 requirement、正文 claim quote 及全部 source quote/hash；额外字段、错 hash、错 claim 和不一致的高风险复核均保持 unconfirmed。

评审前用完整 system+匿名 JSON 的 UTF-8 字节数作为输入 token 保守上界，另加固定输出 `maxTokens`，两者必须装入总 forecast 和候选 context capacity。对应零调用原因包括 `REVIEW_INPUT_FORECAST_EXCEEDED`、`REVIEW_CONTEXT_CAPACITY_UNKNOWN`、`REVIEW_CONTEXT_CAPACITY_EXCEEDED`、`REVIEW_ATTEMPT_LIMIT` 和 `CROSS_MODEL_REVIEW_NOT_AUTHORIZED`。来源读取常见状态包括 `SOURCE_MISSING`、`SOURCE_HTTP_ERROR`、`SOURCE_QUOTE_MISMATCH`、`SOURCE_CONFLICT`、`SOURCE_LIMIT_EXCEEDED`、`SOURCE_TOTAL_BYTES_EXCEEDED`、`SOURCE_TIMEOUT`、`SOURCE_ADDRESS_NOT_AUTHORIZED` 与 `SOURCE_REDIRECT_NOT_AUTHORIZED`。

生产 reader 只发无 Cookie/Authorization 的 GET。DNS、redirect 和响应共用 deadline、原 signal、全 contribution 的 canonical source 数及 transferred-byte 预算；每跳重新解析、核验并用 Node `lookup({all:true})` 的数组合同钉住已授权地址。普通记录只保存去除 query/fragment 的 display URL、URL/content hash、状态、媒体类型、精确引文和 Unicode locator，不保存页面正文或 query。

自动化验证 `npm test` 为 246/246，通过真实 SessionController/Task 覆盖无评审 access≠support、严格匿名通过、无效 review、冲突、推论、citation-only、rubric/research 两次总额度、预算等待扩展/停止/撤销、来源 await 期间 steer、历史重启和 Renderer/公开 RPC。`test/t05.package.test.mjs` 同时验证 build 后相对 import 闭包与真实 sibling Fiber Host 加载。目标 Desktop 安装、公开 RPC 与重启验收由集成负责人另行记录；本文件不认证真实模型语义质量或付费 API。
