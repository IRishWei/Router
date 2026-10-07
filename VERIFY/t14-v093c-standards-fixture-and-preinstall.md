# T14 0.9.3c Standards：fixture 0.3.4 与安装前 gate

## 结论

**PASS（安装前）**

- Router 0.9.3 core：沿用既有 **PASS**。
- companion 0.3.4：**PASS**。
- 冻结包身份与四文件闭包：**PASS**。
- v093c helper gate：**PASS（静态/安装前）**。

未发现 P0–P3 问题。此结论未宣称实际 Desktop 19-case、Renderer、重启或移除验收已经通过。

## Findings

无。

### 0.3.3 raw envelope P2：已关闭

`t14-companion034-source/lib/index.js:84-91` 对潜在 JSON review 的原始 `prompt` 使用 `TextEncoder` 计算 UTF-8 bytes，并在 `JSON.parse` 前拒绝超过 32,768 bytes 的输入。检查不再依赖 parse 后的 `JSON.stringify(input)`，前导/尾随/内部空白和 Unicode escape 的原始编码均计入上限。

新增回归 `test/companion.test.mjs:324-347` 同时覆盖：

- research 六键 JSON + 前导空白；
- rubric JSON + 内部空白与 Unicode escape；
- 32,768 bytes 接受并产生完整固定 usage；
- 32,769 bytes 在任何 text/usage chunk 前拒绝。

独立定向执行 1/1 PASS。

### c helper 的 rubric 证据补强：已满足

`t14-v093c-installed-verify.mjs:258-282` 在组合 case 中断言唯一 rubric requirement、两条 review 均 valid/unconfirmed、finding requirementId 精确绑定该 rubric、无 research `caseId/sourceQuotes`、raw output 为精确三键结构且 artifactHash 等于实际 artifact。结合 `REVIEW_ATTEMPT_LIMIT` 的 research claim-support 断言，能够证明两次 rubric Call 消耗共享上限，research Call 未派发。

## 需求符合度

- 0.3.3→0.3.4 运行时代码仅新增原始 review prompt 的统一 32 KiB parse 前门禁；research schema 仍在 rubric schema 前验证，research exact keys、输出和 verdict 语义未改变。
- 非 JSON title 请求仍走既有本地标题路径，不受 JSON review 门禁误判。
- rubric exact-key、digest、非空、1–16 唯一 ID、16 KiB artifact、4 KiB rubric、compact envelope、前 256 Unicode code points quote 约束保持。
- 四个固定模型、65,536 context、latest actual-human/source-less compatibility、sourced Host-context 排除、逐 chunk signal 与固定完整 usage 保持。
- 未发现网络、文件、环境、凭据、工具、发布、预算或权限能力。
- c helpers 仅更新 companion 0.3.4 固定身份、c 证据名和 rubric 证据断言；原 usage/ledger、budget、stop/revoke、steer、恢复、provenance 与 Renderer 只读门禁未弱化。
- `install-router-v093c-isolated.ps1:15-27` 继续在停止 owned Desktop 前固定 Router 0.9.3 与 companion 0.3.4 的唯一路径、大小和完整 SHA-256。

## 测试与验证

- 冻结 companion：3980 bytes，SHA-256 `CB5127BAFE4CE2784700BFD6747EC4F60EB07563326B7C6816ACD086213A53B5`；ROOT exclusive copy 同大小/hash。
- 精确四个包条目均与 0.3.4 source 逐字节相同。
- blocked 0.3.3 包仍为 3877 bytes、SHA-256 `B606AB23EEF596F77C67E40880F6CB317B4AAA568535E414C47E0D82F8A7BA60`，未覆盖。
- 作者记录 source/extracted 各 11/11；独立执行 raw envelope 定向测试 1/1 PASS。
- fixture 与五个 c MJS helper、bundle-control：`node --check` PASS；c PowerShell launcher parser PASS；所有 helper 大小/SHA 与冻结值一致。
- `t14-v093c-before-upgrade.json`：174 Tasks/config 458，与失败恢复状态的 Tasks/config/DeepSeek metadata/default model 深比较一致。
- `t14-v093c-network-before.json` fingerprint 与既有 v093 after 相同，未记录原始网络内容。
- 本轮未操作 Desktop/RPC、未创建 Task、未修改网络配置或生产源码。

## 剩余风险

v093c helpers 尚未执行实际 19-case、Renderer、restart/remove 与 after network fingerprint。只有实际证据完整通过且状态恢复深比较一致后，才能声明 T14 actual-installed PASS。
