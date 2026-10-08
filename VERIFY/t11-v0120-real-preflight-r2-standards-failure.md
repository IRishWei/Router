# T11 r2 real-preflight Standards：FAIL

固定 source：`5b4048dd96237a95ad29d5973c837d60324597f3`；archive：`e6fc853dc0024ef2f0d8b388344881d4605c69c9`。包 SHA256：`47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。

18文件 helper manifest SHA256：`9809B6A125FE5746FB41F35136631E490B7931149EE1CF36AEB62EA3845F8290`。

硬标准违规（均为 P2，阻塞当前真实验收准备）：

1. `t11-v0120r2-usage-oracle.mjs:29—38` 只在完整输入分区时核对 aggregate。输入 aggregate=1000、cacheRead=2000、cacheWrite缺失、output=50/total=1050，仍确认 returnedUsage 并接受 .0007 小计。违反 T11 契约第10行“已知小计只汇总可证明部分”及 ADR0002 第3行“质量结论限定在实际检查覆盖的范围内”；acceptance.mjs:75、79 可把此结果写成 passed。最小修复：任何已知输入子项之和超过 aggregate 即拒绝，增加不完整分区反例。范围限定：官方 Responses 生产入口 `src/chatgpt-responses.mjs:363—366` 已拒绝此类负残差；本项是独立验收 oracle 漏检，不是已证实生产漏洞。

2. `t11-v0120r2-usage-oracle.mjs:65—68` 在任一 Call 缺少 total 时跳过 Task total 检查。合法 partial usage（aggregate=1000、cacheRead=200、output=50、reasoning=30、cacheWrite/total缺失）配 ledger.tokens.total=999999，仍返回 confirmed 与 .00052 小计。违反 ticket-contracts.md 第34行未知用量边界及 ADR0002 第3行证据覆盖要求。最小修复：独立推导有效 total；不可证明时必须为 null，同时保留完整分区且 reasoning=0 时的既有推导规则。

启发式建议：无。

检验摘要：9项现有纯本地测试PASS；新增最小复现两项均意外接受，最终断言失败。精确输入/输出保存于同目录 `t11-v0120r2-standards-oracle-repro.mjs` / `.log`。18 helper、旧r15文件、198923B冻结包和31安装文件匹配；166旧冻结文件及9114595B旧state哈希不变。无grant/owner/intent、无Desktop进程；未执行真实phase或生成许可。新许可应继续等待，#11/#12仍OPEN，源码既有PASS不重审。
