# T09 0.10.7 安装与真实验收 Standards 预审

## 结论：PASS

## Findings

未发现阻断问题。

## 需求符合度

- 离线安装固定 0.10.7 包为 185622 bytes / SHA-256 `C59537DF4C82D2C0DA36275155FC4AAF6B12B6D55EBE80569A1A5A03C4EBCAC8` / 29 files；[t09-v0107a-offline-install-check.mjs:79](C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0107a-offline-install-check.mjs:79) 固定 235 Tasks、545 Calls、config 590、状态 SHA，并在安装前后核对全部数据指纹及严格安装文件集合。官方 CLI 仅对独立 `DSH_HOME` 的 desktop profile 离线加包。
- [t09-v0107b-renewed-claim-lib.mjs:324](C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0107b-renewed-claim-lib.mjs:324) 将 apply 绑定到固定 manifest、人类授权、旧证据、owner、live state 与一次性 marker。实际 proposal manifest SHA-256 为 `5573D3BD9834744A77B1C96887C112AA42B55BA925E71ED586FBBFF41F68AF29`；独立深比较确认只把 Task `6e50fa61-33fa-4340-955b-9481698e0155` 的 claim 置空，235/545/config 590 保持。
- 父授权 SHA-256 `91928AD916F67E695DB950F2E8280A63E34F2ECE7D16EFCE1BEF408C31019141` 固定修复总额 2 Tasks / 4 requests；子授权 SHA-256 `C7CA67EF82469BCD48FA0D72E54EB56DC89F189D2A397033AE584A0474D4004C` 仅分配 verification 1 Task / 2 requests。旧诊断的首 Call 固定为 6544 tokens，第二 Call usage 为未知。
- [t09-v0107b-renewed-claim-lib.mjs:196](C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0107b-renewed-claim-lib.mjs:196) 仅在旧 PID 的 executablePath 可读且明确不是 DSH 时放行；目标 DSH 名称/路径和未知身份仍拒绝。[t09-v0107a-offline-install.ps1:19](C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0107a-offline-install.ps1:19) 同样 fail-closed。停止流程仍要求 PID、启动时间、可执行路径一致，不会停止复用 PID 的其他进程。未见 Fowler 基线异味。

## 测试与验证缺口

独立核对 14 个 helper 的 v3 字节身份；Node `--check`、PowerShell AST 解析及两组 guards 11/11 PASS。未执行 before/after、CLI、apply、launch、OAuth 或模型调用。

## 剩余风险

本结论只覆盖执行边界和辅助脚本；离线安装成功不等于真实推理成功。最终结论仍取决于有界 0.10.7 实际验收及完整恢复证据。
