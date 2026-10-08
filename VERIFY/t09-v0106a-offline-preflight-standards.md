# T09 v0.10.6a 离线安装 Standards 预审

## 结论：PASS

## Findings

未发现阻断问题。

## 需求符合度

固定身份一致：作者 `91932319c8958f2d3273bf4330d4b84a20ffb1fb`、非作者合并 `e6f5b354d75aadddca1cfafbb7d2b1c045190f9f`；包为 184985 bytes / 29 个普通文件 / SHA-256 `D6A5F7…BC56`，独占备份同字节同哈希。helper 为 6426 bytes / `6759C8…A23D`，pins、PowerShell 与 helper 的 state、owner、包身份互相一致。

`t09-v0106a-offline-install-check.mjs:54-75` 对安装根 realpath 后以 lstat 递归，拒绝内部链接和非普通文件，严格比较完整文件集合，再逐文件校验 bytes/SHA；hardlink 保持允许。`:79-108` 在 before/after 均固定 raw state 的 234 Tasks、543 Calls、config 584、claim 与 SHA，并对 router/sessions/storages/凭据文件/匿名 ID 的路径、字节数和哈希做全量前后等值比较，未输出凭据正文。

`t09-v0106a-offline-install.ps1:19-49` 固定旧 owner SHA 及 `t09-v0105b/restart/0.10.5/PID4584/stopped`，CLI 前后均要求零 DSH 进程并独占保存快照；只在独立 `DSH_HOME` 下调用官方 `plugin --profile desktop add <固定包> --offline`，并恢复环境变量。未见可操作的 Fowler 基线 smell。

## 测试与验证缺口

Node 与 PowerShell 语法通过；独立验证当前 0.10.5 的 29 文件通过。临时夹具 4/4 通过：普通/hardlink 接受，额外文件、junction、同长度改字节均拒绝。包清单为 29 个普通项，无越界路径；当前 state/owner/pins 和零进程均匹配。

## 剩余风险

本预审未运行 before/after 或 CLI，因此只认证安装流程可执行；实际安装及数据保全仍须由后续 receipt 证明。它不认证 OAuth 或推理，0.10.5b 的真实推理 BLOCK 保持。
