# T14 v0.9.3e actual-installed Standards review

## 结论：PASS

未发现阻断问题。公开实际安装证据足以证明 T14 在本次目标 Windows DSH Desktop/home 与当前网络中达到“安装后直接使用，无需修改 DNS/hosts/系统代理/路由器或 Codex 配置/认证”的关闭门槛；T14 具备关闭资格。本报告不执行闭票。

固定身份：ROOT `6fffd362d72f5befc7f1b03dc920866842c3d5d9`；作者 `8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f`；Router 0.9.3 包 163149 B / SHA-256 `AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3`；Companion 0.3.4 包 3980 B / SHA-256 `CB5127BAFE4CE2784700BFD6747EC4F60EB07563326B7C6816ACD086213A53B5`。本次独立重算中两份冻结包的实际大小与 SHA-256 均匹配。

## Findings

无 P0/P1/P2/P3 finding。

## 需求符合度

- 实际执行证据标记 `completed: true`，211 条原 Task 前缀逐对象深等保留，19 个新 Task ID 唯一且按序追加，恢复态共 230 条；19 个 evidence case 的 session/turn/input/lifecycle/result/calls/ledger/budget 与恢复态对应 Task 一致（`t14-v093e-execution-evidence.json:15`；`t14-v093e-restored-state.json:6`）。配置除单调 revision `525→560` 外逐字段深等，default model 与 DeepSeek metadata 深等，`storageError=null`（`t14-v093e-restored-state.json:268592`）。
- 独立逐 Call 重算得到 53 次已派发、3 次未派发、14 次已派发 review，总 usage 424 tokens。每次已派发 fixture Call 均为 4 input + 4 output、总 8，`priceQuote=null`、`cost.amount=null`、`PRICE_UNKNOWN`、billing unconfirmed；逐 case ledger 的 tokens/knownTokens/callCount/unknownPriceCalls 全部等于实际派发集合，money 为空、unknownTokenCalls 与 uncertainDispatchCalls 均为 0。3 次未派发 Call 均 usage=null、reservation released、`NOT_DISPATCHED`，未进入账本。
- 预算 extend/stop/revoke 均锁定同 Task、waiting call、4096 proposed tokens、前置 16 known tokens 与 `EXPECTED_LIMIT_EXCEEDED`。extend 完成；stop 为 `ABORTED/BUDGET_STOPPED` 且仅 stop case 有 `budget-stop`；revoke 为 `MODEL_NOT_FOUND/MODEL_DISABLED` 且无 stop 动作（`t14-v093e-execution-evidence.json:21885`）。steer 的两次输入分别绑定各自 requestId/messageId/contentHash 与 origin seq `8→21`，旧 review 未派发并释放，新 review 实际派发，最终 passed（`t14-v093e-execution-evidence.json:24804`）。
- 来源语义负例与门禁成立：可访问不自动等于支持论点；跨模型未授权、正文缺失论点、来源缺失、引文不匹配、私有地址、未解析研究要求、评审冲突及共享评审上限均保留对应精确 reason。所有 acceptance coverage ID 均属于 requiredIds；passed case 全覆盖且无 failed/uncovered。17 个 available source snapshot 的公开 display URL 不含 query，research 树无 `body` 字段；默认生产来源在无 override 下返回 200/2214 B/固定 content hash，`injectedNetworkOptions=false`（`t14-v093e-installed-default-source.json:6`、`:10`）。
- 已安装 provenance 有 25 项，其中 21 个 `lib/`；逐项 installed hash 等于 package hash，21 个 lib 均匹配作者 build 与 ROOT 规范化内容。已安装 `lib/client.js` hash 与 Renderer 证据一致（`t14-v093e-installed-hashes.json:5`、`:35`）。
- Renderer 通过真实 native renderer、Typert codec 与 live public snapshot carrier，只调用 `router/snapshot`；19 个 displayed case 的 Task ID、名称、lifecycle、verdict 与执行证据逐项一致，且 history/config/credential metadata/default 均标记保留（`t14-v093e-renderer-evidence.json:4`、`:10`、`:188`）。
- 启用前 211、恢复/重启/移除后 230 的历史与配置保护成立；公开移除后 fixture unavailable，再次重启仍保留完整状态（`t14-v093e-companion-removed-evidence.json:7`）。网络 before/after 的 schema、DNS 配置、当前用户代理配置和 hosts 四个 fingerprint 字段逐字段深等，且未记录 raw network settings（`t14-v093e-network-after.json:3`、`:10`）。
- 历史失败未被改写：`t14-v093-partial-evidence.json`、`t14-v093c-partial-evidence.json`、`t14-v093d-partial-evidence.json` 分别仍为 `completed:false`（14/17/18 cases）。非作者集成报告记录最终 `check`、`build` 与串行 290/290 通过（`VERIFY/t14-v093-non-author-merge.md:22`、`:25`）。

## 测试与验证缺口

- 本轮遵守冻结边界，没有重跑 290 项生产测试，也没有操作 Desktop、RPC、进程、Task、安装包或网络；结论来自对既有公开 JSON、冻结包与非作者集成报告的独立只读重算。私有日志未读取，旧保护 checker 的六组 PASS 结果沿用既有门禁。
- Renderer 证据是 live public snapshot 的真实 DOM mount 与逐 Task 文本/控件断言；`visualScreenshotVerified=false`。T14 的关闭要求不以截图像素验收为门槛，因此不构成阻断。

## 剩余风险

- 结论只覆盖生产“来源网络兼容”在本次目标宿主与当前网络中的实际路径。它不认证 T05/T06 的真实远端账号、凭据或调用授权，不认证 T24 整个插件交付，也不证明 fixture 的模型语义质量或所有其他网络环境。
- 固定 fixture 仅用于可重复验证协议、预算、来源证据与状态恢复；实际付费 API 调用数为 0。后续网络/代理实现或宿主版本变化仍需各自回归。