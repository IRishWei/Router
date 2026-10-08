# T09：独立 ChatGPT 授权与首个任务



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

在插件点击官方授权，返回后发现账号可用模型并完成同一 DSH 任务。

## Acceptance criteria

- [ ] 使用插件自身官方开源应用注册与 OAuth，保存该账号的 issued client 身份和稳定 host 身份；不复用 Codex 客户端或 token。
- [ ] 处理系统浏览器、state/nonce、PKCE、回调、取消和超时，校验身份及推理权限后才启用连接。
- [ ] 从相同账号授权发现可用模型，按当前官方预览契约调用公开 Responses；不指向社区 backend。
- [ ] 目标桌面一次授权→返回→选择→完整请求可复现；无账号资格或接入未开放时保留真实限制，不标记可用。
- [ ] 计入已知用量，订阅金额/额度不伪造，凭据不进入 URL、普通记录或仅浏览器存储。
- [ ] 受控契约测试覆盖授权拒绝、模型不可用、回调无效与流未完成。

## Blocked by

- [#4 [T03] 完整任务记账、预算预留与超限暂停](https://github.com/IRishWei/Router/issues/4)
