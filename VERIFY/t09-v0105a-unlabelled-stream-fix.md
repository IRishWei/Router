# T09 0.10.5：缺少 Content-Type 的 Responses 流兼容修复

2026-10-09，按用户“修复这个问题”继续开发。修复前基线为 `b22708e46c5a7aee55c9531a4b8ad9297aaf2dd3`；全24票最终审查基线仍为 `7d882d45a134993703c6010f28be1d2cd1364863`。

当前结论：已修复一个可确定复现的插件兼容性缺陷；真实失败响应的正文未保存，尚不能确认这就是 0.10.4e 失败的全部原因。T09/#10 保持打开，已有真实验收许可均已消耗，本轮没有新增真实模型请求。

## 失败与修复

旧 adapter 在 HTTP 200 缺少或只有空白 Content-Type 时，读取正文之前直接抛出 `INVALID_RESPONSE / content type: missing`。通过生产 CONNECT、TLS 和 Responses adapter 的受控测试，在正文包含完整合法 SSE 和 `response.completed` 时稳定复现完全相同的错误。

现在仅对没有声明媒体类型的成功响应进入现有 SSE 解析器。它仍要求有效 UTF-8、JSON 事件、完整输出及 `response.completed`；显式 JSON、HTML、其他媒体类型继续原有拒绝策略。绝对 deadline、取消、16 MiB 响应限制、零重试、完整输入和统一 Call 结算沿用原实现。

此处理与 [OpenAI 官方 Node SDK 的 stream:true 分支](https://github.com/openai/openai-node/blob/master/src/internal/parse.ts)一致。官方套餐流程仍要求 [公开 Responses、store:false、stream:true，并等到 response.completed](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)，未改用 backend-api 或 API Key。

## 可重复反馈

在 `router-chatgpt-oauth` 工作树运行：

```text
node --test --test-name-pattern 'production CONNECT transport accepts HTTPS SSE' test/t09.proxy-responses.test.mjs
修复前：0/1 PASS，INVALID_RESPONSE / content type: missing，约214ms。
修复后：1/1 PASS，约229ms。
```

测试同时检查带头与缺头 SSE 的完整输出、工具/结束表示，以及显式 JSON 错误。请求穿过实际生产 CONNECT/TLS transport，不是直接替换 adapter 输出。

验证结果：

- `npm run build`、`npm run check` 通过。
- Responses 和 CONNECT 聚焦测试17/17通过。
- 完整 DSH 原生 Task 集成测试9/9通过：缺头 SSE 工具往返完成；缺头 JSON 仍暂停、只派发一次、未知用量不记零；标题和两次请求上限保留。
- `node --test --test-concurrency=1 test/*.test.mjs`：338/338通过，约52秒。日志保存为临时验证目录的 `t09-v0105a-full-regression.log`。
- 普通 Node 与 DSH Electron Node 的无认证只读 GET，以及无认证且无模型的空 POST，均观察到401及存在的 Content-Type。没有使用账号凭据，不计为模型推理验收。

## 旧诊断的限定

冻结的 `t09-v0104e-missing-header-diagnosis.md` 原文保留。其受控传输测试只能证明正常头可以穿过该链路，不能证明真实失败正文不是合法 SSE，也不能排除 adapter 的过严头部门槛。因此“高置信不存在插件缺陷”的推断过强，本文件明确限定该结论。

若真实正文为空、JSON、HTML或截断，此修复仍必须停止，不能凭HTTP 200标记推理已验证。最终是否恢复真实推理，需要在新的明确有界许可后验证；此前不关闭T09，不修改已冻结失败记录和233个Task/541个Call。
