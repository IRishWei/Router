# T11：订阅参考价值与额度未知状态

对应 [#12](https://github.com/IRishWei/Router/issues/12)，基线 `0b9ec4fe21cc898d3240b232966bc6838ca041b9`。T09 已完成，T10 源码与目标 Desktop 受控验证已通过，真实生命周期门槛仍打开；本任务独立开发，不复用或重置旧真实调用许可。

2026-10-09 查阅官方 [API 价格](https://developers.openai.com/api/docs/pricing)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[推理用量](https://developers.openai.com/api/docs/guides/reasoning)、[缓存计价](https://developers.openai.com/api/docs/guides/prompt-caching)。独立验证目录保留价格、模型页面的原始 Markdown 与哈希；运行时不抓取价格或私有订阅接口。

- 仅 Router 自有官方 ChatGPT OAuth 来源、`chatgpt-subscription` 计费路径与精确 API 模型 ID 采用冻结价格表。初版覆盖 `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6-luna`、`gpt-6-sol`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`。不由显示名称、大小写、前缀、后缀或相似别名猜测映射；其他模型保持未知。记录来源、日期、API ID 与精确映射置信度。
- 比较口径为 USD、Standard API 文本 token 参考价；套餐实际服务档位、账单与额外工具收费不由该值推断。报价在 Call 预留时冻结，实际结算使用返回用量，重启不以新版价格回填旧 Call。官方 ChatGPT 参考价不接受任意手工报价替代，历史手工配置也不能绕过可信映射。
- 输入按普通输入、缓存读、缓存写三个不重叠子项计价；完整输入为三者之和。保存官方聚合输入用于审计，缓存分项缺失时普通输入仍为未知，不把聚合输入当作普通输入。272K 按十进制 272000 token 作为短上下文上界，超过时整次请求采用官方长上下文价格。推理 token 已包含于输出，不再相加计价。
- 缺少影响计价的 token 或上下文档位、用量互相矛盾、模型映射未知时，完整参考值为 unknown。无法证明的输入小计也不保留为已知值；推理分项未返回但完整输出已知时，可计完整输出并继续将推理分项显示未知。已知小计只汇总可证明部分；未映射的订阅 Call 使整项订阅参考总额保持未知。
- 实际账单支出单独为 unknown，API 费用计算与订阅参考价值按不同 kind 统计。参考值不能证明现金节省，未知值不能按零支出处理。预算继续执行明确的 token、耗时、同口径金额限制，缺失报价或预测时保留无法完整执行的说明，不由额度未知新增限制。
- 当前公开 ChatGPT 契约只有模型目录、推理与额度错误恢复，没有可用于完整账号占比的可信额度数据。每个账号记录额度比例、重置时间 unknown、`scarcityApplied: false`，不按本地 token 累计推断全账号百分比，不访问私有接口，不让未知额度影响排序。
- 完整原生 Task 覆盖精确映射、相似别名、缓存/推理、缺失用量与额度；Renderer 展示有或没有估算的理由、来源日期、参考口径与未知支出。另验证长上下文边界、混合已知/未知 Call、冻结报价与重启保留。

实现后固定基线做独立 Standards/Spec 复审与非作者合并，再做目标 Desktop 受控验收。与 T10 共同需要的真实验收仅在新包、脚本和预算就绪后申请；本地 fixture 不替代官方真实门槛。
