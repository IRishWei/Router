# T07：OpenAI 兼容端点的连接与能力验证



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

用户在界面添加自定义兼容端点，验证可用能力后参与任务执行。

## Acceptance criteria

- [ ] 支持端点、凭据和模型 ID/发现设置；与官方 API 连接分开标识。
- [ ] 通过实际请求与受控端点验证支持的响应/工具/模态范围，协议不兼容时说明具体限制，不宣称任意兼容。
- [ ] 未知价格与不完整用量在界面、账本和路由条件中保持未知；可在界面输入有来源的参考费率。
- [ ] 仅已启用且已满足任务所需能力的候选可调用，所有检测和任务消耗有界、可见。
- [ ] 重启、断开、部分流响应、错误结构不同及能力不匹配通过完整任务验证。

## Blocked by

- [#7 [T06] OpenAI API 连接到完整任务](https://github.com/IRishWei/Router/issues/7)
