# T09 0.10.7 Standards 独立复审

## 结论：BLOCK

固定范围：`91932319c8958f2d3273bf4330d4b84a20ffb1fb...3121aa9b63f5c89a4bc464bb818300861f4d828e`，6 个文件。

## Findings

- **P2 — [src/chatgpt-responses.mjs:490](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:490)、[src/chatgpt-responses.mjs:503](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:503)、[src/chatgpt-responses.mjs:583](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:583)**：空终态回退只校验 `output_item.added/done` 之间的 `id/type/output_index`；文本块另以 `item_id/content_index` 聚合，未与最终项的 `id/output_index` 关联。受控复现中，最终项为 `msg-final/index 0`，文本事件为 `different-stream-id/index 7`，正文同为 `OK`，仍产生 `finish: stop` 并确认推理。影响是矛盾事件图被当作合法完成，重放元数据可绑定到另一流式项，违反 [VERIFY/t09-v0107a-terminal-envelope-fix.md:15](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/VERIFY/t09-v0107a-terminal-envelope-fix.md:15) 声明的连续索引和身份稳定。修复应在空信封回退前把每个可见块绑定并核对最终项的 `item.id/output_index`；新增分别篡改 `item_id` 与 `output_index` 的拒绝测试，断言不调用 `onInferenceCompleted`。

## 需求符合度

范围、版本、空信封限定、连续最终项、完成状态、正文比较及 reasoning/message phase/function-call 重放均符合；未见 Fowler 基线异味。上述身份关联缺口使严格一致性要求未完全满足。安全诊断只支持“1 个流式块、0 个终态块、21 bytes”，文档没有伪称已捕获真实逐项 SSE。

## 测试与验证缺口

独立复跑 31/31 targeted PASS；重跑日志为 344/344（SHA-256 `ECB9AAC75136E5DC5B149EA4E2970CA06A228F07C6E544B9D55F9B52FD3F4A88`）。现有负例覆盖 added/done 身份漂移，却未覆盖文本事件与最终 message 的身份/索引漂移。

## 剩余风险

受控测试不能证明真实 0.10.7 接入通过；修复此项后仍需按剩余授权做有界实际验收。
