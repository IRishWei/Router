# T08 双轴复审

固定范围 `98a0338faf095d51949797b1884f16670066af6f...52ece6008500ae02b36861cd10b6beef8fc3b560`；验证脚本增量 `52ece60...a911850b25bea568ac6de4b7802d5f4691b7fa21`。对应 T08/#9、首版规格和 `ticket-contracts.md`。两轴由没有参与 T08 实现的代理独立审查，作者负责修复。

## Standards

强制规则 0 违规。遵守 AGENTS.md 的 DSH/Codex 边界、禁用 Computer Use，以及单一 Glossary/ADR 上下文。最终验证脚本增量没有新增规范问题。

保留四项 Fowler 启发式建议，均不是 hard violation：controlled descriptor 注册/判定重复；capture/snapshot 的容量投影重复；confidence schema 未完全复用；迁移别名分散。后续改动涉及这些接缝时优先集中规则，不为重构扩大本票范围。

## Spec

最终代码 PASS。首轮三个 P1 和一个 P2 已逐项复现、修复并回归：真实 request route 与 Call mismatch 在 adapter 前拒绝；身份替换生成默认禁用的新候选，不继承许可/固定/报价；非 controlled 同名模型不能走 legacy model 回退；新 Call 及预算释放主动刷新无事件目录/revision 变化。

随后发现的 owned 元数据伪造 controlled 标识问题已通过白名单、保留值拒绝、内部专用入口及精确 fixture 身份校验修复。API-owned 容量和能力保持 declared/unknown。最后恢复脚本按原模型池顺序恢复的增量独立复验 PASS。

根集成合并后 `npm test` 119/119、`npm run check`、`git diff --check` 通过。最终目标桌面发现→启用→完整任务→移除→原配置恢复→重启通过，详见 [实际安装证据](t08-installed-host-evidence.md)。受控服务不替代真实 API/账号资格证明。

Standards：0 强制违规、4 启发式建议；Spec：0 剩余代码阻塞，最严重的初轮 P1 身份/请求归属问题已修复。
