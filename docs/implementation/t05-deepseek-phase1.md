# T05 DeepSeek API：Provider 与 Router Task 受控证据

2026-10-07，Phase 1 基于 `98a0338` 建立 provider，Phase 2 合入已验收的
T08 integration `1ab2ab1`，继续使用与目标 Host 匹配的正式
`@deepseek-ai/dsh-llm-deepseek@0.2.0-rc.2`。

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
- 本模块的字符串 `credentialGeneration` 只标识凭据装载代次。阶段 2 由单一
  adapter 投影为 T08 registry schema，并独立生成其正整数 `authEpoch`；本模块
  metadata 不复制 candidate snapshot schema。
- `deepseek-router.mjs` 将安全 metadata 一次性投影到公开 `registerOwned`
  schema；候选默认禁用，由 Router 的公开方法显式启用并固定后才能执行。
- 同一 `accountId` 的 credential 写入是 create-only。未知新 key 必须使用新
  binding，因此产生新 provider/candidate 且不继承旧 pool 许可；删除旧 key
  会撤销 provider generation 并 tombstone 旧 candidate。
- 完整 Task 通过真实 rc.2 adapter 和本地 HTTP/SSE 执行。无价格时每个主调用
  与标题调用仍分别记入账本，费用保持 unknown；401、Task stop、重启和凭据
  撤销都保留逐 Call 证据。owned provider 边界只保留允许的失败 code/status，
  provider 错误正文统一泛化，避免其携带的凭据文本进入 Session 或 Task 记录。
- 独立 `deepseek-client.mjs` 将保存凭据、连接、candidate 启用和检测分为四个
  明确动作。API key 只在非受控 password input ref 与一次提交参数中短暂存在；
  页面状态、普通错误和安全 DTO 不含 key。检测列表以“模型候选”命名，
  同时展示连接、账号与计费来源，同名模型不合并。
- `deepseek-ui-contract.mjs` 用可注册到 Typert 的严格 schema 限制检测为
  1–4096 token、1–60000 ms。客户端只提交 candidateId 和预算；Host 从 T08
  权威 candidate snapshot 解析模型，在执行前取得 canonical candidate capture，
  并逐 Call 核对五元身份、registry/auth epoch、配置 revision、账本和完全相同
  的有限预算。Call 的 registry epoch 不得早于初始 capture；同一 Task 后续 Call
  因无关目录刷新取得更大 epoch 时仍有效，auth epoch 与配置 revision 则必须一致。
  检测结果必须是该次执行后 Router 快照中新建的 Task，不能复用历史 Task；执行
  后无关候选刷新不会因全局目录 epoch 增长而误判。无价格必须显示为 unknown。
- 0.7.0 已将账号保存、公开目录、连接、断开和检测接入共享 Host/RPC 与
  Renderer。Host 创建真实 SessionController Task，并在 Task 内固定显式候选；
  不修改自动路由、全局固定模型、默认模型或模型池。主请求和标题请求各自使用
  最终组装输入的 UTF-8 保守 token 预留与固定 32 token 输出上限。
- 检测耗时上限由 Task 持有，跨预算等待和扩展保持有效；到期同时取消原生
  Agent 请求及仍在运行的 owned 标题流。预算不足时 Call 保持 waiting 且零派发，
  用户可以通过统一 Task 预算接口扩展或停止。
- DeepSeek binding/connection/catalog 安全元数据随 Router state 重启恢复。新凭据
  写入若 Router state 持久化失败，会删除尚未绑定的 credential record 并向调用方
  返回泛化错误；普通快照、Session、Task 与 Renderer 不含原始 key。

## 自动验证

T05 测试使用临时 credential store 与本地 HTTP/SSE
服务，不读取真实 key、不访问真实网络、不产生费用。覆盖：

- 文本请求和工具往返，逐 Call 恰好一个 Messages POST；
- usage、401、断流、原始信号中止持续 SSE、未知模型、prepared Call 撤销；
- credential 重启持久化、替换失效及 disconnect 删除；
- 目录 GET 不携带认证头，目录事实不冒充 capability/inference 验证。
- 共享 Host/RPC/Renderer 保存与目录流程，显式诊断在暂停自动路由和另一固定
  候选存在时仍只作用于诊断 Task；低预算零 POST、等待后扩展、主 SSE 和标题
  SSE 截止中止，以及 Router state 写失败后的孤立凭据回滚。

## 尚未完成

共享 Remote facade、设置页面与 package bundle 已接入。目标 Desktop 仍需用户在
安全界面保存或选择凭据，并授权一次有限预算真实请求；此步骤由 root 在固定构建
通过独立审查后执行。完成该门槛前，受控 SSE 不认证真实 DeepSeek API，T05/#6
保持打开。
