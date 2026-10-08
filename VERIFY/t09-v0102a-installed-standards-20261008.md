# T09 0.10.2 实际安装 Standards 复审

## 结论：PASS（仅限安装保全）

未发现阻断问题。

## Findings

无。

## 需求符合度

- `t09-v0102a-isolated-launcher.ps1:22-34,47-65,78-92` 在停止/安装前绑定冻结包 SHA、隔离 DSH_HOME、owner purpose/home/exe 与阶段标签；未修改 Codex 配置或认证，符合 `AGENTS.md:5-6`。
- 独立复算 0.10.2 包为 183603 bytes、SHA-256 `9527C25…95B9DA2B`；`installed-hashes.json:1-151` 的 29 个文件均与包内字节及实际安装文件逐项一致。
- `t09-v0102a-preserve.mjs:25-40,48-76` 对完整 Tasks、config、DeepSeek、默认模型及 ChatGPT 元数据逐对象比较。四阶段证据均为 231 Tasks、538 Calls、config version 566；Task corpus/config 哈希保持一致，旧 `lastDetectionTaskId=a836…cb5e` 及其 paused Task/两个 settled Calls保留，新增 Task/模型请求为 0。
- `t09-v0102a-stop-owned.ps1:4-22` 按 purpose/label/stage/home/PID/start/exe 绑定唯一 owned 进程；`owned-stop.json:1-13` 记录 PID 26620 stopped，独立查询确认该 PID 已不存在。

## 测试与验证缺口

本轮仅复核安装、重启、历史与配置保全；未启动宿主、读取凭据或发起 OAuth/模型请求。

## 剩余风险

真实 HTTP 200 非 SSE 的上游原因仍未知，0.10.2 安装不认证真实 Responses 成功；T09 应继续 OPEN。renewed-claim 临时工具另案复审，其初版 BLOCK 不由本报告覆盖。
