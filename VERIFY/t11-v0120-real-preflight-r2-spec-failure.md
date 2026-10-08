# T11 r2 real-preflight 独立 Spec 复审

Pin：helper manifest SHA-256 `9809B6A125FE5746FB41F35136631E490B7931149EE1CF36AEB62EA3845F8290`；源码 `5b4048dd96237a95ad29d5973c837d60324597f3`；归档 `e6fc853dc0024ef2f0d8b388344881d4605c69c9`；包 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。旧源码及受控结论沿用，本轮仅复核辅助脚本。

**r2 Preflight Spec FAIL：wrong 2项；missing / partial / scope creep 0项。以下仅为oracle问题，不据此判断生产源码。**

[P2 wrong] 部分缓存与聚合输入矛盾仍能确认。契约第10行要求只累计“可证明的输出与缓存小计作为预算下界”。`t11-v0120r2-usage-oracle.mjs:29–38` 仅在三个输入分区齐全时比较其和与aggregate；`:41–54` 随后计价并确认。纯内存复现：aggregate1000、cacheRead2000、cacheWrite缺项、输出50、total1050，填入小计USD0.0007，仍 returnedUsageConfirmed=true。超过聚合输入的缓存分项不能作为可信下界。修复：即使分区不全，也拒绝任何已知缓存分项或其和超过可信聚合输入。

[P2 wrong] Call total缺项时任意Task total仍能通过。#12要求“按实际返回用量”计算并展示token；`t11-v0120r2-usage-oracle.mjs:65–68` 在任一Call缺total时跳过账本total校验。纯内存复现：aggregate1000、输出50、cacheRead200、cacheWrite缺项，删除Call total，将ledger.tokens.total设999999，仍确认。修复：按明确的可信推导/unknown语义独立验证Task total；无法推导时也校验未知，不能跳过。

原r partial已关闭：将原两个反例送入r2完整acceptance内存stub，空usage及金额999均保存passed=false/unconfirmed、exit1，且只有一次mock检测入口。9项guard/oracle测试通过，但未覆盖上述两例。

18份辅助哈希、31个安装文件吻合；旧r15文件及FAIL报告哈希不变。新home无fixture，human grant/owner/model intent不存在。其余原边界保持：一次intent、1Task/2Requests、65536token/120000ms、无输出硬限/retry/扩额/API后备，官方浏览器stdin、恢复/只读Renderer/重启及owned退出未扩张。T10生命周期不在范围内。

未启动真实phase、Desktop或浏览器，未生成human grant；复现全在内存，无文件/网络/子进程。真实门槛仍pending，不申请许可，#11/#12保持打开。报告以CreateNew（wx）新建，r/r2冻结文件和旧报告未改。
