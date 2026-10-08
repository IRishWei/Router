# T10 Spec 最终增量独立复审

固定基线 `9a392a93eb280fefcca99cd292ec85de26befd49`；作者 `87e61a3b6a64487ca17222bf54dd68a6c7ee35e8`。完整比较 `git diff 9a392a93eb280fefcca99cd292ec85de26befd49...87e61a3b6a64487ca17222bf54dd68a6c7ee35e8`；本轮重点 `b7599dce2ae9cb2c4147cd1891860616aec4137b...87e61a3b6a64487ca17222bf54dd68a6c7ee35e8`。规格沿用 [#11](https://github.com/IRishWei/Router/issues/11)、T10 lifecycle contract、ticket-contracts 与2026-10-09官方快照。

**源码 Spec PASS。missing / partial / scope creep / wrong：均 0 项。**

g 轮缺陷已修复：`src/chatgpt-sessions.mjs:228` 在恢复中断退出时，仅保留已通过同宿主、同账号检查的 schema2 tombstone 原 revocationAuthorizationId；活动 grant 的纯本地恢复不新增撤销尝试标记。既有精确代次证据不再丢失，迟到 discard 可跳过同代次已尝试撤销；不同代次仍清理自己的 fallback 并保留新记录。符合契约第14—17行“不自动重复撤销”、恢复不重放和精确代次要求。

独立验证：两份 g 原始复现均 PASS，marker 保留且远端撤销仅1次。相邻守卫4/4 PASS：HTTP200/503 已尝试结果恢复不重放；真实子进程在撤销中终止后，仅本地清理、无新增marker并释放门闩；跨代次各清理一次。未重复执行已充分通过的整套测试；作者396/396、build/check结果单列为作者证据。

结合此前完整 pinned diff 与增量审查，无未解决源码偏差：按账号/注册身份恢复及目录刷新、串行原子续期、晚到授权与存储故障清理、跨进程退出恢复、不同账号及候选资格隔离、准确权限/额度暂停与页面告警均符合契约。T09输出修复和历史、固定模型与预算边界保持，无范围扩张。

只读仓库，执行仅本地受控HTTP与合成数据；旧失败报告和原始脚本保留。真实目标 Desktop OAuth 生命周期验收仍未完成，#11应保持打开；本报告仅确认固定源码及受控检查，不替代真实门槛或授权真实调用。
