# T14 0.9.3 Standards：core 与安装前 gate 复审

## 结论

**PASS（安装前）**

- Core：**PASS**
- 冻结包：**PASS**
- 安装与验收 helper：**PASS**

未发现阻断问题。此结论仅覆盖固定提交、冻结包和安装前 helper；未宣称目标 Desktop 已安装或 T14 实际验收已经通过。

## Findings

无 P0/P1/P2/P3 finding。

### 0.9.2 既有 findings 关闭情况

1. **绝对 deadline：已关闭。** `src/source-network.mjs:189-255` 在进入 `readResponse()` 时一次性计算剩余时间，使用独立 timer；超时和取消均销毁 request，`finish()` 清理 timer、signal listener 与 Agent。持续响应字节不能续期。新增测试 `test/t14.research-acceptance.test.mjs:482-526` 同时验证 slow-drip 返回 `SOURCE_TIMEOUT`、取消返回 `CANCELED`，并验证服务端连接关闭且写入停止。独立定向执行 1/1 PASS。
2. **安装身份门禁：已关闭。** `install-router-v093-isolated.ps1:2,8-26` 固定 Router 0.9.3、163149 bytes、完整 SHA-256，并在停止 owned Desktop 前固定 companion 0.3.2 的唯一工作区路径、3272 bytes 和完整 SHA-256。
3. **预算/撤销/steer 验收强度：已关闭。** `t14-v093-installed-verify.mjs:264-328` 锁定唯一 waiting review Call、`waiting-budget`、`blockedBy`、reservation、预算扩展后的同 Task/turn，以及 stop/revoke 的 `ABORTED`/`BUDGET_STOPPED` 与 `MODEL_NOT_FOUND`/`MODEL_DISABLED` 和精确 review reason；`338-375` 锁定补充输入来源、原 waiting Call 释放且未派发、同 Task/turn 与新 review 对应最终产物。

## 需求符合度

- 完整功能 diff `14e2f56e2f07c5db8df3e03dfc621e4119604db2..8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f` 保持既有公共 IP/逐跳授权、固定 DoH 服务与 A 查询、代理失败闭合、CONNECT 到已授权精确 IP、原 Host/SNI/TLS、共享 deadline/取消/传输预算和只读 Windows 代理发现边界。
- 修复 delta `a4534a3d464dab2466cb813bccb288ff0713a258..8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f` 仅改变版本、绝对 timer 实现和对应资源清理测试；未扩大网络或配置权限。
- 安装脚本在任何 stop 前验证固定 Router/companion 身份，并校验 owned process 的 home、exe、PID 与启动时间（`install-router-v093-isolated.ps1:15-47`）。
- provenance helper 精确约束 25 个包条目与 21 个 lib 文件，并验证 package→author build→ROOT build→installed（`t14-v093-installed-provenance.mjs:9-42`）。
- installed verifier 对 companion 0.3.2 的全部四个打包文件逐文件比对（`t14-v093-installed-verify.mjs:73-80`），并在 `finally` 恢复 acceptance、budget、models/config、DeepSeek metadata 与默认模型后深比较（`397-407`）。
- Renderer helper 只允许 `router/snapshot`，逐个 19 case 在自身 `li` 中核验 lifecycle、final artifact、acceptance、coverage、来源访问/引文/原因和 superseded history，并在前后深比较 Task/config/metadata/default（`t14-v093-installed-renderer.mjs:40-129`）。
- 网络 fingerprint helper 只读取并哈希 DNS server address、当前用户代理配置和 hosts；使用 CreateNew 写证据，不输出原始网络内容（`t14-no-dns-network-state.ps1:12-40`）。未发现修改 DNS、hosts、系统代理、路由器或 Codex 配置/认证的路径。

## 测试与验证

- 固定提交：HEAD `8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f`，父提交 `a4534a3d464dab2466cb813bccb288ff0713a258`；工作树 clean；完整 diff `git diff --check` PASS。
- 独立定向测试：`node --test --test-name-pattern "continuously drips" test/t14.research-acceptance.test.mjs`，1/1 PASS。
- Core 源/构建：`src/source-network.mjs` 与 `lib/source-network.js` 字节及 SHA-256 相同（`EE947CE5A2BC33267F2A7E11D3B83FFCF73B2F950CEB06AF5AAD0BAC252CB1F4`）。
- 冻结包：163149 bytes，SHA-256 `AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3`；25 条目/21 lib；所有 lib 与作者构建逐字节一致；所有相对 import 闭合；package version `0.9.3`。
- 五个 v093 helper 与通用 network fingerprint helper 的长度/SHA-256 均与冻结值一致；四个 MJS `node --check` PASS，两个 PowerShell helper parser PASS。
- `t14-v093-before-upgrade.json`：159 Tasks/config 434，与 `t16-v091c-restored-state.json` 的 Tasks、config、DeepSeek metadata、default model 深比较一致；fixture version 为 0.3.2。
- 作者既有验证记录：T14 resolver 20/20、Task/Renderer 17/17、build/check PASS；串行全量 289/290，唯一失败为既有 Windows `ENOTEMPTY`，该用例隔离 1/1 PASS。本次未重复全量。

## 剩余风险

- ROOT 尚未合并固定提交和包；非作者合并后仍需串行复验，确认集成树与冻结内容一致。
- 尚未运行目标 Desktop 的 19-case 实际安装验收、Renderer、重启/移除及 after network fingerprint。只有这些实际证据完整通过后，才能声明 T14 安装验收 PASS。
- Windows 串行全量仍有一次既有临时目录 `ENOTEMPTY`；虽然隔离复跑通过，合并后的串行复验仍应作为最终门槛。
