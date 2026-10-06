# T16：受阻后的单 agent 专家咨询



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

当前模型重复受阻时咨询另一个合适模型，将建议交回当前模型继续执行。

## Acceptance criteria

- [ ] 首次可修复问题允许自行修正一次，重复阻碍或明确能力不足才触发咨询并展示依据。
- [ ] 咨询只带当前问题与相关证据，主 agent 继续承担执行；不派子 agent、不重置任务预算。
- [ ] 咨询候选符合启用池、能力、目标和预算；请求及返回建议计入同一任务记录。
- [ ] 采纳建议后重新验收，不把建议本身当成功；咨询失败保留当前状态。
- [ ] 同一阻碍无新证据不反复咨询，不把网络/限流错误视为任务困难。
- [ ] 完整任务演示自行修正→咨询→继续→验收及预算不足/固定模型约束。

## Blocked by

- [#13 [T12] 轻量判断与起始模型自动选择](https://github.com/IRishWei/Router/issues/13)
- [#14 [T13] 编程、写作验收与有条件模型评审](https://github.com/IRishWei/Router/issues/14)
