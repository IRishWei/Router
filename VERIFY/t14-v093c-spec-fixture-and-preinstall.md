# T14 v093c fixture 与预安装 Spec 独立复审

## 结论

- **Router 0.9.3 core：沿用 PASS**
- **Companion 0.3.4：PASS**
- **v093c preinstall gate：PASS**
- **Package identity/closure：PASS**

未发现阻断问题。0.3.3 raw-envelope P2 与 v093b case15 绑定 P3 均已关闭；可进入实际安装验收。本结论不宣称 19 项已实际 PASS、T14 已关闭或真实账号/T24 已完成。

## Findings

无。

## 旧 Findings 关闭

1. **P2 raw envelope：已关闭。** `t14-companion034-source/lib/index.js:84-92` 在 `JSON.parse` 前对原始 prompt 执行 UTF-8 32768-byte 上限；research schema 仍优先于 rubric schema，非 JSON title 路径不变。源码与 fresh extraction 均验证 research leading whitespace、rubric internal whitespace/Unicode escape 在 32768 接受、32769 在零 text/usage chunk 前拒绝。
2. **P3 case15 绑定：已关闭。** `t14-v093c-installed-verify.mjs:254-279` 找出唯一 `kind === 'rubric'` requirement，逐条断言两份 valid/unconfirmed finding 的 requirementId、无 review `caseId`、无 finding `sourceQuotes`、canonical finding 精确四键、raw output 精确三键及 artifact hash；research claim-support 继续锁定 `REVIEW_ATTEMPT_LIMIT`。

## 需求符合度

- 0.3.4 仅新增验证 fixture 的统一 raw review 传输界限；research 六键结构、schema 优先级、rubric 封闭结构、四模型 verdict、真实 human/source-less 边界、sourced Host context 拒绝、signal、usage 及零外部能力均未改变。
- fixture 源码与 fresh extraction 独立各 11/11 PASS；真实 `AcceptanceCoordinator` 的新旧回归均通过。
- ROOT 与 source 包均为 3980B、SHA-256 `CB5127BAFE4CE2784700BFD6747EC4F60EB07563326B7C6816ACD086213A53B5`；四条目与 source 逐字节一致。
- c helpers 的固定 SHA 与提供值一致，语法检查通过；launcher/bundle-control 固定 Router 0.9.3 与 Companion 0.3.4 的完整身份，旧 0.3.3/0.3.2 文件不受影响。
- `t14-v093c-before-upgrade.json` 为 174 Tasks/config 458，完整 Tasks/config/DeepSeek/default 与失败轮恢复状态深比较一致；network-beforec 与既有不改网络链路保持独立门槛。
- 原 19 case、source/hash/quote/access≠support、两次 review cap、usage/cost ledger、预算 extend/stop/revoke、additive steer、partial `completed:false` 与 finally 恢复断言未放宽；Renderer 仍预期 193 Tasks 且仅用 live snapshot。

## 测试与验证缺口

- 按要求未重跑 Router 全量或操作 Desktop/RPC；仅运行 fixture 源码/解包 11/11、helper syntax/hash、包闭包及 174 基线深比较。
- 0.3.4 尚未安装；v093c 完整 19 Tasks、default-source、installed provenance/Renderer、恢复、重启、移除 fixture 后再重启与最终 193 Tasks 深比较仍须实际执行。
- 旧 v093/v093b 失败、恢复及 29 fixed + 2 prefix 保护证据只能作为历史失败证据，不能计入新轮成功。

## 剩余风险

实际 Desktop 运行仍可能暴露宿主时序或安装状态问题；任何 partial/paused/失败轮都必须继续保留并阻止 T14 关闭。fixture verdict 只认证封闭本地协议，不认证研究质量、真实账号或付费能力。