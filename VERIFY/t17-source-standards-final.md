# T17 Standards r3

PASS：当前文档硬违反 0；有实际影响的 Fowler smell 0。r1 的缺 definition 归属丢失已关闭；r2 Standards PASS 未被新 delta 推翻，旧报告保持原样。本轮独立判断，不借用 Spec 轴结论。

固定 base：`3a8d9891fd11e1b4e2fd4621a32ad5204996d963`；HEAD：`82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`。源码只读 `t17-review-82d67da` 与 Git objects。

完整比较：`git diff 3a8d9891fd11e1b4e2fd4621a32ad5204996d963...82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`。重点 delta：`git diff e26ac7ec3c518ce945da382f36ec147d10a82276...82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`。提交：`6e1b6ca feat: add bounded same-task context takeover (#18)`、`e26ac7e fix: retain native tool evidence without a definition (#18)`、`82d67da fix: retain completed native tool lineage (#18)`。

- **文档规则：无硬违反。** `src/takeover.mjs:338,370` 的 `#toolAncestry.values()` 使 pre-execute 与 result-only 回退均覆盖活动及已结算 lineage；`:347–351,373–374` 保留冻结 Task ID/turn；`:345,385` 仍拒绝不可靠 parent/root/agent 的 child 许可。definition 前保存 ancestry、独立 unsettled 检查及实际错误结果保留未回退。满足 `README.md:62`「未完成或未知工具结果明确暂停，不能由外层工具成功掩盖」和 `t17-takeover-contract.md:43,45` 的工具树完整性与冻结归属规则。
- **测试：未违反 TDD 公开 seam。** `test/t17.integration.test.mjs:1270,1308` 使用真实完整 Native Task、公开 Tools.execute/registry/结果及本地 adapter await；观察公开 snapshot 与目标派发/body，未调用 Router 私有方法。两条实际行为红先后为 target1、target1/body1，绿为 target0/body0；预先接受的 #1 seam 不变。完整范围的 T16 cleanup 仅等待既有 public flush，业务断言不变。
- **文档：证据边界一致。** 合同 `:45` 与源码证据 `:42,44` 区分未知归属、执行许可、真实 red/green 和最终 535/535；保留旧失败与阶段回执。未把 canonical 审计宣称为私有 wire、任意隐藏副作用或真实 billing 证明，符合 ADR 0001/0002 与 Go 主线门槛。

已覆盖完整 15 文件差异、AGENTS/agent docs/GLOSSARY/相关 ADR，并逐项应用全部 12 项 Fowler baseline；仓库规则优先、跳过工具已强制项。必要 facade、边界重验和两个小型 root 查询未形成需单独提出的判断项。

读取最终 535/535、build/check/diff-check 及两条 red/green；当前 13 项收据 hash/bytes 全一致。本轮只新建此报告，未重跑测试、修改/合并源码、打包、启动 Desktop、调用真实模型、读取真实 profile/key/Codex 配置或使用 Computer Use。PASS 仅限固定源码 Standards；目标 Desktop、官方 API、第二账号和真实效果仍未验收。
