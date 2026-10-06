# T08 公开宿主连接复用证据

目标为 DSH Desktop 0.2.0-rc.2 / Cordis 4.0.4，Router 0.4.0。自动化使用真实 SessionController、AgentLoop、Renderer、Typert 和公开 RPC；provider 传输为独立受控边界，不联网、不读取凭据。

## 固定接口

`src/connections.mjs` 的 `ConnectionRegistry.snapshot()` 输出 `{ snapshotEpoch: number, capturedAt, candidates, unsupported }`。每个候选包含 Host 分配的稳定 candidateId、嵌套五元 identity、ownership/source、正整数 Router `connectionConfigRevision`、`authEpoch`、可空且允许为 0 的宿主 `observedSettingsRevision`、Router 使用许可、provider 授权事实、可用状态、推理验证、能力与容量事实、quote/quoteVersion。公开合同没有给出的账号、计费、能力和容量保持 unknown/null。

`capture(candidateId, config)` 固定 `{ candidateId, identity, registryEpoch, connectionConfigRevision, authEpoch, capability/capabilities, maxContextTokens, quote, quoteVersion, enabled }`。`assertCurrent` 与派发 guard 比较当前 route、epoch、revision 和池资格。`registerOwned(source)` 按精确 route 登记并返回 disposer；不按 provider 前缀猜归属。Host-only `exactTask` 返回克隆，`publishAcceptance` 只接受版本化验收结果；二者不进入 Typert RPC。

## 自动化结果

- 两个同名模型来自不同 native route 时 candidateId、connectionId、启用、固定、报价和 Call 身份互不串联；未启用时零 provider 调用。
- 主动启用后通过完整 Task 得到受控响应；prompt/header/Call 五元身份、candidateId、selectionSnapshot、quoteVersion 和 5-token 用量一致。
- 删除池候选后下一固定 Task 暂停。宿主卸载 provider 时，已准备但未派发的 Task 为 CONNECTION_REMOVED、零 adapter entry；重启后 candidateId 稳定、epoch 更新、历史配置保留。
- settings/document-updated 在同步边界增加 revision/authEpoch；prepared Task 等待期间修改设置，释放后为 CONNECTION_CHANGED、零 adapter entry。credential reference/record 更新采用同一保守失效策略，因为公开元数据不能证明具体账号映射。
- refresh 使用 generation gate；延迟 listModels 的旧回包不能复活随后已移除的 provider。
- 已开始流沿用原 Call；原有 T02/T03 回归继续覆盖流内撤销、预算等待、retry 撤销、已知用量保留、原生 pending 和任务保活。
- owned route 在 native 目录已可见时重分类为单一候选；snapshot 不投影未识别字段或 secret。candidateId 与另一候选五元 identity 拼接的 reserveCall 在创建 Call 前拒绝。
- 实际 rc.2 Renderer 通过 RPC 刷新、显示来源/未知授权/不支持 provider，并以 candidateId 加入模型池。

独立 `companion/native-provider` bundle 仅用公开 LLM 注册合同。`scripts/verify-native-companion.mjs` 为 root 的隔离 Desktop 安装验收准备两阶段 RPC：发现→未启用对照→主动启用→完整 Task，以及卸载→旧 fixed candidate 完整 Task 阻止→历史/default/config 恢复。实际 Desktop 结果由 root 单独记录；本页不以自动 fixture 认证远端 API、真实账号或通用社区兼容。
