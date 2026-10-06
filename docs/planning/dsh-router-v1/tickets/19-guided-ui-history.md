# T19：首次引导、三页管理与任务时间线



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

用户通过简短引导启用模型池，日常调整策略并查看结果、费用口径与路由过程。

## Acceptance criteria

- [ ] 完整串联连接与模型、路由与预算、任务记录三页；高级参数默认折叠，不要求用户手动分配模型固定角色。
- [ ] 首用流程支持已实现来源及已有连接，正常操作无需命令行或编辑文件；必要官方浏览器授权可返回。
- [ ] 日常只显示当前模型、简短理由和预算，展开可看咨询、接管、恢复、验收及资源完整时间线。
- [ ] 费用估算、账单确认、订阅参考价值和未知明确区分；失败产物和无法确认状态可查看。
- [ ] 运行中修改、断开、固定和暂停显示何时生效；设置和记录重启后可恢复。
- [ ] 用完整桌面流程验证首次使用、日常改池/改目标、暂停恢复及不可用连接的可理解操作。

## Blocked by

- [#19 [T18] 整条任务链的故障恢复与暂停](https://github.com/IRishWei/Router/issues/19)
- [#12 [T11] 订阅参考价值与额度未知状态](https://github.com/IRishWei/Router/issues/12)
- [#8 [T07] OpenAI 兼容端点的连接与能力验证](https://github.com/IRishWei/Router/issues/8)
- [#9 [T08] 发现并引用已有 DSH 连接](https://github.com/IRishWei/Router/issues/9)
- [#6 [T05] DeepSeek API 连接到完整任务](https://github.com/IRishWei/Router/issues/6)
