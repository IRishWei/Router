# T11 / #12 最终独立 Spec 复审

Pin：基线 `0b9ec4fe21cc898d3240b232966bc6838ca041b9`；作者 `5b4048dd96237a95ad29d5973c837d60324597f3`。完整比较 `git diff 0b9ec4fe21cc898d3240b232966bc6838ca041b9...5b4048dd96237a95ad29d5973c837d60324597f3`；本轮重点 `e492d864683f7650a901a978b263cbe50d4c5b73...5b4048dd96237a95ad29d5973c837d60324597f3`。规格：[#12](https://github.com/IRishWei/Router/issues/12)、票据快照、T11实施契约、ticket-contracts及2026-10-09官方快照。

**累计源码 Spec PASS。missing / partial / scope creep / wrong：均0项，无未解决源码 findings。**

新增预算修复符合契约“仍累计可证明的输出与缓存小计作为预算下界”：缺缓存写时聚合输入保持审计用途，普通输入与完整金额仍unknown；可信聚合输入用于选择上下文档位，不重新当作普通输入。上下文也未知时，只以两档均适用的最低已知费率累计可证明分项；矛盾用量仍保持全部小计未知。

`src/ledger.mjs:21` 接收冻结Call的usageAccounting，`:102` 在汇总时沿用该证据；`src/index.mjs:1096` 的结算成本采用相同输入。因此Call、账本与同口径预算一致，已消耗的可证小计不会因完整金额unknown而丢失。Renderer明确显示“预算下界”，完整参考额、真实账单及额度仍未知，没有把小计冒充完整支出。

结合a轮完整diff审查，精确ID/可信官方来源/日期与置信度、Standard USD口径、272000边界、缓存读写分区与推理不重复、旧Call冻结报价、历史手工价隔离、混合未知Call、账号/frame资格、明确token/时间/金额限制及无私有quota访问均保持，未新增范围扩张。

检验摘要：原始Standards预算复现独立PASS：waiting-budget、1次本地Responses、聚合1000、普通输入unknown、金额null、小计0.00052。相关定向守卫9/9 PASS。另完整受控Task验证聚合272001选择长上下文，小计0.00079且完整额null；重启成本深比较一致，Renderer正确解释下界。上下文完全未知时独立核对最低费率小计0.00077。作者410/410及build/check为作者证据，本轮未重跑全套。

只读仓库，仅本地受控HTTP与合成数据；无真实模型、Desktop或Computer Use。a报告及原始失败证据保留，本报告wx新建。T11目标安装门槛仍待完成，T10官方真实生命周期仍pending；源码PASS不关闭Issue、不继承旧真实许可。