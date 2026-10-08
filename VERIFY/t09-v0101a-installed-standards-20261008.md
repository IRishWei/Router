# 结论：PASS

## Findings

未发现阻断问题。实际验收流程符合仓库的隔离、保全和授权边界：

- `t09-v0101a-isolated-launcher.ps1:22-90` 在停止/安装前校验冻结包、唯一 owned Host、隔离 DSH_HOME 和普通 Desktop 已退出；只停止匹配 PID，并用官方 CLI 安装。`installed-hashes.json` 的 0.10.1/提交 `7813bac` 包含 29 个逐文件匹配项。
- `renderer.mjs:60-71,91-128` 仅将严格校验的官方 OAuth URL 交给系统浏览器；使用真实 Renderer、Typert codec 和公开 RPC。模型按账号目录首项选择，没有按名称猜能力。实际只新增 1 个 Task、2 个请求（execution + session-title），未超过授权；其后配置恢复和重启均为 0 次附加请求。
- 独立深比较确认：安装前 230 Task/536 Call 全部逐对象保留；新增后 231 Task/538 Call 在恢复和重启间 digest 一致。`restore-config.mjs:16-37` 恢复除合法 revision 外的原配置值；`preserve.mjs:73-94` 保留任务、DeepSeek、原生默认和脱敏 ChatGPT 元数据。
- 两个 Call 均记录 `INVALID_RESPONSE`、usage 为 `null`；账本总量保持未知且 `unknownTokenCalls=2`，没有把未知记零。失败 Session 的只读持久化证据保留 HTTP 200、非 SSE 的精确错误。指定 JSON 未发现 token、Bearer、完整授权 URL、cookie 或启动令牌。

## 需求符合度

实际流程未使用 Computer Use，未读取 Codex 配置/认证或凭据文档，未修改 DNS/全局网络设置，也未把受控验证当作成功推理。

## 测试与验证缺口

实际 OAuth、7 个账号目录候选、安装 Renderer、失败 Task、配置恢复和重启已覆盖；没有成功的 `response.completed` 或实际 usage。

## 剩余风险

T09 实际推理仍被阻塞：官方 Responses 两次返回 HTTP 200 但非 `text/event-stream`，Task 正确暂停为未确认。需查明真实响应形态/接入资格并在新的明确授权下复验；当前证据不能关闭 T09 或认证模型可用。
