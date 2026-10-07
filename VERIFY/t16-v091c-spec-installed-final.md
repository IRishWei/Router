# T16 v091c actual-installed Spec final review

## 结论

**PASS。T16/#17 已满足实际安装验收合同，具备关闭资格。** 本结论只覆盖 #17；不自动关闭 Issue，也不改变 T14/#15、T05/T06 或原生依赖状态。

## Findings

未发现阻断问题。

## 需求符合度

- ROOT 固定于 `47d5e79c5e5c7a0054d2a36730a3dd399c74b12d` 且工作树 clean。Router 0.9.1 为 160169 bytes / `1D3E…B575`，companion 0.4.3 为 5613 bytes / `4288…A656`；实际 provenance 证明 24 个安装文件与包一致，20 个 lib 与作者构建一致并与 ROOT 规范化构建一致，companion 五文件闭包一致。
- `t16-v091c-execution-evidence.json` 为 `completed:true`，17 个 case 名称、Task ID 与最终追加顺序均唯一。实际证据覆盖协调关闭、automatic 关闭、同 Task/turn 的 4→9→14、自修与一次咨询、相关证据不变、四类前置拒绝、RATE_LIMIT/CONNECTION/TRANSPORT/AUTH、预算 extend/stop/revoke、additive human steer 及冻结策略。
- 61 个 fixture Call 的完整 identity/candidate snapshot、派发状态和 6/4/0/0/0/10 usage 与账本逐字段一致；未知价格保持 `PRICE_UNKNOWN`、amount null、billing unconfirmed。Router notice 均为真实 session event 中的 `role:user`，通过案例只在咨询建议后的第三次执行产生 14 字 canonical acceptance。
- human steer 保留原 10–20 和补充 1–20 两项要求、对应两个输入 origin；四字 evidence 分别 failed/passed，整体 failed。原 consultation Call 未派发且 released，episode 为 stale/HUMAN_INPUT_PENDING，三个 advice 字段为空。
- 142 条旧历史完整保留；最终 159 条 Task 与 execution evidence 对应。恢复后 config 除合法 revision 377→434 外全部值一致，DeepSeek metadata、默认模型及 storageError 均符合合同。带夹具重启、公开移除及再次重启证据均为 159 条完整历史/config/default/metadata 保留，且 fixture unavailable。
- 已安装 `client.js` hash 与 provenance 一致。Renderer 使用真实 rc.2 Renderer/Typert/slots 和 live `router/snapshot`，17 个 Task 分别绑定自身条目；只读方法、默认控件、各 lifecycle/verdict/artifact/episode/reason 及挂载前后深比较均有证据，明确为 `react-test-renderer` 且无截图声明。
- `docs/implementation/t16-installed-host-evidence.md:3-64` 与实际 JSON、固定包、非作者 287/287 复验和两轮失败事实一致；`t16-consultation-evidence.md` 只将剩余验收连接到实际证据，没有把 T14、研究能力、真实账号或付费服务纳入 T16 PASS。

## 验证

独立只读断言重新核对了 142→159 前后状态、17 case、61 fixture Calls、ledger、public notices、预算等待摘要、steer canonical shape、Renderer Task 映射和包 provenance，全部通过。三层保护 checker 实际结果分别为 35/2、20/2、20/2；`v091` 与 `v091b` partial evidence 继续为 `completed:false`，分别保留 2 与 15 个已完成 case。现有非作者报告记录 T05 9/9、T16 12/12、串行全量 287/287；本轮未重复生产测试或 17 Tasks。

## 剩余风险

T16 的建议质量与真实 provider/账号资格不在本地固定夹具证明范围内，文档已明确限定。T14 来源读取仍被网络环境阻塞，research/model-review 在可信上游谓词发布前继续 fail-closed；这些边界不阻止 #17 关闭。