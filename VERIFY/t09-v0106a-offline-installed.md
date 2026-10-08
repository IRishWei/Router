# T09 0.10.6a：离线安装及数据保全

2026-10-09。已将 0.10.6 诊断及失败用量结算候选安装至原独立 DSH 验收 home；本阶段没有启动 Host、OAuth 或模型请求。

- 官方 CLI：`dsh.cmd plugin --profile desktop add <0.10.6.tgz> --offline`，仅在子流程设置独立 `DSH_HOME`，finally 恢复原环境；退出码 0。
- 包 184985 bytes、29 文件，SHA-256 `D6A5F7ACCE4E6B42F69F8AD69CC997CF5BA455E4E1183471A1CA59F4CAE1BC56`。安装后的 29 文件集合、长度及逐文件 SHA 全部匹配，内部符号链接、junction、额外文件均拒绝。
- CLI 前后外部进程快照均为零 Desktop；安装后独立复核当前进程仍为零。旧 owner 保持 `t09-v0105b / restart / 0.10.5 / PID4584 / stopped=true` 原字节，该记录描述上次已停止的进程，不能误写为新版本已启动。
- 473 个持久化数据文件路径、长度及 SHA 全量保留。凭据仅由保全 helper 在内存中读取字节计算哈希，未解析、输出或复制正文；两项安装后独立复核没有再次打开凭据文件。
- 状态保持 234 Tasks、543 Calls、config584，claim `eaf5b278-ff85-41a6-9e21-b373ef929f5c` 未轮换。raw state 与安装前独占原件完全一致：9068103 bytes，SHA-256 `9D228DC643EC7C144215A0FAC5F0AB44E7941A077149B28DDA8882724B1FD3AB`。
- 安装阶段新增 Task 0、模型请求 0；`actualInference` 保持 `unconfirmed`。0.10.5b 的未知用量、失败及原生会话原件不改写。
- 全部九组旧证据保护检查在安装后通过，包含 0.10.4e 的五份源码历史快照连续性、其余 95 项原证据，以及 0.10.5b 准备和真实失败组；不冻结可变工作目录源码。

前置独立 [Standards](t09-v0106a-offline-preflight-standards.md) / [Spec](t09-v0106a-offline-preflight-spec.md) 均 PASS；安装后独立 [Standards](t09-v0106a-installed-standards.md) / [Spec](t09-v0106a-installed-spec.md) 均 PASS，无发现项。安装收据 SHA-256 `271FD5809CE0E57E34209C95CD9660A579CC08F2092C25FD6F27D92B5762E82E`。

源码及测试见 [终态诊断候选](t09-v0106a-terminal-diagnostics.md)。离线安装 PASS 不认证真实分歧修复；#10 保持 OPEN。下一次真实调用必须取得新的明确有界许可。
