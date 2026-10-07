# T16 v091c actual-installed Standards final review

## 结论

PASS。未发现阻断问题。

从 Standards 轴看，T16/#17 已具备关闭资格：固定 0.9.1/0.4.3 包身份、实际 17 Task、已安装 Renderer、恢复/重启/移除以及旧失败证据保护形成闭环。本复审不关闭 issue；总体关闭仍以并行的独立 Spec 结论为共同门槛。

## Findings

无。

## 需求符合度

- ROOT 固定在 `47d5e79c5e5c7a0054d2a36730a3dd399c74b12d`，工作树 clean；相对父提交只修改两份实施文档。文档明确区分“实际安装验收 PASS”与 #17 最终双轴门槛（`docs/implementation/t16-installed-host-evidence.md:3`、`docs/implementation/t16-consultation-evidence.md:34`），没有提前宣称 issue 已关闭。
- Router 0.9.1 包为 160169B / `1D3E99B28B142A45E629C3F371C17C5E2CED53D8D6E58983FB33BE0103BBB575`；24 个包条目均与当前安装逐字节相同，20 个 lib 与作者构建逐字节相同、与 ROOT 按换行规范化后相同。Companion 0.4.3 为 5613B / `4288C6E3E6B1A6EB264A973F2DBB6E32ED34FD0014B3FB113D64ADF2F63BA656`，精确五条目并与已审源码逐字节相同，符合文档第 7–16 行。
- `execution-evidence` 的 17 个名称和 Task ID 唯一，逐项与 `restored-state` 后 17 个真实 Task 的 lifecycle/result/acceptance/coordination/policy/inputs/calls/ledger/budget 全等；前 142 个 Task 与升级前基线逐字段相同。独立重算 754 项断言通过：4→9→14、unchanged、四类拒绝、四类 consultation failure、extend/stop/revoke、human steer 和 frozen policy 均满足预期。
- 58 个实际 fixture 已派发 Call 均有完整 `6/4/0/0/0/10` usage、精确 selection snapshot、`PRICE_UNKNOWN`/null amount/unconfirmed billing；每个 Task 的 known/unknown tokens、callCount、unknownPriceCalls 和 uncertainDispatchCalls 已独立重算一致。固定夹具声明 `paidApiCalls:0`、`semanticQualityEvidence:false`，文档第 33–35 行没有把缺价推导为零费用或把协议验证扩大成专家质量验证。
- human-steer 保留两条不同 requestId 的 10–20 与 1–20 要求，coverage/evidence 精确两项，四字分别 failed/passed 且整体 failed；两条 history 均 superseded，旧 consultation 未派发、reservation released，episode 为 `stale/HUMAN_INPUT_PENDING`，三个 advice 字段均为 null。旧 v091/v091b 证据仍为 `completed:false`，与文档第 47–51 行一致。
- Renderer 证据使用与安装包一致的 `client.js`，harness hash、集成 SHA、17 个自身 Task 条目及唯一 scoped text hash 均闭合；transport 只记录 `router/snapshot`。证据明确 `react-test-renderer` 且 `visualScreenshotVerified:false`，符合文档第 39–41 行，没有冒称视觉截图验收。
- 最终只读 live snapshot 仍为 159 Tasks/config 434，与 `restored-state` 的 Tasks/config/DeepSeek/default 全等；八个已移除 fixture 候选仅保留历史目录记录，全部 `available:false`、`enabled:false`。Companion 安装目录不存在，符合“fixture 不再可用”，并未把历史候选记录误写成物理删除。
- DNS、代理、hosts、路由器、Codex 配置/认证均未纳入或修改；文档第 64 行保留 T14/#15、Research/model-review 与真实凭据/付费授权边界，没有借 T16 扩大通过范围。

## 测试与验证缺口

- 按固定范围未重跑 production 287 项、companion 6/6 或再次创建 17 Tasks。已有非作者串行 287/287、T05 9/9、T16 12/12 记录与文档第 16 行一致。
- 本轮只读复核通过：证据交叉验证 754 项；Router 安装 provenance 24/24（lib 20/20）；companion 源/包 5/5；Renderer 元数据 17/17；三层保护 checker 分别 35/2、20/2、20/2 PASS。
- 固定执行脚本 SHA-256 为 `4B70F6DE6D4E609A5054EC9FF8686B9E41E2A40C1C70BED61B0A145E6283C180`，Renderer 脚本为 `0B36FD17D7814BB698D0C33391C77B5BE19348B3D16A5A418816E35E3E945A0A`。关键成功证据当前 SHA-256：execution `FAF33BBDEC39776259343B4D51B4679E51DB7466EB903706A59A3AE980B5F17E`、restored `FEE6764BC93E7842BE929C89747443CF5DA9C91146B5FAB49841CB690E75D51B`、renderer `7984B55D25D741F6243FB03625A9FBB8ABCE88147729F3E2DF124E242AFCDF05`。
- 实时核对仅通过既有 `isolatedRpc` helper 在内存中取得公开 `router/snapshot` 与 model catalog；未输出或人工读取 private log 内容，也未调用写 RPC。

## 剩余风险

- 实际验证使用本地 deterministic companion，只证明 Host、协议、协调、预算、持久化与 UI 数据链路；不证明外部模型建议质量、真实账号资格或付费路径。
- Renderer 验证覆盖真实组件树和 live snapshot 数据，但不覆盖浏览器像素布局；文档已明确该限制。
- 本报告仅给出 Standards 轴 PASS；#17 最终关闭仍需独立 Spec 轴同时 PASS。