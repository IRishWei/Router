# T14 v0.9.3 Spec 独立复审

## 结论

- **Core：PASS**
- **Preinstall helpers：PASS**
- **Package gate：PASS**

未发现阻断问题。0.9.2 的两个 P2 已关闭；0.9.3 可进入非作者集成及实际 Desktop 验收。本结论不宣称 T14 已关闭，也不替代真实账号、付费调用或 T24 全量验收。

## Findings

无。

## 旧 Findings 关闭

1. **绝对 deadline：已关闭。** `src/source-network.mjs:189-253` 用独立一次性 timer 替代 socket inactivity timeout；timeout/abort 均销毁 request，并由统一 `finish` 清除 timer、signal listener、销毁 agent。直接/代理/固定 DoH 共用该实现。`test/t14.research-acceptance.test.mjs:13-40,476-530` 验证 slow-drip 与取消均使服务端连接关闭、写入提前停止且等待后不再增长。独立定向复跑 1/1 PASS。
2. **安装包身份：已关闭。** `install-router-v093-isolated.ps1:2,8-26` 在停止 owner 前固定 Router 0.9.3/163149B/完整 hash，并固定 Companion 0.3.2 唯一路径/3272B/完整 hash；错误身份不能以调用方自证值绕过。

## 需求符合度

- 完整 `14e2f56..8cc67dd` 未放宽来源、claim/quote/review、预算、steer、SSRF、TLS、redirect、query 脱敏或失败关闭语义。`a4534a3..8cc67dd` 仅加入绝对 deadline/资源关闭修复、测试及版本更新。
- 冻结包实测 163149B、SHA-256 `AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3`、版本 0.9.3、25 项闭包（21 个 lib）；所有包内 lib 与固定作者构建逐字节一致。
- `t14-v093-before-upgrade.json` 为 159 Tasks/config 434，并与 `t16-v091c-restored-state.json` 的完整 Tasks/config/DeepSeek/default 深比较一致；新 network-before 仅保存 DNS、当前用户代理及 hosts hash，不输出原始网络配置。
- `t14-v093-installed-verify.mjs` 保留 19 case 顺序与 source/access≠support/hash/quote/review caps、预算 extend/stop/revoke、同 Task/turn additive human steer；补充 0.3.2 全部四个包文件的 installed-to-package hash、唯一 waiting Call、预算阻塞、精确终态 code/reason、补充输入 origin 与等待边界记录。失败保存 `completed:false`，finally 深恢复历史/config/metadata/default。
- provenance、Renderer、default-source helper 仅更新至固定 0.9.3 身份/标签；Renderer 仍仅使用 live `router/snapshot`，逐 Task 绑定 claim/access/quote/coverage/reason/history，前后深比较无写入。

## 测试与验证缺口

- 独立完成 helper 语法/hash、包闭包、基线深比较，并定向复跑 slow-drip/取消测试 1/1 PASS；按要求未重复全量套件。
- 作者证据为 source 20/20、Task/Renderer 17/17；串行 289/290 的唯一 `ENOTEMPTY` 位于既有 T16 Windows 临时目录清理，隔离复跑 1/1 PASS。仍需合并者在集成点复验。
- 尚未安装 0.9.3；实际 19 Tasks、默认公开来源、installed provenance/Renderer、完整恢复、重启、移除 Companion 后再重启均是后续硬门槛。

## 剩余风险

实际 Windows Desktop 的系统代理/PAC、固定 DoH 和公开来源路径只在安装后验收完成时形成交付证据。账号授权、付费调用及 T24 全 24 票继续保持独立门槛。