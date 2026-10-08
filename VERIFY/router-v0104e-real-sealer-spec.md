# 结论：BLOCK

被审封存器：`router-v0104e-seal-real-evidence.mjs`，12240 B，SHA-256 `10021D19BB80FDB1187A35B2031CF991529870E0D6D8F2A26FCDC4BAA4911237`。未执行。

## Findings

- **P1 — gate 未绑定被审封存器自身。** `:24-30,58-62` 只验证外部 gate SHA、归档 commit 和审查报告字节；没有读取 `import.meta.url` 并与 gate 中的 reviewed sealer bytes/SHA 比较。触发条件：本报告完成、gate 创建后，封存器本身发生漂移，再以原 gate SHA 执行。实际影响：漂移后的工具仍可写出 manifest/checker，审查结论不再约束真正执行的代码；`:125` 仅事后把漂移版本收入 manifest。修复方向：gate 明确携带本次 reviewed sealer 的长度/SHA，封存器在所有其他操作及写入前验证自身字节；增加“同一 gate + 修改封存器”拒绝用例。
- **P1 — 最终持久状态 snapshot 未被固定门禁验证。** `:64-66` 只校验可变 live `state.json`；`t09-v0104e-final-persisted-state.json` 仅因前缀在 `:127,132` 被盲目收入 manifest。触发条件：WX snapshot 在封存前损坏或被替换，而 live 仍为固定 `9045336 B / E7B1C776…54F3`。实际影响：封存器会永久记录与其“最终持久状态”结论不一致的 snapshot，生成的 checker仍通过。修复方向：写入前读取该 snapshot，固定长度/SHA，并逐字节等于 `rawBytes`；增加 snapshot 单字节漂移拒绝用例。
- **P2 — 验证的是脱离 canonical state 的 Task 副本。** `:80-101` 对 `real.task` 检查生命周期、两次失败和 ledger，却未断言它与 `real.state.tasks` 中同 ID Task 深度相等。触发条件：证据根部 Task 副本漂移但 state 保持真实 raw 投影。实际影响：同一封存包可包含相互矛盾的 Task/ledger 证据。修复方向：先定位 canonical Task，断言与 `real.task` 深度相等，再在 canonical 对象上检查 unknown-token/price ledger。

## 需求符合度

四份审查、九份归档、授权/marker、双包、六组旧保护与 v2 continuity、owner/CIM0、233/541/config578/claim 等门禁均位于两次 `wx` 前；冻结枚举未直接包含 live、owner 或五个未来可变根源码。以上三项仍使最终证据封存不具备审查后身份与副本一致性保证。

## 剩余风险

真实 T09 继续 BLOCK/OPEN；本工具不得被执行，且不产生任何新授权、Task 或模型请求。
