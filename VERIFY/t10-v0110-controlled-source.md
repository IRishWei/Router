# T10 0.11.0 源码受控验证

基线 `9a392a93eb280fefcca99cd292ec85de26befd49`，2026-10-09。此记录只证明源码阶段；目标 Desktop 安装、真实 OAuth 生命周期及独立双轴结果待单独归档，#11 保持打开。

- `npm run build`、`npm run check` 通过。
- `npm test`（`node --test --test-concurrency=4 test/*.test.mjs`）：380/380 通过。35项新增测试覆盖公开 Controller/Renderer、多进程凭据锁、账号切换、串行续期、权限/额度错误、退出及重启恢复。
- 原生 Task 到期后仅续期一次，使用替换 token 完成；切换后目录及候选身份隔离、新候选默认禁用；撤销/权限失败/额度限制各仅一次 Responses 请求，Task 暂停，未知用量不记零，无 API Key fallback 或透明重试。
- 两个实际子进程同时对同一凭据文件续期，仅一个 token 请求；取消、切换、退出不丢弃已接收替换。目录失败与 OIDC 暂时失败均保留替换，后者先隔离，再验证，不再次轮换旧 token。
- 两个账号退出互不影响；发现的撤销 endpoint 必须同认证 origin，跨域拒绝且无凭据派发；空 HTTP 200 确认撤销，503/不可信 metadata 为未确认但本地 token 清除。退出保留 issued client/host 注册，重新登录身份受校验。
- OAuth 等锁期间退出会拒绝过期代次的提交，并撤销已经交换出的新 token；已提交的重复账号 slot 也纳入退出清理。迟到回调不重新挂载；状态持久化失败不回滚已经写入的新 OAuth token，重启通过公开 record 枚举恢复注册。
- 旧 T09 streaming 输出一致性与工具重放测试仍通过；原有验收 claim 不重置，所有历史冻结文件与旧包不改写。

回归脚本稳定性：预算测试等待实际 `waiting-budget` 状态后再断言；旧标题 deadline 测试保留相同行为，测试窗口由250ms扩大为1500ms。默认无限制文件并行曾出现旧检查的时序失败；显式最多4个测试文件并行后375项全部通过，未修改产品超时或验收判断。

首轮固定 `b843ee0` 的 Standards/Spec 复审未通过，报告原样保留。修复了替换 token 等待 OIDC 才落盘、跨进程迟到 OAuth 复活、重复账号新 slot 遗漏撤销，以及 `subscription_sharing_user_not_eligible` 未停止新调用。新增崩溃重启、两个 Host 在 token exchange 中退出、新 token 撤销503准确呈现测试。独立真实子进程迟到 OAuth 复现脚本修复后也通过；清理未结束前显示未确认，不能把 public begin() 的 cancelled 当作清理完成。

最终源码日志：`C:/Users/a1500/AppData/Local/Temp/router-implementation/t10-v0110-full-test-20261009-c.log`。旧 b.log 的375项通过记录保留。没有执行真实 OAuth、模型请求或读取/修改 Codex 认证配置；Astra 的原真实调用许可已耗尽。
