# T10 0.11.0 源码受控验证

基线 `9a392a93eb280fefcca99cd292ec85de26befd49`，2026-10-09。此记录只证明源码阶段；目标 Desktop 安装、真实 OAuth 生命周期及独立双轴结果待单独归档，#11 保持打开。

- `npm run build`、`npm run check` 通过。
- `npm test`（`node --test --test-concurrency=4 test/*.test.mjs`）：392/392 通过。47项新增测试覆盖公开 Controller/Renderer、多进程凭据锁、账号切换、串行续期、权限/额度错误、退出及重启恢复。
- 原生 Task 到期后仅续期一次，使用替换 token 完成；切换后目录及候选身份隔离、新候选默认禁用；撤销/权限失败/额度限制各仅一次 Responses 请求，Task 暂停，未知用量不记零，无 API Key fallback 或透明重试。
- 两个实际子进程同时对同一凭据文件续期，仅一个 token 请求；取消、切换、退出不丢弃已接收替换。目录失败与 OIDC 暂时失败均保留替换，后者先隔离，再验证，不再次轮换旧 token。
- 两个账号退出互不影响；发现的撤销 endpoint 必须同认证 origin，跨域拒绝且无凭据派发；空 HTTP 200 确认撤销，503/不可信 metadata 为未确认但本地 token 清除。退出保留 issued client/host 注册，重新登录身份受校验。
- OAuth 等锁期间退出会拒绝过期代次的提交，并撤销已经交换出的新 token；已提交的重复账号 slot 也纳入退出清理。迟到回调不重新挂载；状态持久化失败不回滚已经写入的新 OAuth token，重启通过公开 record 枚举恢复注册。
- 旧 T09 streaming 输出一致性与工具重放测试仍通过；原有验收 claim 不重置，所有历史冻结文件与旧包不改写。

回归脚本稳定性：预算测试等待实际 `waiting-budget` 状态后再断言；旧标题 deadline 测试保留相同行为，测试窗口由250ms扩大为1500ms。默认无限制文件并行曾出现旧检查的时序失败；显式最多4个测试文件并行后375项全部通过，未修改产品超时或验收判断。

首轮固定 `b843ee0` 的 Standards/Spec 复审未通过，报告原样保留。修复了替换 token 等待 OIDC 才落盘、跨进程迟到 OAuth 复活、重复账号新 slot 遗漏撤销，以及 `subscription_sharing_user_not_eligible` 未停止新调用。新增崩溃重启、两个 Host 在 token exchange 中退出、新 token 撤销503准确呈现测试。独立真实子进程迟到 OAuth 复现脚本修复后也通过；清理未结束前显示未确认，不能把 public begin() 的 cancelled 当作清理完成。

第二轮固定 `d677c23` 复审也未通过，原报告保留。新增修复：交换 token 至提交前的所有失败路径清理；不同账号清理失败对退出操作的关联与可见告警；已隔离身份在过期后先验证，省略新 id_token 不能解除隔离；退出进程中断后仅清本地、报告未确认、释放门闩，不重放撤销。有效 owner 不能被另一 Host 初始化接管；过期 owner 用新 operationId 恢复，每个旧操作清理前重查，不能擦除之后的新授权。独立报告的3份新复现脚本全部通过。

第三轮 Standards 在 `b12c749` 发现首次登录尚无选中账号时全局清理告警漏投影。现已修复，新增 Host 和实际 Renderer/RPC 测试；保留原失败报告，Spec 该轮未完成，不作通过声明。

第四轮 `f75c85f` Standards 通过；Spec 剩余存储故障导致清理也被阻断的问题。现已修复：提交及后续所有 CredentialProvider 写入持续 EACCES 时仍执行一次内存 grant 撤销，已尝试的不重复；持久化也失败则保留会话内告警，页面分别呈现远端撤销确认与本地清理无法确认。独立原始复现通过，新增200/503两种 Host 与 Renderer回归。

第五轮 `51d8efc` Spec 通过；Standards 发现提交成功后取消授权、同时存储持续失败时仍有一条清理遗漏路径。现统一提交前后清理逻辑，并在私有闭包保留最小撤销凭据，不将 token 放入公开回调元数据。撤销使用锁内最新 grant；锁或写盘失败仍尝试一次，保留本地清理无法确认告警，不能清除新代次授权。独立原始复现与新增回归均通过。

最终源码日志：`C:/Users/a1500/AppData/Local/Temp/router-implementation/t10-v0110-full-test-20261009-g.log`。旧 b.log（375项）、c.log（380项）、d.log（386项）、e.log（388项）、f.log（391项）通过记录保留。没有执行真实 OAuth、模型请求或读取/修改 Codex 认证配置；Astra 的原真实调用许可已耗尽。
