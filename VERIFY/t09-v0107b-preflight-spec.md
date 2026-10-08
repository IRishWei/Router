# T09 0.10.7 安装与 verification 预审 — Spec

## 结论：PASS

## Findings

未发现阻断问题。

## 需求符合度

- 契约要求完整上下文、`store:false`、`stream:true`，只以 `response.completed` 成功，并在失败时保留已知用量、禁止透明重试/API Key 回退（`docs/implementation/t09-chatgpt-oauth-contract.md:17-19`）。本轮仅验证已修复的一致性故障，不扩大至其余 24 项。
- 0.10.7 包身份已独立核对为 185622 B、SHA-256 `C59537DF4C82D2C0DA36275155FC4AAF6B12B6D55EBE80569A1A5A03C4EBCAC8`、29 个唯一普通文件；安装器固定官方 CLI、desktop profile 与 `--offline`（`t09-v0107a-offline-install.ps1:30-49`），安装前后严格校验 235 Tasks/545 Calls/config 590、state SHA、旧包及全量持久化文件不变（`t09-v0107a-offline-install-check.mjs:54-104`）。
- 子授权与父授权 SHA 严格绑定，限 verification 1 Task/2 requests、65536 token、120000 ms、完整输入预留、同账户套餐，禁止重试、扩额及 API fallback（`t09-v0107b-renewed-claim-lib.mjs:399-409`）。14 个 helper 均匹配 `helper-identities-v3.json`。
- claim proposal 仅把 `chatGpt.lastDetectionTaskId` 从 `6e50…` 置空；历史和最新两 Call（首 Call 6536+8=6544，次 Call usage null）被逐项锁定（`t09-v0107b-renewed-claim-lib.mjs:115-139`）。验收后强制新增恰好 1 Task、最多 2 次可能派发、零 retry，并校验同账号/模型/账本（`t09-v0107b-helper-lib.mjs:135-169`）。
- PID 39132 只有在已知为其他可执行文件时才放行；路径未知或任一 DSH 名称/路径存在均拒绝，且脚本不停止该进程（`t09-v0107b-renewed-claim-lib.mjs:196-204`；`t09-v0107a-offline-install.ps1:19-27`）。

## 测试与验证缺口

独立 fixture guards 11/11 PASS。未执行安装、claim apply、Host、OAuth 或模型请求。

## 剩余风险

真实修复仍须使用剩余唯一 1 Task/2 requests 验收；成功只能由新证据确认。当前 live state SHA 仍为 `D390…61E3`，manifest `5573…AF29`，marker 不存在；此前安全 comparison 不是原始 SSE 捕获，不能预先宣称修复成功。
