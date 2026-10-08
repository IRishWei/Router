# T09 0.10.7 Standards 修订复审

## 结论：PASS

固定范围：baseline `91932319c8958f2d3273bf4330d4b84a20ffb1fb`，author HEAD `a75394e8ea7dc60b543f53c3967d0aa668180296`；本轮重点复审 `3121aa9b63f5c89a4bc464bb818300861f4d828e..a75394e8ea7dc60b543f53c3967d0aa668180296` 的 3 文件增量。

## Findings

未发现阻断问题。首轮 P2 已关闭。

## 需求符合度

[src/chatgpt-responses.mjs:505](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:505) 将文本块绑定到 `itemId/outputIndex/contentIndex`，delta/done 的输出索引变化立即拒绝；[src/chatgpt-responses.mjs:541](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:541) 与 :554 同样固定工具项身份及参数增量索引；[src/chatgpt-responses.mjs:590](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/src/chatgpt-responses.mjs:590) 仅在空终态回退中，按最终项逐块核对 id、output index、content index、文本或完整工具字段，之后仍执行全可见序列比较。reasoning、message phase 和 function-call 重放信息保持。未见越界修改或 Fowler 基线异味。

原反例（最终 `msg-final/index 0`，文本 `different-stream-id/index 7`）现以 `MALFORMED_RESPONSE` 拒绝，`onInferenceCompleted=0`。

## 测试与验证缺口

独立复跑 focused 32/32 PASS；[test/t09.responses.test.mjs:652](C:/Users/a1500/.codex/worktrees/router-chatgpt-oauth/Router项目/test/t09.responses.test.mjs:652) 覆盖 item_id、output_index、content_index 三类漂移并断言不确认推理。全量留存日志为 345/345 PASS，SHA-256 `0FE2E0B86F5A836110EFB9C948BA0ED67BECE0C9A3038B636248C0EA0F9BB896`。

## 剩余风险

安全诊断没有原始 SSE，故受控事件形状仍是针对已知 1/0 块差异的修复假设。源码与受控测试通过不等于真实 0.10.7 推理验收通过；真实验证须继续遵守剩余有界授权。
