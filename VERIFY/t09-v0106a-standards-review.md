# T09 v0.10.6 Standards 源审查

固定范围：`e7b2cd7e67ca98b068ecfd3b5a6f464ceca1adf6...91932319c8958f2d3273bf4330d4b84a20ffb1fb`；单提交 `fix(chatgpt): preserve reported usage on invalid terminal output (#10)`。

## 结论：PASS

## Findings

未发现阻断问题。

## 需求符合度

`src/chatgpt-responses.mjs:450-472` 仅生成块数、首个差异索引、类型、UTF-8 byte 长度及匹配布尔；不包含正文、call ID、工具名或参数。诊断由局部 helper 统一生成，未触发 **Duplicated Code（“extract shared logic”）**、**Shotgun Surgery（“gather logical change”）** 等基线 smell。

`src/chatgpt-responses.mjs:558-590` 保留既有严格终态比较：合法 reported usage 在 output/unfinished/unsupported 验证失败时先发出再抛原错误；缺失 usage 仍未知。`onCompleted` 仍位于全部终态验证之后，失败不会确认 inference。请求正文、deadline、零重试及无 API fallback 路径未改，符合 `docs/implementation/t09-chatgpt-oauth-contract.md:15-19`。包与 lockstep 版本均为 0.10.6。

## 测试与验证缺口

独立运行两个相关文件 28/28 PASS，并通过 `git diff --check`。新增测试覆盖四种冲突形状的脱敏诊断、合法/缺失 usage、unsupported output，以及原生 Task 单次失败的 18-token ledger、零 retry、零 inference confirmation。全量证据 `t09-v0106a-full-regression.log` 为 341/341 PASS，34988 bytes，SHA-256 `3C4754A6304BD8105A5F200BFC3308E31B7D5374F97658F6A6551620EC5744B3`。

## 剩余风险

本提交只增加安全诊断与失败结算；未捕获的真实 completed/streamed 结构差异仍未修复。0.10.5b 实际推理继续 BLOCK，不能以本轮受控测试替代新的实际验收。
