# T14 0.9.3e Standards：helper-only 安装前 delta

## 结论

**PASS（安装前）**

- Router 0.9.3、companion 0.3.4、冻结包：沿用既有 PASS，本轮无变更。
- v093e installed verifier：PASS。
- e provenance/Renderer/default-source：PASS。
- bundle-control/launcher：与 d 逐字节相同，PASS。

未发现 P0–P3 问题。该结论仅覆盖 helper delta；e 的实际完整 19-case 尚未执行。

## Findings

无。

## 需求符合度

d helper 的失败来自读取了不存在的 `Task.inputs[].seq/text`。生产公开 schema 在 `src/index.mjs:293-303` 明确记录 `messageId/requestId/turn/contentHash/claimedAt`，而消息 seq 属于验收 requirement 的 `origin.seq`。e 修正与真实 schema 一致，且加强了行为绑定：

- 两次 RPC 使用预先保存且不同的 `initialRequestId`、`supplementalRequestId`，并分别精确匹配两个 Task input。
- 两个 input 的 messageId 必须不同，turn 均绑定原 Task turn。
- 两个 input 的 `contentHash` 分别等于实际发送 content 的 SHA-256，取代无效的 `text` 字段检查，仍精确绑定原始与补充内容。
- 初始 research-claim requirement 必须绑定第一个 input 的 messageId/requestId；新增 `includes-literal: CORRECTED` 必须绑定第二个 input。
- 两个 origin 必须为 `user-message`，seq 为正安全整数且补充 seq 严格递增。
- Task timeline 中全部 `input-claimed` 的 messageId/requestId/turn 必须与两个 inputs 按顺序深等。

这些断言位于 `t14-v093e-installed-verify.mjs:360-407`。原同 Task/turn、两个 review Call、旧 review `not-dispatched`/released、零旧派发、新 review completed、最终 artifact hash、superseded history、usage/ledger 等断言均保留，因此没有通过 schema 修正放宽 steer 行为。

baseline 从 192 更新为 d 实际完整恢复的 211 Tasks，并深比较 `t14-v093d-restored-state.json`；EXPECTED_CASES 仍为完整 19 项，成功后 Renderer 预期 230 Tasks。

## 测试与验证

- d partial evidence：`completed:false`、已记录 18 cases；第 19 个实际 Task 为 `completed/passed`，helper 仅因读取不存在的 `inputs[].seq` 失败。
- d 最终 Task 的公开证据确认：
  - inputs 精确两项，requestId/messageId 各自不同，turn 均为 1；
  - contentHash 与重建的初始/补充 RPC content 分别一致；
  - 初始 research origin seq 8，新增 `CORRECTED` literal origin seq 21；
  - 两条 `input-claimed` timeline 与 inputs 的 messageId/requestId/turn 按顺序一致；
  - 原 review `not-dispatched`/released/`ACCEPTANCE_SUPERSEDED`，新 review completed，最终 artifact revision 2，旧 artifact 在 history 中 superseded。
- 使用上述 d 完整公开 Task 独立重放 e 新断言：PASS。
- `t14-v093e-before-upgrade.json`：211 Tasks/config 525，与 d restored-state 的 Tasks、config、DeepSeek metadata、default model 深比较一致。
- e network-before fingerprint 与 d network-after 一致，未记录原始网络内容。
- e verifier 34175 bytes、SHA-256 `EBD7880C062DC8D333C8FCBB9C9BDFC632FA58A95CF9D63BCE62996FA966E693`，匹配冻结值。
- verifier、provenance、Renderer、default-source、bundle-control 的 `node --check` PASS；后四者仅更新 e 标签与 Renderer 230 数量。
- e bundle-control/launcher 与 d 对应文件逐字节相同。
- d 失败保护 manifest 为 6589 bytes、SHA-256 `F84F2A022139E6FB25A1DB6C42FDDA696505E03F0A55A0C307A62EB8CF6D14E5`，包含 24 fixed + 2 prefix。
- d bundle-remove 与失败后 restart 证据均记录 211 Tasks/config 525、历史/config/metadata/default 保持；network after 与 before 一致。
- 本轮未操作 Desktop/RPC、未创建 Task、未修改源码、包、网络或旧证据。

## 剩余风险

v093e 尚未实际执行完整 19-case、Renderer、restart/remove 与 after network fingerprint。只有生成 `completed:true` 的 19-case 证据、达到 230 Tasks，并通过完整恢复深比较后，才能声明 actual-installed PASS。
