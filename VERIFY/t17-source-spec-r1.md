# T17 Source Spec r1

FAIL，1 项。固定范围：base `3a8d9891fd11e1b4e2fd4621a32ad5204996d963` → head `6e1b6ca925044f058fe19963ea2fbbe82bd2fa9c`；已确认 HEAD、干净工作树及非空三点 diff。后续源码读取使用固定 archive。权威规格为冻结的 IRishWei/Router #1/#18。

- **[P1] 已知 native root 下的 missing-definition child 可丢失错误记录并放行接管。** #18 要求“携带完整可跨模型对话、用户约束、文本/图像和已完成工具记录”，并“完整任务验证……重复副作用防护”；固定合同进一步要求“outer completed 不能掩盖 pending/unknown child”。`src/takeover.mjs:366–375` 的结果归属只有 `binding?.taskOwners ?? parent?.taskOwners ?? (exec.agent && this.#nativeRoot(exec) ? […] : [])`，没有按活动 native root 回收 owner 的路径。当 outer 使用公共 Tools.execute 调用不存在的工具，传入真实但未观察的 Host parent token、正确 native root、并省略 agent，公开 SDK 的 createExecution 非 ready 分支直接产生 UNKNOWN_TOOL，跳过 pre-execute/guard。结果无 binding、无 observed parent、无 agent，因而丢失 child receipt；outer 可返回 completed，后续完整性检查只看到 outer，仍允许目标执行。应将这种已可关联的错误结果保留为 unknown 并拒绝接管，不能把没有 receipt 当作完整工具树。现有 missing-definition 测试仅使用 observed parent，未覆盖此组合。

验证边界：独立审读固定源码、规格、ADR、公开 SDK 与回执；未编辑源码或运行 Desktop/生产模型。已核对作者全量 530/530、build/check/diff 收据；这些收据未覆盖上述组合，本审查未独立重跑该组合。未发现应另报的 scope creep。实际 0.16 Desktop 安装、官方 API/第二账号和真实效果仍未验证；Go/compatible/ChatGPT 的 unknown handoff 明确拒绝不算伪造通过。
