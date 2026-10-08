# T09 0.10.5 离线安装结果 Spec 审查

## 结论：PASS

未发现阻断问题。0.10.5 官方 CLI 离线升级、包身份和既有数据保全符合本轮计划。本结论不认证 OAuth 或真实模型推理；T09/#10 仍须保持 OPEN。

## Findings

无。

## 需求符合度

- `t09-v0105a-offline-install-receipt.json`（531 bytes，SHA-256 `78AC302103995C71E12A6298C9511CF3A4D9F1BA8CBA4EB7AD72E36AEB832FB2`）记录 installed 0.10.5、29个文件、184641-byte 包及 SHA-256 `777452049F5F311D29880F3B44713AF2E75122A6E35D6A6F03CCD29CBE27FC49`。独立导入 v2 `verifyInstalledFiles` 对当前安装目录复核通过，版本为0.10.5。
- package identity 含29个唯一文件；当前 bundle 的字节数、SHA及29项归档集合一致。CLI 私有日志显示安装成功，after 证据记录 `cliExitCode:0`。
- v2 after 检查记录安装前清单中的470个持久化文件路径、长度及哈希全部相等。独立核对当前 state 与 preinstall 原件，同为9045336 bytes / `E7B1C7763BF5EB13A9AF02D6A974BC9CF917D4C084F33AB984D9A50DE3CF54F3`。
- state 保持233 Tasks、541 Calls、config578，`lastDetectionTaskId` 仍为已消耗 claim `eefbe023-a0a9-4320-85c3-a5817bdfa41e`；receipt 明确 `newTasks:0`、`modelRequests:0`、`actualInference:'unconfirmed'`。
- before/after 进程证据分别记录精确 DSH 进程数0；before 还绑定旧 owner PID31700/stopped、目标 home与精确 bundle，after 绑定相同 home/bundle及CLI退出码0。

## 测试与验证缺口

本审查只读复核安装和保全结果；未启动 Host、未运行模型请求，也未重复源码全量测试。历史时点的零进程只能由已保存的 before/after 证据证明。

## 剩余风险

真实 0.10.4e 失败正文未知，安装成功不能证明0.10.5已恢复推理。后续有界验收必须使用新标签和用户新许可，不得轮换旧 claim 以外的数据或扩大请求上限。
