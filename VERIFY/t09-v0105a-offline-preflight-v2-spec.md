# T09 0.10.5 离线安装 v2 Spec 预审

## 结论：PASS

未发现阻断问题。v2 修复了安装文件集合未严格核对及 receipt 自证无进程启动的问题；本结论仅批准既定离线安装保全流程，不认证真实推理，#10 保持 OPEN。

## 精确身份

- 源码合并：`c2f6cb1788e84c35f437e664fe8633b4d189044a`；文档 HEAD：`de10788f42cd772f54a57b55f6642dfd2697ebe2`
- helper：`t09-v0105a-offline-install-check-v2.mjs`，6241 bytes，SHA-256 `4BA606D471577D92D27E88EA1A7813F1334F81BFE1BF31B899F709704DF21D0D`
- guards：`t09-v0105a-offline-checker-v2.test.mjs`，2141 bytes，SHA-256 `5E98FD43AF48F61BBD07616A88C15E037D298D27698ACF019E287BE73B42BCFB`
- 包保持 `@irishwei/dsh-router@0.10.5`，184641 bytes / 29 files，SHA-256 `777452049F5F311D29880F3B44713AF2E75122A6E35D6A6F03CCD29CBE27FC49`

## Findings

无。

## 需求符合度

`verifyInstalledFiles` 先解析包根真实路径，再以 `lstat` 递归枚举；内部符号链接/目录联接及非普通文件均拒绝。实际文件相对路径集合必须与包身份严格相等，随后逐文件核对长度与 SHA；before、after 共用同一验证入口。普通文件和包管理器 hardlink 仍按普通文件验证。原 state 精确哈希、233 Tasks / 541 Calls / config578 / consumed claim，以及 `router`、`sessions`、`storages`、凭据等逐文件保全逻辑未放宽。receipt 已移除无法由 helper 证明的 `hostStarted` 字段，仍明确 `newTasks:0`、`modelRequests:0`、`actualInference:'unconfirmed'`。

## 测试与剩余条件

独立运行 guards 4/4 PASS：普通文件/hardlink 通过；额外文件、同内容 junction、同长度错字节均被拒绝。未运行 before、CLI 或 after。执行者仍须在 CLI 前后外部确认精确 DSH 进程为0并保存证据；helper 不替代该检查。
