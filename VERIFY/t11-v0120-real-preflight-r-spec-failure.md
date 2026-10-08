# T11 real-preflight 独立 Spec 复审

Pin：helper manifest SHA-256 `7E337A39DA491EB2646E48C9186351D95FCA4A115D93A53CFC746983DB7C8FA6`；源码 `5b4048dd96237a95ad29d5973c837d60324597f3`；归档 `e6fc853dc0024ef2f0d8b388344881d4605c69c9`；包 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。沿用旧源码与受控结论，仅审查固定15个辅助文件及安装身份。

**Preflight Spec FAIL：partial 1项；missing / scope creep / wrong 0项。此 finding 属于验收断言，不是源码缺陷。**

[P2 partial] 真实用量与参考金额尚无有效验收断言。#12 要求“按实际返回用量和可信同模型价格映射计算订阅参考价值”；契约第10行要求“仍累计可证明的输出与缓存小计作为预算下界”。`t11-v0120r-acceptance.mjs:64–77` 只核对映射、报价元数据及一个缺项条件，随后直接 passed=true；`t11-v0120r-installed-renderer.mjs:38–41` 仅检查界面包含原记录金额，不能补足数值验证。

独立纯内存复现：输入700、缓存读200、缓存写100、输出50（含推理30），冻结费率2/0.1/2.5/10，应为USD0.00217；把 Call与账本金额改成999，脚本仍 PASS。另一复现将usage置空、金额/小计null，也 PASS。均未写文件、启动进程或访问网络。错误参考值或完全没有返回用量可能被记为真实验收完成。最小修复：按冻结报价、实际分区及上下文档位独立核对Call/账本完整值与可证小计，验证缺项未知；完全没有可信用量时保留unconfirmed，停止原Task，不追加请求。

其余边界未发现问题：15份哈希及31个安装文件吻合；新home无fixture，只有profiles。human grant、owner、model intent均不存在。launch及RPC先验证新许可，模型intent以wx限制一次，沿用Detection的1Task/2Calls、65536token/120000ms、绝对时限；无retry/扩额/APIfallback。官方浏览器URL经stdin传递，恢复/只读Renderer/重启与严格owned退出路径保留。权限门闩记录不替代人工同意。

本轮未启动Desktop/浏览器/模型，也未生成human grant。旧166文件/state保留检查沿用并由RPC入口执行；不重置claim、不读Codex认证。T11真实门槛尚未执行，T10生命周期不在本提案覆盖范围，#11/#12保持打开。报告CreateNew（wx）新建。
