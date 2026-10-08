# T11 Standards 最终复核：PASS

固定 base：`0b9ec4fe21cc898d3240b232966bc6838ca041b9`；作者 HEAD：`5b4048dd96237a95ad29d5973c837d60324597f3`，分支 codex/subscription-reference。完整比较 `git diff 0b9ec4fe21cc898d3240b232966bc6838ca041b9...5b4048dd96237a95ad29d5973c837d60324597f3`；在 a 轮累计审查上重点复核 e492d86→5b4048d。沿用 AGENTS.md、docs/agents/*、GLOSSARY.md、ADR 0001/0002、ticket-contracts、README、T11 契约与冻结官方快照。

**硬标准违规：0；可操作启发式建议：0。上一轮 P1 已修复。** [ledger.mjs:30](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/ledger.mjs:30) 只接受指定 Responses 来源且非负安全整数的聚合输入；完整分区、聚合输入或总量冲突时保持金额及小计未知。聚合输入仅用于选上下文档位，不计为普通输入。档位未知时使用两档共有费率的最小值形成可证下界，缺失普通输入仍为 null。结算、账本均传入冻结 Call 的 usageAccounting，预算继续累计 knownSubtotal；[client.js:76](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/client.js:76) 明确说明参考小计和最低费率口径。符合 ticket-contracts 第 34/36 行及 T11 契约第 9—11 行的分区、未知值与预算要求。

独立复验：原始 [a 轮脚本](C:/Users/a1500/AppData/Local/Temp/router-implementation/t11-v0120a-partial-subtotal-budget-repro.mjs) 原封不动 PASS：waiting-budget、1 次 Responses、普通输入未知、完整参考值未知、小计 USD 0.00052，夹具错误 0。4 项定向测试 PASS，覆盖显式金额等待/扩展恢复、缓存/推理及长上下文。附加受控检查确认可信长档小计 0.00079、非可信聚合来源被忽略、冲突聚合输入被拒绝；实际 Renderer 正确展示部分小计、预算下界及普通输入未知，错误 0。

结合此前完整 diff，无未解决 Standards findings；精确模型映射、冻结 Quote、API/订阅/实际账单分离、额度未知且不用于稀缺性排序和构建依赖边界保持。未重复运行整套检查；作者报告 c 轮 410 项、build/check PASS。只读源码、本地合成数据及受控 HTTP，无真实模型请求、Desktop、Computer Use 或 Codex 配置操作。旧失败报告保留；本结论不替代目标 Desktop 或官方真实门槛。
