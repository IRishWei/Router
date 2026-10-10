# T17 Standards r1

FAIL：1 项文档硬违反；0 项有实际影响的 Fowler smell。

固定 base：`3a8d9891fd11e1b4e2fd4621a32ad5204996d963`。
固定 HEAD：`6e1b6ca925044f058fe19963ea2fbbe82bd2fa9c`（起始确认一致）。
提交：`6e1b6ca feat: add bounded same-task context takeover (#18)`。
比较：`git diff 3a8d9891fd11e1b4e2fd4621a32ad5204996d963...6e1b6ca925044f058fe19963ea2fbbe82bd2fa9c`。报告仅评估该固定提交；后续只读其 archive 快照。

1. **硬违反：缺失定义时丢弃已观察工具树的归属。** `src/takeover.mjs:351–352` 的 `if (!definition) return;` 丢弃此前计算的 `matchingBindings/taskOwners`；`:366–367` 的 result 回退只接受已观察 parent 或带 agent 的 native root。若子调用同时使用未知工具名、缺 agent、未观察的真实 parent token，但 root 匹配活动 native 工具树，其公开 `UNKNOWN_TOOL` 结果不会记录为 unknown。外层 completed 后，该子结果能从完整性检查消失并允许接管。rc.2 公开 SDK `dsh-tools/lib/types/index.js:777–783,876,1069–1071` 确认未知工具仍经过 pre-execute 并发 tools/result。这违反 `README.md:62`「未完成或未知工具结果明确暂停，不能由外层工具成功掩盖」及 `docs/implementation/t17-takeover-contract.md:43`「outer completed 不能掩盖 pending/unknown child」。应在定义查询前保存冻结 ancestry/taskOwners，缺定义仍保留无语义证明的 unknown receipt；不能推断精确 owner 或授予 child 许可。

已逐项应用全部 12 项 Fowler baseline；仓库规则优先，必要的安全分支与公开 Host facade 未机械认定 smell。检查覆盖所有 15 个差异文件、指定标准文档及预先接受的完整 native Task seam；T16 单处 cleanup 没有改业务断言。

已读取固定源码 530/530、build/check/diff-check 回执；本轮未新增运行、修改或合并源码。未打包、安装/启动 Desktop、调用生产模型、读取真实 key/profile 或 Codex 配置、使用 Computer Use。该源码结果不证明目标 Desktop、官方 API、第二账号、provider wire、视觉质量或真实效果验收通过。
