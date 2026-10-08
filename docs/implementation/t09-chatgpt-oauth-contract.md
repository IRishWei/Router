# T09：独立 ChatGPT OAuth 开发与验收契约

2026-10-08 用户同意优先推进独立 ChatGPT OAuth，随后明确允许一次有界真实验收。T09/#10 仅将前置由 T06/#7 改为已关闭的 T03/#4；父规格、六条验收标准和其余票的前置保留。原发布快照和旧验收证据不改写，当前依赖修订见 `../planning/dsh-router-v1/dependency-amendments.json`。

## 授权与隔离

使用插件自身的开源应用动态注册和 ChatGPT 套餐授权，不要求 API Key。首次注册使用官方入口，随后按已验证账号和 issued client 身份恢复；稳定 host 标识独立持久化。只使用 DSH Host 凭据服务保存 token，普通 Router 状态、RPC、日志及导出不得包含 token、code、PKCE verifier 或完整授权 URL。Codex 配置、认证和环境 Key 不读取或修改。

浏览器操作由用户完成。监听仅绑定 `127.0.0.1`，启动成功后才打开系统浏览器；每次授权生成新的 state、nonce、S256 PKCE。专用授权开始 RPC 可在事务内返回导航 URL，客户端随即打开浏览器，不存入页面状态；返回登录不发送可选的 `id_token_hint` 或 email `login_hint`，由官方账号选择页及回调身份校验完成绑定，避免凭据进入 URL。回调必须一次性消费，核对 state、返回 client 与待授权身份，校验 ID token 的 JWKS 签名、issuer、audience、有效期、nonce 和 subject。持久化失败不启用连接。取消、超时、拒绝授权和非法回调保持可恢复状态，不能由登录成功推断推理权限。

依据：[注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号及凭据](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

## 模型调用与预算

仅在实际返回套餐使用 scope 后允许请求，使用同一账号 token 获取官方模型目录并调用公开 Responses。目录可见、声明能力和成功完成推理分别记录；模型身份包含连接、账号和订阅计费来源，新候选默认禁用。未知能力不猜测，不能用 Codex 缓存目录认定账号资格。

按当前官方契约发送完整上下文，使用 `store:false`、`stream:true`，只以 `response.completed` 作为完成依据。不发送该路径不支持的字段或工具；system 指令和函数工具显式转换为受支持表示，不静默截断历史或丢失工具记录。incomplete、failed、断流和权限错误保留精确状态及已知用量，不自动转用 API Key 计费或透明重试。

全部请求沿用 T03 的统一 Call 预留、派发意图、资格复查、取消和结算。实际订阅消耗、参考价值及未知额度分开记录；未知价格或用量不得记零。当前官方 HTTP 契约不接受 `max_output_tokens`，因此不能宣称有服务端输出 token 硬上限；使用明确的请求次数、完整输入保守预留、持续时间限制及取消，并保留估算不确定性。

依据：[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[错误恢复](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)。

## 本轮许可与验收门槛

- 用户已允许：OAuth 就绪后在 DSH 运行最多1个Task、最多2次模型请求，计入可能的标题调用。预留超过当前预算时先暂停，不自动扩展预算；仅使用已授权 ChatGPT 套餐路径。
- 登录和套餐使用同意由用户在浏览器完成，不要求用户发送密钥或 token。没有账号资格时如实报告限制，不使用受控夹具认证真实接入。
- 开发先通过已确认的完整 Task/SessionController、公开 Router RPC/Renderer、受控 OAuth HTTP 回调与 Responses 端点验证。独立 Standards/Spec 和非作者合并后，使用全新证据标签及当时完整历史基线开展目标 Desktop 安装、授权、任务和恢复验收。
- 目录、授权和推理遵守无 DNS 修改合同，自动适配现有系统网络，保留 TLS、公共目标绑定、绝对 deadline 和取消；不改系统代理或全局 dispatcher。
- T09 实际验收通过前保持打开；T06、T05 的真实 API 门槛独立保留。T10 全量续期/切换/退出恢复、T11 订阅参考价值，以及后续效果实验和策略试用不由本轮许可提前认证。
