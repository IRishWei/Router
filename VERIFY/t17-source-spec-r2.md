# T17 Source Spec r2

当前全源码 Spec **FAIL，1 项 P1**。完整 base `3a8d9891fd11e1b4e2fd4621a32ad5204996d963` → head `e26ac7ec3c518ce945da382f36ec147d10a82276`；本轮 delta 从 `6e1b6ca925044f058fe19963ea2fbbe82bd2fa9c` 起。已确认新 HEAD、干净工作树及非空 delta，并只读固定 archive/显式 SHA。

r1 原始 missing-definition 组合已修复：definition 查询前冻结 ancestry，独立 unsettled 状态覆盖等待中的无定义调用，early result 能归入活动 root。更正 r1 的路径说明：普通 UNKNOWN_TOOL + JSON 参数仍经过 pre-execute；`undefined` 参数不可 JSON 化等准备错误才可跳过 pre-execute/guard。此更正不撤销 r1 已复现的归属缺口；该缺口的晚到分支仍未关闭。

- **[P1] outer 完成后的已知 root 仍可漏记晚到 child 错误并放行接管。** #18 要求“携带完整可跨模型对话、用户约束、文本/图像和已完成工具记录”及“在稳定请求边界应用，不打断未完成工具”；合同要求“outer completed 不能掩盖 pending/unknown child”。`src/takeover.mjs:369–371` 的 root fallback 只扫描活动 `#toolBindings`。outer result 已在第366行移除 binding，仍保留的 settled native ancestry/taskOwners 没有参与回收。目标 resolveModel 边界中，晚到 child 使用原已完成 native root、真实未观察 Host parent token、省略 agent，且 `arguments:undefined` 直接产生 early error：自身没有 ancestry，parent 无关联，活动 root 也已消失，child receipt 被丢弃，后续允许目标执行。固定 e26ac7e 的完整 Native Task 红收据 `t17-finish-late-early-error-red.log` 已显示 target1，应为0。需保留该已可关联 lineage 的 possible/unknown 证据并拒绝接管；关联不能授予 child 许可。

已核对三个既有组合的真实红绿、最终533/533及build/check/diff收据；晚到分支不在该全量覆盖内。未发现独立 scope creep；registered late child/pending 同源变体尚在验证，不冒充已验证发现。本轮未运行测试或修改源码，红收据由作者执行。Desktop安装、生产模型、官方API/第二账号与真实效果均未验证；未知handoff明确拒绝不算伪造通过。
