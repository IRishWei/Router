# T11 安装验收与归档 Standards：PASS

固定归档 HEAD：`e6fc853dc0024ef2f0d8b388344881d4605c69c9`；base：`58fbdc2b17e377fadb711f5fa53deeb9bdaf7699`。比较 `git diff 58fbdc2b17e377fadb711f5fa53deeb9bdaf7699...e6fc853dc0024ef2f0d8b388344881d4605c69c9`。源码 pin：`5b4048dd96237a95ad29d5973c837d60324597f3`，沿用最终 b 轮源码 PASS。范围：README、ticket-contracts、VERIFY/t11-v0120-* 与独立验证目录 a/b/c 安装、RPC、Renderer、保留及归档脚本；未重新审查源码实现。

**硬标准违规：0；可操作启发式建议：0。** 依据 AGENTS.md 公开接口/无 Computer Use 边界、GLOSSARY 验收证据与无法确认口径、ADR 0001/0002、ticket-contracts、T11 契约，未发现违规。

独立只读检验摘要：

- 官方 CLI 脚本明确 --offline、专属 DSH_HOME，并恢复环境；安装回执 exit 0。直接读取 tgz，198923 bytes、SHA-256 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`，31 个条目与清单、实际安装逐项一致。合并相对作者只保留两份 T10 安装复审。
- 4 Task 各含主调用和 session-title；8 次本地 Responses、夹具错误 0。原生主结果、turnOutline、标题均 REFERENCE_OK；精确/别名/缺缓存/长档及各 Task 合计与证据吻合。实际账单、额度比例和重置时间保持 unknown。
- 安装客户端与 Renderer 证据哈希一致，脚本采用 rc.2 Native Renderer/codec 和实时公开 snapshot 载体；明确 react-test-renderer 挂载、未做截图。a→b 只增加等待实际 Task，b→c 只修正文案断言和新证据文件名；产品包未改变，失败记录保留。
- 配置设置恢复，重启配置/全部历史深比较一致，原生默认值与历史 claim 保留。166 份旧冻结文件及 9114595-byte 真实 state 哈希不变；两阶段精确 owner/stop 回执匹配，当前对应 PID 与受控服务均不存在。
- 12 份公共归档与原件字节一致，公开 JSON/文本未检出 token、cookie、原始 subject/email。已安装夹具具有精确本地 origin 拒绝检查。源码 P1 报告/原始复现、409 项旧失败及 410 项最终日志均保留。

仅执行文件、哈希和进程状态读取；未启动 Desktop、发送请求、修改源码/包/旧证据、操作 Codex 配置或系统网络，未重跑源码测试。归档明确 #11/#12 仍 OPEN、累计10/24，真实门槛待新授权；受控 PASS 不等于官方实际用量或生命周期完成。
