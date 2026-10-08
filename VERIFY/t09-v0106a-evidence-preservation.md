# T09 0.10.6a：证据封存

2026-10-09，离线安装后九组既有证据保护检查全部 PASS：T14 0.9.3e、T09 0.10.1a / 0.10.2a / 0.10.2b / 0.10.4a、0.10.4e 准备连续性 v2 与真实结果、0.10.5b 准备与真实结果。

0.10.4e 准备组仍通过五份独立源码历史快照及 Git blob 验证历史连续性，其他 95 项保持原哈希；旧 100 项 manifest 和 checker 原件保留。开发工作目录中的可变源码不作为不可变原件冻结。

0.10.6a 新增独立封存组包含 24 个普通文件：精确包备份、作者双轴报告、非作者合并报告、341 项回归原日志、安装辅助脚本及 pins、双轴安装预审和实际安装报告、安装前原状态与逐文件保全指纹、CLI 收据及零进程快照、旧 owner 原件，以及候选和安装记录。范围不含可变 live state、owner、installed package 或工作目录源码。

- Manifest：`t09-v0106a-preparation-protection-manifest.json`，5846 bytes，SHA-256 `0F3911EBDD8ECDBF5354BC66DEB428C3BFF821E62AD293FE4ADAB15D8E9A3668`。
- Checker：`t09-v0106a-preparation-protection-check.mjs`，876 bytes，SHA-256 `15026772F2110820FE00AC8837C468310042D2633B9DF5432BF82B912BC0E8E1`。
- 新组检查 PASS：`frozenFilesPreserved:24`、`workingFilesFrozen:false`、`manifestIdentityPreserved:true`。

原件和收据位于 `C:/Users/a1500/AppData/Local/Temp/router-implementation`，均独占新建。此封存不改变 0.10.5b 实际推理 BLOCK、#10 OPEN 或许可已消耗的结论。
