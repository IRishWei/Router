# T14 v0.9.3e 实际安装最终 Spec 审查

## 结论

**PASS。T14 / #15 在 Spec 轴具备关闭资格。** 未发现阻断问题。该资格仅覆盖 T14 来源网络兼容与既定 19 项实际验收；不认证 T05/T06 的真实远端授权、真实模型语义质量、付费调用或 T24 全插件交付。Issue 实际关闭前仍应写入最终文档并取得并列 Standards 轴最终 PASS。

## Findings

无。

## 需求符合度

- **冻结身份与安装来源**：根目录两个冻结包重新计算为 Router 0.9.3 `163149B / AB78E7F...53DD3`、fixture 0.3.4 `3980B / CB5127...53B5`。`t14-v093e-installed-hashes.json` 固定作者 `8cc67dd...`，25/25 安装文件与包一致；21/21 lib 同时标记作者构建及 ROOT 规范化构建一致。fixture 的 4/4 文件在 enable/remove 证据中均与已审包一致。
- **默认来源网络合同**：`t14-v093e-installed-default-source.json` 证明生产默认、无注入网络选项，HTTP 200、2214B、固定内容 hash `bd44743...32a2`。network-before/after 的 DNS、当前用户代理和 hosts 三项 hash 全同，且未记录原始网络配置。
- **完整历史与实际 Task**：`t14-v093e-execution-evidence.json` 为 `completed:true`、19 个唯一 Task ID；`t14-v093e-restored-state.json` 为 230 Task。独立深比较确认前 211 Task 与 before-upgrade 完全相同，后 19 Task 的 ID、顺序及公开 Task 各字段与 19 case 逐项一致。config 除合法 revision 525→560 外深等，DeepSeek 元数据与默认模型深等。
- **Call、usage、费用与账本**：对全部 case 重算 53 个实际派发 Call、424 个已知 token；每 Call 均为受控 fixture、full selection 等于 selection snapshot、usage 固定 4/4/0/0/0/8、priceQuote=null、cost=`PRICE_UNKNOWN/unconfirmed`。所有 ledger 分项、callCount、unknownPriceCalls=53、unknown token 数、uncertainDispatchCalls=0 和空 money ledger 均与 Call 重算一致；每 Task review Call 不超过 2。
- **研究验收边界**：19 项实际证据保持 access≠support，锁定 claim locator、固定 quote hash、source hash、coverage 和失败原因；缺失来源、引文不匹配、私网地址、跨模型未授权、冲突、unknown、两次 review 上限与 rubric/research 共享上限均按合同输出。query 未进入 displayUrl/研究公开记录，临时 source body 未进入公开 evidence；rubric review 不含 caseId/sourceQuotes，且 raw envelope 只含三键。
- **预算与 human steer**：extend/stop/revoke 都绑定原 waiting Task/turn/Call、唯一 review reservation、tokens blockedBy 与 4096 forecast。extend 同 Call 完成并 settled；stop 为 `ABORTED/BUDGET_STOPPED`、未派发/released、`budget-stop=1`；revoke 为 `MODEL_NOT_FOUND/MODEL_DISABLED`、未派发/released、`budget-stop=0`。steer 保持同 Task/turn、两次 RPC input 的 requestId/messageId/contentHash 与各自 requirement origin 精确绑定，seq 递增；旧 review 未派发并释放，新 review 绑定新 artifact，原 artifact 留存 superseded history。
- **真实 Renderer 与生命周期**：`t14-v093e-renderer-evidence.json` 使用已安装 client、真实 native Renderer/Typert codec、live `router/snapshot` 和 `react-test-renderer` DOM mount；未宣称截图。checkedTaskIds 与 19 case 完全同序，逐 Task 条目绑定 identity、lifecycle、verdict、artifact、coverage、claim/access/quote/reason 与 superseded history。Renderer 调用仅 `router/snapshot`，前后历史、config、DeepSeek、默认模型均保持。
- **恢复、重启与公开移除**：restart evidence 为 230 Task 全历史保持；bundle-remove 明确 `changed:true`、resultingBundle=null。removed-check 在公开移除及再次重启后仍为 230 Task，fixture unavailable，历史/config/DeepSeek/default 均保持。六层保护脚本独立复验为 35+2、20+2、20+2、29+2、28+2、24+2 PASS；d/c/093 的 partial evidence 仍为 `completed:false`，未被 e 成功证据覆盖。
- **源码非作者验证**：`VERIFY/t14-v093-non-author-merge.md` 固定 ROOT merge `6fffd362...`，记录 check/build PASS、21 lib 零差异及串行 290/290 PASS。实际安装证据中的 Renderer integrationCommit 与该 merge 一致。

## 测试与验证缺口

本次按要求未重新运行源码全量测试、Desktop RPC、进程或 Task；结论来自冻结包、已审 helper 与公开实际证据的独立重算。private Desktop log 未读取或输出。最终产品文档尚未更新，且另一独立 Standards 最终轴不在本报告范围。

## 剩余风险

T14 只证明既定目标 Desktop 在现有网络设置下可自动读取固定 HTTPS 来源，并维持 SSRF、脱敏、预算、review 与恢复边界。外部服务未来不可达、用户账号未授权或没有可用连接仍应按产品合同明确失败并保留任务；这些状态不构成修改 DNS、hosts、代理或路由器的要求。