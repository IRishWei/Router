# T14 实际安装验收：网络阻塞

2026-10-07，集成代码固定于 `7a56bd465057c8b824ece4788c413a6785a4be41`，Router 0.8.1。**本记录不是 T14 实际验收 PASS；#15 保持打开，完成数仍为 7/24。**

## 已修复并独立审查

companion 0.3.1 的 `findLast(role=user)` 误选真实 standard preset 在人类输入之后追加的 context，导致正文变为固定标题。0.3.2 仅接受 `source.kind=user` 或 source 缺省的 user 消息；来源为 notice/context 的协议文本不能覆盖人类输入。

真实 `SessionController + ToolRuntime + standard` 回归观察到 `user → agent-instructions → time-context`，先复现错误标题，再恢复预期正文。源码与不可变包解包回归各 7/7；非作者 Standards、Spec 均 PASS、0 发现。signal、有限协议、四模型集合及本地零能力边界保留；预设评审仅证明协议，不认证研究质量。

| 对象 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Router 0.8.1 | 150942 | `781BA644249A0A6B72112E36273B7657C77C01804C52A67B517B3473685F8CFF` |
| companion 0.3.2 | 3272 | `EF55553A0081CCADBA6E7F358706FA2FD73B98B3AC13A65CABD412D37BA5BA6A` |

## 实际 Desktop 结果

使用官方 CLI 在独立 DSH home 安装上述固定包，启动前核对所属 PID、启动时间、exe 与 home。Router 的 19 个安装 lib 文件与已审作者构建逐字节一致，集成构建按 LF/CRLF 规范化后相同；companion 四文件与已审 tgz 逐字节一致。旧安装日志保留，新日志使用独立 `review-fix` 后缀。

`v081b` 执行从完整 121 条历史及 config revision 275 开始，创建 2 条新 Task 后，在第二例来源访问断言失败：

- `acceptance-off` 完成，验收 unconfirmed，零 review Call。
- `named-https-access-is-not-support` 的真实产物已与预期研究正文完全一致；来源访问却为 unavailable / `SOURCE_ADDRESS_NOT_AUTHORIZED`，因此不能通过后续 source-access/quote-binding 断言。
- 系统公开 DNS 查询与已安装生产 resolver 的最小 CLI 复现均得到 `raw.githubusercontent.com → 198.18.2.36`。默认 reader 在 HTTP 传输前拒绝该受限网段，没有 HTTP 状态或内容 hash。其他 GitHub/jsDelivr 域名查询也返回同一受限网段，不能据换域名宣称通过。

来源仍固定为本项目 `97d77e20ba6fc10d4ebb7c153866a8a20b0d23ca/GLOSSARY.md`，预期内容 hash 为 `bd44743e93c46cd6f028491d96cae78e085f25a603380a725fd2337dbc4633a2`。未改生产 DNS、SSRF 门禁、来源 URL/hash 或验收断言；未发起付费 API 调用。

## 恢复与保留

finally 恢复 acceptance、budget、模型池顺序、fixed、automatic；config revision 合法递增至 294，storageError=null。临时 companion 经公开 PluginManager 移除，随后重启所属 Desktop。公开 RPC 深比较证明全部 123 条 Task（原 119 条、此前 2 条诊断、本轮 2 条）及完整 Call/ledger、配置、DeepSeek 凭据元数据和原生默认保留，fixture 不再可用。

捕获清单中的 16 份旧失败证据、日志及 0.3.0/0.3.1/0.8.0/0.8.1 包散列未变。保护脚本按捕获清单比较旧文件，新增安装日志不进入旧文件集合。

独立验证目录为 `C:/Users/a1500/AppData/Local/Temp/router-implementation`，关键新证据：

- `t14-companion032-implementation.md`、`t14-companion032-{standards,spec}-review.md`
- `t14-v081b-before-upgrade.json`、`t14-v081b-installed-hashes.json`、`t14-v081b-bundle-enable.json`
- `t14-v081b-partial-evidence.json`、`t14-v081b-source-dns-diagnostic.json`
- `t14-v081b-restored-state.json`、`t14-v081b-bundle-remove.json`、`t14-v081b-failed-run-restart-evidence.json`
- `t14-v081b-protected-evidence-manifest.json`

## 未完成门槛

完整 19 项实际验收仍未完成：真实 named HTTPS 读取与 quote binding、共享两次 review 上限、预算 extend/stop/revoke、真实 human steer 的旧 Call 零派发和同 Task 新 artifact，以及成功执行后的移除/重启总数检查均待新一轮证明。不能以源码 248 项测试、夹具 7 项回归或失败运行的恢复成功代替这些门槛。

用户已被询问修正该域名的代理/DNS 后继续，或明确允许保留 T14 网络阻塞而先推进 T16 共享接线；未答复前不擅自改写交接顺序。若重跑，使用新证据标签（如 `v081c`），把锁定基线更新为 123，完整追加 19 条后应为 142，并保留所有已有记录。T05/T06 的凭据与付费授权问题亦未获答复。
