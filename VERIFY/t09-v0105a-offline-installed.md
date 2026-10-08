# T09 0.10.5 离线安装与保全

2026-10-09。源码修复已由独立 Standards / Spec 复核并由非作者合并；本记录只覆盖离线安装，真实推理仍未确认。

- 修复作者提交：`e7b2cd7e67ca98b068ecfd3b5a6f464ceca1adf6`；非作者合并：`c2f6cb1788e84c35f437e664fe8633b4d189044a`。
- 包：`irishwei-dsh-router-0.10.5.tgz`，184641 bytes，29 个文件，SHA-256 `777452049F5F311D29880F3B44713AF2E75122A6E35D6A6F03CCD29CBE27FC49`。
- 使用 DSH 官方 CLI 安装至原独立验收 home；安装前后 Desktop 进程均为零，CLI 退出码为零。
- v2 检查器严格枚举安装文件，拒绝额外文件、内部符号链接/目录联接及字节变化；4/4 保护测试通过。
- 470 个持久化数据文件原字节保留，包含原状态、会话、存储及凭据文件的哈希保全。凭据未解析、输出或另行保存。
- Router 状态保持 233 Tasks、541 Calls、config578，旧一次性 claim `eefbe023-a0a9-4320-85c3-a5817bdfa41e` 未轮换。
- 原状态 9045336 bytes，SHA-256 `E7B1C7763BF5EB13A9AF02D6A974BC9CF917D4C084F33AB984D9A50DE3CF54F3`。
- 离线安装阶段未启动 Host、OAuth 或模型请求。

独立预审 v1 的 Standards 曾因文件集检查不完整及不能从快照证明“未启动 Host”而 BLOCK。原报告和辅助脚本保留；v2 补充严格枚举，删除不可由程序证明的字段，新增 CLI 前后进程快照。v2 Standards / Spec 预审与实际安装后复核均 PASS；原 BLOCK 未覆盖。

实际安装后 [Standards 复核](t09-v0105a-installed-standards.md)与 [Spec 复核](t09-v0105a-installed-spec.md)分别保存原报告。Spec 报告透明记录：哈希比较程序曾以内存方式打开凭据文件字节，未解析、输出或保存正文；其最终独立结论只陈述安装文件和状态原件的核对，470 项保全依据既有 v2 安装检查结果。

全部原证据位于 `C:/Users/a1500/AppData/Local/Temp/router-implementation`，使用新前缀独占写入。真实验收另记为 `t09-v0105b`，不能将本次离线 PASS 作为真实推理 PASS 或关闭 #10 的依据。
