# T09 v0.10.6a 实际离线安装 Standards 复核

## 结论：PASS（实际安装与数据保全）

## Findings

未发现阻断问题。

## 需求符合度

官方 CLI 收据记录 `desktop` profile、0.10.6、`offline: true`、退出码 0；CLI 前后进程快照均为 0，且固定旧 owner SHA `03A527…544A`。当前 owner 与 `t09-v0105b-owned-final-stop.json` 原字节相同：`t09-v0105b/restart/0.10.5/PID4584/stopped=true`；独立复查当前匹配进程仍为 0。

当前安装包版本为 0.10.6。独立调用已审 `verifyInstalledFiles`，严格 29 文件集合及逐文件 bytes/SHA 全部通过；package identity 为 184985 bytes、SHA-256 `D6A5F7ACCE4E6B42F69F8AD69CC997CF5BA455E4E1183471A1CA59F4CAE1BC56`。

当前 raw state 与 `t09-v0106a-preinstall.private-state.json` 原字节相同：9068103 bytes、SHA-256 `9D228DC643EC7C144215A0FAC5F0AB44E7941A077149B28DDA8882724B1FD3AB`；仍为 234 Tasks、543 Calls、config 584、claim `eaf5b278-ff85-41a6-9e21-b373ef929f5c`。已审 helper 的 before/after receipt 记录 473 个持久化文件路径、字节数及 SHA 全量相同；未新增 Task、请求或 claim。

## 测试与验证缺口

本复核未重跑 before/after 或 CLI，避免覆盖独占证据；也未打开或复制凭据正文。安装收据 SHA-256 为 `271FD5809CE0E57E34209C95CD9660A579CC08F2092C25FD6F27D92B5762E82E`。

## 剩余风险

实际离线安装 PASS 仅证明包身份、安装文件和既有数据保全。它不证明 OAuth 或实际推理成功；0.10.5b 的真实推理仍为 BLOCK，0.10.6 仅补充安全诊断与失败用量结算。
