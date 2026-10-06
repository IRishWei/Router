# T06：OpenAI API 连接到完整任务



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

通过插件连接 OpenAI API，选择账号可用模型并执行可记账任务。

## Acceptance criteria

- [ ] 界面配置独立 API 连接、发现模型及显示能力依据；凭据归 Host，不读取 Codex 认证。
- [ ] 使用适用公开接口完成调用，区分响应完成、未完成和流中断；目录可见不等于推理权限已验证。
- [ ] 提供商调用遵循模型池和预算，实际用量/适用价格规则进入统一账本，未知子项不猜测。
- [ ] 检测、重新连接、断开与重启状态可用；资源型检测可见且有界。
- [ ] 受控响应覆盖错误与用量分支，并在目标桌面提供一次经授权、受预算限制的真实完成请求证据。
- [ ] 保持未来 ChatGPT 授权与此 API 账号/计费路径分离，不静默转用其他计费来源。

## Blocked by

- [#4 [T03] 完整任务记账、预算预留与超限暂停](https://github.com/IRishWei/Router/issues/4)
