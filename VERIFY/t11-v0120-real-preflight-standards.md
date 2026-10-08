# T11 r3 real-preflight Standards：PASS

固定 source：`5b4048dd96237a95ad29d5973c837d60324597f3`；archive：`e6fc853dc0024ef2f0d8b388344881d4605c69c9`；包 SHA256：`47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。

18文件 helper manifest SHA256：`6061ECB9540E196B1C7B288642C860991FD22ED2AB80F811083BD94D5B19520E`。

硬标准违规：无；启发式建议：无。沿用 AGENTS、ticket-contracts、T11 契约与 ADR0002 标准，仅复核 r2→r3 增量及相邻验收边界，不重审既有源码/受控结果。

两个 r2 finding 已消除：

- `t11-v0120r3-usage-oracle.mjs:36` 在完整或不完整分区均拒绝已知缓存下界超过可信 prompt。原始 aggregate=1000/cacheRead=2000 反例现抛 `RETURNED_USAGE_INCONSISTENT`，不再认证 .0007 小计。
- 同文件第67—76行逐 Call 核对 reported total；仅完整输入/缓存/输出且 reasoning===0 时用 BigInt 推导，否则 Task total 必须 null。原始 partial 缺 total、Task total=999999 反例现拒绝；合法零 reasoning 推导仍通过。

oracle 仍独立于产品 ledger/pricing；固定整数费率、272000边界、普通输入未知、推理不重复、Call/Task金额及可证小计核对保留。`acceptance.mjs:75、79—94` 仍在 oracle 通过后才 passed；异常保持 unconfirmed、不追加请求并恢复配置。其余运行期 helper 与 r2 仅更换家族/home，许可、一次 intent/claim、精确进程/安装、官方浏览器 stdin、公开RPC、只读 Renderer 与重启检查无功能变动。

独立检验：11项纯本地 guard/oracle 测试PASS，正常多Call/partial/long/unknown及零 reasoning 推导通过。r2原始复现仅改import的新 `t11-v0120r3-standards-oracle-repro.mjs` 两项均拒绝，日志同名 `.log`；旧复现和FAIL报告保留。r/r2/r3的15/18/18文件哈希、198923B冻结包、31安装文件匹配；166旧冻结文件及9114595B旧state哈希不变。fresh home仅profiles；无grant/owner/intent或Desktop进程。

未运行真实phase、未生成许可。此PASS仅认证准备状态；官方真实用量与T10生命周期均未完成，新人工许可仍待取得，#11/#12保持OPEN，旧许可不继承。
