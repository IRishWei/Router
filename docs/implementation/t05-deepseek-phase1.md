# T05 DeepSeek API：Phase 1 受控证据

2026-10-07，基于集成提交 `98a0338` 和目标 Host 匹配的正式
`@deepseek-ai/dsh-llm-deepseek@0.2.0-rc.2`。本阶段只建立独立
DeepSeek 连接、目录和凭据模块；尚未接入共享 candidate registry、
Controller、Renderer 或完整 Router Task。

## 已实现边界

- API key 只写入 `irishwei-dsh-router/account-*` credential record；普通
  metadata 仅含记录存在性、身份、版本及分离的目录/能力/推理状态。
- 每个账号使用唯一 `router-deepseek-account-*` provider route 和独立
  Cordis fiber；不占用或替换原生 `deepseek-official`。
- 正式连接显式固定 `https://api.deepseek.com/anthropic`，受控测试仅允许
  loopback endpoint；不读取 `DEEPSEEK_API_KEY` 或
  `DEEPSEEK_BASE_URL`，`maxRetries` 固定为 0。
- 仅允许当前正式 `deepseek-flash`、`deepseek-v4-pro`，且仅声明文本和
  工具能力。图片在 Files/inline attempt 尚未证明可记账前保持不支持。
- `/models` 使用无凭据 GET，响应只形成目录事实；目录、声明能力与实际
  推理验证互不提升。未知模型只报告，不进入可调用 allowlist。
- credential record 变更、断开或 fiber 卸载先撤销旧 generation；已准备
  调用不能重绑新 key，网络请求数保持 0。

## 自动验证

`test/t05.deepseek.test.mjs` 使用临时 credential store 与本地 HTTP/SSE
服务，不读取真实 key、不访问真实网络、不产生费用。覆盖：

- 文本请求和工具往返，逐 Call 恰好一个 Messages POST；
- usage、401、断流、未知模型、prepared Call 撤销；
- credential 重启持久化、替换失效及 disconnect 删除；
- 目录 GET 不携带认证头，目录事实不冒充 capability/inference 验证。

## 尚未完成

T08 共享 registry 通过最终复审并合入 integration 后，需将本模块的安全
metadata 接入真实 `registerOwned`，再迁移共享 Controller/Renderer。最终
必须通过完整 Task 的预算、账本、身份和实际请求一致性测试；目标 Desktop
还需用户在安全界面选择凭据并授权一次有限预算真实请求。完成这些门槛前，
受控 SSE 不认证真实 DeepSeek API，T05/#6 保持打开。
