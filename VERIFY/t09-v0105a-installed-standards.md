# T09 0.10.5 离线安装 Standards 独立审查

## 结论：PASS

未发现阻断问题。

## Findings

无 P0—P3 发现。

## 安装与身份

- 产品源码整合：`c2f6cb1788e84c35f437e664fe8633b4d189044a`；当前文档 HEAD：`de10788f42cd772f54a57b55f6642dfd2697ebe2`。
- 安装包：184,641 B，SHA-256 `777452049F5F311D29880F3B44713AF2E75122A6E35D6A6F03CCD29CBE27FC49`。
- 已安装 `@irishwei/dsh-router@0.10.5`。通过 v2 的真实路径、`lstat`、严格文件集合及逐文件长度/SHA-256 校验，安装目录恰好包含包清单中的29个文件；没有额外文件、内部符号链接或异常类型。
- 收据 `t09-v0105a-offline-install-receipt.json`：531 B，SHA-256 `78AC302103995C71E12A6298C9511CF3A4D9F1BA8CBA4EB7AD72E36AEB832FB2`。

## 数据保留

独立重新枚举 `router`、`sessions`、`storages`、DSH credential 文件和 anonymous ID；拒绝链接后，将470个当前普通文件逐项与 `t09-v0105a-preinstall-preservation.json` 比较，路径、长度和 SHA-256 全部相同。

`state.json` 仍为 9,045,336 B，SHA-256 `E7B1C7763BF5EB13A9AF02D6A974BC9CF917D4C084F33AB984D9A50DE3CF54F3`；保持233个 Task、541个 Call、配置版本578，已消费 claim `eefbe023-a0a9-4320-85c3-a5817bdfa41e` 未轮换。

## 进程与范围

CLI 前、后证据分别记录0个 DSH 进程，after 记录退出码0；审查时再次确认当前为0个 DSH 进程。未启动 Host、未执行真实模型请求，也未运行重复全量测试。

本 PASS 仅证明 **0.10.5 离线安装完整且既有数据原字节保留**。它不证明 ChatGPT OAuth 实际推理已经恢复；真实验收仍为 `unconfirmed`，必须等待新的明确有界许可。
