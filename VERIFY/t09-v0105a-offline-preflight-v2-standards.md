# T09 0.10.5 离线安装 v2 Standards 预审

## 结论：PASS

未发现阻断问题。

固定身份：源码整合 `c2f6cb1788e84c35f437e664fe8633b4d189044a`；文档 HEAD `de10788f42cd772f54a57b55f6642dfd2697ebe2`；安装包 184,641 B，SHA-256 `777452049F5F311D29880F3B44713AF2E75122A6E35D6A6F03CCD29CBE27FC49`。

Helper `t09-v0105a-offline-install-check-v2.mjs`：6,241 B，SHA-256 `4BA606D471577D92D27E88EA1A7813F1334F81BFE1BF31B899F709704DF21D0D`。Guard test：2,141 B，SHA-256 `5E98FD43AF48F61BBD07616A88C15E037D298D27698ACF019E287BE73B42BCFB`。

## Findings

无 P0—P3 发现，也未发现适用的基线代码气味。

## 需求符合度

- `verifyInstalledFiles` 先解析包根真实路径，再以 `lstat` 递归枚举；内部符号链接、junction 和非普通文件均被拒绝，包管理器 hardlink 保持允许。
- 排序后的实际相对路径集合与包清单严格深比较，随后逐文件核对长度及 SHA-256，修复了 v1 对额外/陈旧文件的漏检。
- 收据已移除未经 Helper 验证的 `hostStarted` 字段；CLI 前后零 DSH 进程由外部独立证据负责。
- v1 Helper 与 BLOCK 报告原字节保留；产品源码和安装包身份未改变。

## 测试与验证缺口

独立运行 `t09-v0105a-offline-checker-v2.test.mjs`，4/4 通过：普通文件及 hardlink、额外文件拒绝、同内容 junction 拒绝、同长度改字节拒绝。按约束未运行 before、CLI、Host 或模型请求。

## 剩余风险

PASS 仅适用于离线安装前置检查器。实际安装仍须按计划保存 CLI 前后零进程证据，并在 CLI 成功后运行一次 after 校验。
