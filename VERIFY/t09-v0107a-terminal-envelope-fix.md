# T09 0.10.7：空终态信封的输出组装修复

范围仅为当前 ChatGPT Responses 一致性故障，不推进其他开发项。

## 实际诊断

用户为本次定位与修复验证合计授权 2 Tasks / 4 requests，每 Task 65536 tokens / 120000ms，包含标题调用，不自动重试、扩额或切换 API Key。

0.10.6b 诊断使用 1 Task / 2 requests。Task `6e50fa61-33fa-4340-955b-9481698e0155` 暂停，两 Call 为 failed/interrupted，均已开始派发，用量未知。原生 Session 保存了完整文本 `CHATGPT_CONNECTION_OK`，随后安全比较信息为 streamedBlocks=1、completedBlocks=0、streamed.textBytes=21。这确认失败发生于完成输出比较，而非文本生成。未采集原始 SSE，不能把推导的逐项事件序列声称为真实抓包。

恢复配置及原生默认、重启检查均通过：235 Tasks / 545 Calls / config 590，旧历史保持。独立 DSH 已停止。

## 修复与回归

此前只读取 `response.completed.response.output` 作为最终重放输出，忽略 message/reasoning 的 `response.output_item.done`。现在收集按 output_index 排列的完整最终项；仅当终态 output 是空数组时使用这些最终项。最终项必须连续、全部完成、身份稳定，且可见内容仍须与闭合的流式输出完全一致。非空终态、矛盾文本、未完成块及失败事件保持原检查，不合成缺失内容。

保留完整 message phase、reasoning encrypted_content、function call 字段供后续重放。无 usage 时仍为未知，不推算零用量。只有合法 `response.completed` 才确认推理成功。

新的适配器回归在修复前产生相同的 1/0、21 字节错误；修复后通过。针对性 31 项覆盖普通终态和空信封下的完整原生工具往返、重放元数据、未知用量以及缺项/矛盾/重复/索引非法/身份漂移拒绝。

官方事件定义：[Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)。最终 reasoning 内容位于 output_item.done；完成以 response.completed 为准。实际安装验收尚待执行，受控通过不代表真实接入已通过。

构建与 check 通过。全量首次 343/344，唯一失败为无关 T16 临时目录清理的 ENOTEMPTY；T16 单独重跑通过，完整重跑 344/344 通过。保留两轮原日志，不修改 T16。

独立 Standards 首轮发现文本事件与最终项的 item_id/output_index 未关联（P2）。已补齐 item_id、output_index、content_index 对应检查及文本/工具索引漂移拒绝。新增三个编号漂移拒绝用例，onInferenceCompleted 保持未调用。修订后 focused 32/32、build/check、全量 345/345 通过，旧审查与日志保留。
