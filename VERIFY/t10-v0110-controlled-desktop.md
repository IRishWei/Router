# T10 0.11.0 目标 Desktop 受控生命周期验收

2026-10-09，Windows DSH Desktop 0.2.0-rc.2 / Cordis 4.0.4。源码 `87e61a3b6a64487ca17222bf54dd68a6c7ee35e8` 已通过独立 Standards/Spec，396/396 测试及 build/check；非作者合并为 `d3ced6136b866fb988a5889727361abe45598d1a`，合并 tree 与作者一致。

安装包 `artifacts/irishwei-dsh-router-0.11.0.tgz`，195401 bytes、30 files，SHA-256 `C6D7957C1807542FE84259500747BD5FEE6B9971520FB07BA6C604258CA9FAB6`。官方 CLI 离线安装到全新 `t10-v0110c-controlled-home`；启动与重启前逐文件校验安装字节一致。只使用公开 Host RPC、SessionController、CredentialProvider 和 Cordis Loader 依赖配置，没有 Computer Use。

| 场景 | 目标 Desktop 结果 |
| --- | --- |
| 到期 A 续期后完整 Task | completed；一次 refresh；Router result、原生 turnOutline 与标题均为 `LIFECYCLE_OK`。 |
| 切换 B 后完整 Task | completed；旧 A 候选不可用，B 新候选默认禁用，经显式启用派发；账号身份分别记录。 |
| 退出 B | 一次撤销、确认清理；保留 A 及两份注册映射。 |
| A 返回账号资格错误 | Task paused，保留登录、撤下连接；失败 Call 用量为 unknown。 |
| 错误后的下一 Task | paused，零新增 Responses；不自动重试或回退 API Key。 |
| 恢复与重启 | 固定模型、启用池、预算和自动路由恢复原设置值；版本正常推进。重启后配置与任务历史深比较一致，原生默认模型及历史检测 claim 保留。 |

共 4 个受控 Task、5 次本地 Responses、1 次续期、1 次撤销，夹具错误 0；真实模型请求 0。这些 token 与响应均为合成测试数据，不证明实际套餐用量或官方 OAuth 生命周期。

此前 b 轮 Desktop 验收暂停于 `INVALID_CLIENT`：夹具在异步写入凭据后才提供受控端点，Router 构造时捕获了官方默认端点。本地服务无请求；合成授权可能向默认认证端点发送了请求，次数未确认，没有使用真实凭据或派发真实模型请求。最小 Cordis Loader 复现显示，不声明依赖时构造捕获为 false，加入依赖后为 true。c 轮在全新目录声明 `routerChatGptTransport/routerChatGptEndpoints` 依赖，传输额外拒绝所有非本地 origin；产品包未修改。b 的失败、旧离线安装失败及后续成功记录均保留。

验收后仅按精确 PID、启动时间、exe、home 及捕获的子进程树停止自有 Desktop；两阶段 stop receipt 和本地服务停止均已记录。旧 Astra 冻结的 76 个文件逐项哈希一致；旧真实 state 仍为 9114595 bytes、SHA-256 `7b8c6e6bceffefb871caedc6df404b4b5b76403b2e5044314d8c4429e194906a`，未重置旧验收许可。未读取或修改 Codex 认证/配置，未改系统网络。

证据：同目录 `t10-v0110-package-identity.json`、`t10-v0110-desktop-evidence.json`、`t10-v0110-desktop-restart-evidence.json`、`t10-v0110-final-preservation.json`、源码双轴与非作者合并记录；原始辅助脚本及失败记录在独立验证目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation/t10-v0110*`。

T10/#11 仍打开：真实 OAuth 的续期、切换与退出恢复验收尚未完成，旧真实调用许可已耗尽；受控结果不能代替该门槛。T11/#12 已解除 T09 前置并领取，继续处理订阅参考价值与额度未知状态。
