# T09 0.10.4e `content-type: missing` 只读诊断

## 结论

高置信结论：安装包没有在 Responses adapter 或 DSH 调用链中丢弃 `content-type`。本次两个 HTTP 200 响应到达插件的 Node `IncomingMessage.headers` 时都没有可读取的 `content-type`，因此被安全地分类为 `missing` 并以 `INVALID_RESPONSE` 停止。

当前证据不能进一步区分缺头响应来自官方端点还是 TLS/系统代理链路中的响应方；二者都属于插件外部 HTTP 对端/链路行为。没有读取响应 body，不能推断其内容或原因。

## 实际证据

- Task `eefbe023-a0a9-4320-85c3-a5817bdfa41e`：`paused / INVALID_RESPONSE / unconfirmed`。
- 两个 Call 均已派发并失败，usage 均为 unknown；账本为 2 个 unknown-token Calls、2 个 unknown-price Calls，没有伪造用量。
- 脱敏 native records 16 与 18 均保留固定消息：`Responses endpoint did not return an event stream (content type: missing)`，HTTP 状态为 200。
- 未发生透明重试；adapter 的 retry policy 固定 `maxRetries: 0`。

证据文件：

- `t09-v0104e-real-task-evidence.json` SHA256 `13FD9105BD1DC96AC9D5D4A1299CE789F535426A957F0E880CE2CB1D4E13F119`
- `t09-v0104e-native-session-decoded.json` SHA256 `8FD1D4EF4AAACAC0958BD07DA9901F68B53817A82F1E06C25D8B1066C70D49DF`
- `t09-v0104e-restart-evidence.json` SHA256 `5078E44F23FC16AF36B4F1943B926AB17BE2702039D543F2CFCC90FA87064844`

## 源码链路

1. `src/chatgpt-host.mjs:76` 默认构造 `createSourceNetworkTransport({ lookup })`。安装环境中 `routerChatGptTransport` 仅在 Router 自身入口出现，没有其他已安装模块提供覆盖实现。
2. `src/chatgpt-router.mjs:44` 原样调用 `spec.transport.request(url, options)`。
3. `src/source-network.mjs:387` 将 Node HTTPS 回调的 `incoming.headers` 原样作为 transport response 的 `headers` 返回，没有筛选或转换响应头。
4. `src/chatgpt-responses.mjs:220-223` 的 `headerValue` 同时支持 Fetch `Headers.get()` 和普通对象，并进行大小写不敏感查找。
5. `src/chatgpt-responses.mjs:699` 从 transport response 读取 `content-type`；仅在值不存在或为空时分类为 `missing`，随后在 `:711` 生成当前固定错误。
6. DSH 公开库 `@deepseek-ai/dsh-llm/lib/index.js:2203-2231` 只把一次性 prepared call 派发到 `adapterCall.stream(options)`，不接触 HTTP response 或 headers。
7. 安装包对应文件保持同一实现：`lib/source-network.js:387` 直接返回 `incoming.headers`；`lib/chatgpt-responses.js:220` 使用同一 `headerValue`。

因此，在实际默认 transport 路径中，`headerValue` 收到的是 Node 普通 header 对象，不存在 DSH header schema 不匹配。

## 已验证的可证伪假设

1. **最可能：HTTP 对端或链路中间层返回 200 但没有 `content-type`。** 预测是 transport 暴露的 header 对象缺少该键，adapter 稳定分类为 `missing`。实际事件与受控缺头测试完全一致。
2. **已排除：插件 transport 收到该头后丢失。** 生产 CONNECT/TLS 受控测试同时验证 SSE 与 JSON `content-type` 能穿过 `source-network` 到 adapter；测试通过。
3. **已排除：`headerValue` 只支持错误的 header 类型。** 它支持实际默认路径的普通对象，也支持带 `get()` 的 Headers 风格对象。
4. **已排除：DSH 在 adapter 后处理时删除 header。** DSH 只调用 adapter stream；HTTP response 从未经过 DSH header 投影。
5. **仍未知：缺头响应由官方端点还是网络中间层产生。** 现有安全证据没有保存 TLS peer 或 raw header presence，也没有读取 body，不能可靠细分。

## 受控验证

已运行，均通过：

```text
node --test --test-name-pattern "HTTP 200 non-JSON non-SSE failures" test/t09.responses.test.mjs
1/1 PASS

node --test --test-name-pattern "production CONNECT transport preserves HTTPS SSE" test/t09.proxy-responses.test.mjs
1/1 PASS
```

第一个测试证明空 header 对象产生本次精确固定分类；第二个测试证明生产 CONNECT/TLS transport 不会丢失受控源提供的 `content-type`。

若未来获得新的明确请求授权，最有价值的单次诊断是在 `streamingResponse` 边界仅记录固定枚举：`content-type present/missing`、`rawHeaders name present/missing`、`proxy/direct`，不记录 header 值、body、URL、凭据或 cookie。若 `rawHeaders` 也 missing，可确认 HTTP peer 未发送；若 raw present 但 normalized missing，才需要调查 Node 解析。该观测应先用受控 origin/proxy 测试验证，且不能自动重试。

## 本轮边界

本轮未修改源码、工具或历史记录；未启动 Host、OAuth、Task 或模型 HTTP 请求；未读取任何认证材料。