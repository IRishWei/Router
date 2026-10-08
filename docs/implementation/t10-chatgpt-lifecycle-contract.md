# T10：ChatGPT 会话生命周期契约

依据 [任务 #11](https://github.com/IRishWei/Router/issues/11)，基线 `9a392a93eb280fefcca99cd292ec85de26befd49`。2026-10-09 继续开发；Astra 的 0.10.7 输出一致性修复保持，T09 已完成，10/24 项完成。

官方来源（2026-10-09 查阅）：[Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)。本地文档快照保存在独立验证目录 `t10-20261009-*.md`，不含凭据。

- 每个账号/注册身份拥有独立 CredentialProvider record。公开状态只保存不透明账号 ID、issued client ID、稳定本机 host ID 和本地注册标识；token、subject、email 只在宿主管理凭据中。旧单账号凭据地址原位保留，升级不清除历史或重新开放 T09 一次验收额度。
- 新账号使用 `dynamic_agent_client`；已有注册重新授权沿用 issued client 与本机 host ID。退出保留注册映射，不删除其他账号。继续沿用 T09 不在授权 URL 加 token/email hints 的决定；回调必须验证相同注册身份。
- 到期时在公开 `credentials.modifyRecord` 的独占锁内读取当前 refresh token、请求并原子保存替换。目标 LocalCredentialProvider 支持跨进程排他、重新从磁盘读取、原子写入。取消或切换中的 Task 不可丢弃已收到的替换 token，不可把其他账号凭据用于旧连接；不自动重试模型请求或启动浏览器登录。
- 续期 POST 官方 token endpoint，携带 issued client、refresh token、固定 resource，不发送 scope。缺省返回 scope 保留旧授权；新 scope 缺 direct-use 时停止新调用。签名 ID token 如返回，验证 issuer、audience、有效期与 subject。终止性 refresh 错误清除不可用 token，保留注册；暂时网络/服务错误保留凭据，显示暂停原因。
- 续期已经返回替换 token 后，先在第一次锁内保存 pending 替换；第二次重新读取当前记录，再进行 OIDC/目录网络操作。元数据暂时失败时保留隔离后的替换，后续只重试身份验证；不重新使用已经消耗的旧 refresh token。进程中断也必须保留替换。
- OAuth 的开始、切换、取消和退出使用本插件 CredentialProvider control record 的持久化代次。Host flow 通过公开 `credentials.modifyRecord` 在锁内重读代次并条件提交，公开 AuthorizationService 观察真实的 `credentials/record-updated`；默认独立 flow 仍可使用 `session.commit`。不手发事件、不修改宿主私有状态、不嵌套凭据修改锁。迟到完成不得重新激活已退出或切换的账号；被拒绝的已交换 token 也要撤销。
- 切换先撤下旧连接，再以目标注册刷新目录。完整账号/连接身份和配置代数隔离候选与实测；已准备调用及异步续期返回后重查当前身份。账号目录变化不得用旧资格静默派发。
- 退出先停止选中账号的新调用、推进持久化代次，并在同一锁内捕获该精确注册身份的所有 slot；随后逐 slot 重读并按 discovery `revocation_endpoint` 撤销最新 refresh token，且只向同一官方认证 origin 发送。清理期间阻止新授权开始/提交。HTTP 200 确认撤销；网络、服务或元数据失败仍清除本地 token，明确显示“远端撤销未确认”与官方设置入口。尚未结束的授权清理保留未确认状态；清理失败元数据不能被其他成功覆盖。保留其他账号、不自动重复撤销。
- 退出操作和授权尝试记录进程实例及有界有效期。其他仍有效的退出操作不能被初始化清除；进程已终止或操作过期时，恢复以新 operationId 接管，逐 slot 重查所有权，只清本地并报告未确认，不自动重放撤销。旧退出操作恢复执行后不得清掉更新授权。孤儿授权尝试转为未确认告警，不能永久卡住 pending 门闩。
- OAuth 一旦解析到新 refresh token，在提交成功前的验证失败、取消及条件提交拒绝均承担该 grant 的撤销清理；提交成功后由持久会话接管，不因 Router 状态持久化失败回滚 token。不同账号清理失败要保留对本次退出的关联或全局可见告警。
- 凭据存储故障不能阻止已交换 grant 的一次 best-effort 撤销。无法取得存储锁时使用内存中的 grant；提交后有效性检查本身失败也须清理。已尝试的撤销记录只对精确授权代次有效，不能用新代次的 tombstone 跳过旧代次清理；本地中断恢复不标记已尝试远端撤销。告警无法持久化时仍须在当前会话公开可见，并准确区分远端确认与本地清理无法确认；不声称存储故障下本地已经清除。
- 上游明确撤销/权限失败停止该注册的新调用；`subscription_sharing_user_not_eligible` 保留登录、撤下连接，显式恢复前不再发送新请求。额度错误只呈现官方错误与 Usage 入口，不推断全套餐剩余或重置时刻。暂时不可用不擦除登录、不循环授权。
- 源码、公开 Controller/Renderer 及独立目标 Desktop 受控生命周期验证与真实 OAuth 生命周期分别记录。真实模型请求的旧许可已耗尽；候选包和受控验证完成后，才请求必要的新一轮有界真实验收。不得用受控 fixture 关闭真实门槛。

实现后需固定基线双轴独立复审、非作者合并；不使用 Computer Use，不改 Codex 认证/配置或系统网络设置。
