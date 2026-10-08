# T10：ChatGPT 会话生命周期契约

依据 [任务 #11](https://github.com/IRishWei/Router/issues/11)，基线 `9a392a93eb280fefcca99cd292ec85de26befd49`。2026-10-09 继续开发；Astra 的 0.10.7 输出一致性修复保持，T09 已完成，10/24 项完成。

官方来源（2026-10-09 查阅）：[Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)。本地文档快照保存在独立验证目录 `t10-20261009-*.md`，不含凭据。

- 每个账号/注册身份拥有独立 CredentialProvider record。公开状态只保存不透明账号 ID、issued client ID、稳定本机 host ID 和本地注册标识；token、subject、email 只在宿主管理凭据中。旧单账号凭据地址原位保留，升级不清除历史或重新开放 T09 一次验收额度。
- 新账号使用 `dynamic_agent_client`；已有注册重新授权沿用 issued client 与本机 host ID。退出保留注册映射，不删除其他账号。继续沿用 T09 不在授权 URL 加 token/email hints 的决定；回调必须验证相同注册身份。
- 到期时在公开 `credentials.modifyRecord` 的独占锁内读取当前 refresh token、请求并原子保存替换。目标 LocalCredentialProvider 支持跨进程排他、重新从磁盘读取、原子写入。取消或切换中的 Task 不可丢弃已收到的替换 token，不可把其他账号凭据用于旧连接；不自动重试模型请求或启动浏览器登录。
- 续期 POST 官方 token endpoint，携带 issued client、refresh token、固定 resource，不发送 scope。缺省返回 scope 保留旧授权；新 scope 缺 direct-use 时停止新调用。签名 ID token 如返回，验证 issuer、audience、有效期与 subject。终止性 refresh 错误清除不可用 token，保留注册；暂时网络/服务错误保留凭据，显示暂停原因。
- 续期已经返回替换 token 后，OIDC 元数据暂时失败时先保存并隔离该替换，后续只重试身份验证；不重新使用已经消耗的旧 refresh token。OAuth 已进入宿主 commit 的写入与退出共享凭据锁；迟到的完成回调不得重新激活已退出或切换的账号。
- 切换先撤下旧连接，再以目标注册刷新目录。完整账号/连接身份和配置代数隔离候选与实测；已准备调用及异步续期返回后重查当前身份。账号目录变化不得用旧资格静默派发。
- 退出先停止选中账号的新调用，再按 discovery `revocation_endpoint` 撤销最新 refresh token，且只向同一官方认证 origin 发送。HTTP 200 确认撤销；网络、服务或元数据失败仍清除本地 token，明确显示“远端撤销未确认”与官方设置入口。保留其他账号、不自动重复撤销。
- 上游明确撤销/权限失败停止该注册的新调用；额度错误只呈现官方错误与 Usage 入口，不推断全套餐剩余或重置时刻。暂时不可用不擦除登录、不循环授权。
- 源码、公开 Controller/Renderer 及独立目标 Desktop 受控生命周期验证与真实 OAuth 生命周期分别记录。真实模型请求的旧许可已耗尽；候选包和受控验证完成后，才请求必要的新一轮有界真实验收。不得用受控 fixture 关闭真实门槛。

实现后需固定基线双轴独立复审、非作者合并；不使用 Computer Use，不改 Codex 认证/配置或系统网络设置。
