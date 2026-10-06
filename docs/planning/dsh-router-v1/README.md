# 首版开发任务

来源：[GitHub 规格 #1](https://github.com/IRishWei/Router/issues/1)。已按确认的草案发布 24 张任务票（#2—#25）；父规格的正文、标签和状态保持不变。

每张票交付可演示的完整行为，包含必要界面、请求路径、记录和外部测试。仓库尚无源码，没有需要先做的宽重构。

## 顺序与依赖

1. **[T01 桌面插件安装与最小完整任务（#2）](https://github.com/IRishWei/Router/issues/2)** — 前置：无。从桌面安装插件，启用一个可控模型完成任务，查看模型选择与结果；关闭路由后保留原生执行和设置入口。

2. **[T02 模型池管理、手动固定与配置生效（#3）](https://github.com/IRishWei/Router/issues/3)** — 前置：[T01 / #2](https://github.com/IRishWei/Router/issues/2)。在界面启用两个可控模型、固定执行模型，并看到运行中修改何时生效。

3. **[T03 完整任务记账、预算预留与超限暂停（#4）](https://github.com/IRishWei/Router/issues/4)** — 前置：[T02 / #3](https://github.com/IRishWei/Router/issues/3)。任务内所有调用产生可追溯消耗，预计下一次调用超限时暂停，允许用户扩展同一任务预算。

4. **[T04 社区候选兼容验证与复用决定（#5）](https://github.com/IRishWei/Router/issues/5)** — 前置：[T02 / #3](https://github.com/IRishWei/Router/issues/3)。在目标桌面验证最接近社区方案的最小任务路径，给出可复用能力及后续实现边界。

5. **[T05 DeepSeek API 连接到完整任务（#6）](https://github.com/IRishWei/Router/issues/6)** — 前置：[T03 / #4](https://github.com/IRishWei/Router/issues/4)。在插件界面配置 DeepSeek API、发现候选并完成可记账任务。

6. **[T06 OpenAI API 连接到完整任务（#7）](https://github.com/IRishWei/Router/issues/7)** — 前置：[T03 / #4](https://github.com/IRishWei/Router/issues/4)。通过插件连接 OpenAI API，选择账号可用模型并执行可记账任务。

7. **[T07 OpenAI 兼容端点的连接与能力验证（#8）](https://github.com/IRishWei/Router/issues/8)** — 前置：[T06 / #7](https://github.com/IRishWei/Router/issues/7)。用户在界面添加自定义兼容端点，验证可用能力后参与任务执行。

8. **[T08 发现并引用已有 DSH 连接（#9）](https://github.com/IRishWei/Router/issues/9)** — 前置：[T03 / #4](https://github.com/IRishWei/Router/issues/4)。插件列出可通过公开宿主契约复用的已有连接，用户启用后可完成任务。

9. **[T09 独立 ChatGPT 授权与首个任务（#10）](https://github.com/IRishWei/Router/issues/10)** — 前置：[T06 / #7](https://github.com/IRishWei/Router/issues/7)。在插件点击官方授权，返回后发现账号可用模型并完成同一 DSH 任务。

10. **[T10 ChatGPT 续期、切换账号与退出恢复（#11）](https://github.com/IRishWei/Router/issues/11)** — 前置：[T09 / #10](https://github.com/IRishWei/Router/issues/10)。授权连接可重启恢复、串行续期、切换账号及退出，失败时任务得到清晰暂停原因。

11. **[T11 订阅参考价值与额度未知状态（#12）](https://github.com/IRishWei/Router/issues/12)** — 前置：[T09 / #10](https://github.com/IRishWei/Router/issues/10)。订阅任务展示 token、可信映射下的 API 参考价值及额度状态，缺失信息保持未知。

12. **[T12 轻量判断与起始模型自动选择（#13）](https://github.com/IRishWei/Router/issues/13)** — 前置：[T03 / #4](https://github.com/IRishWei/Router/issues/4)、[T04 / #5](https://github.com/IRishWei/Router/issues/5)。提交任务后，插件筛选已启用且兼容的模型，按目标选择起始模型并显示理由。

13. **[T13 编程、写作验收与有条件模型评审（#14）](https://github.com/IRishWei/Router/issues/14)** — 前置：[T03 / #4](https://github.com/IRishWei/Router/issues/4)。完成编程或写作任务后自动检查明确要求，必要时有界评审，并展示证据支持的终态。

14. **[T14 研究任务的来源支持与覆盖验收（#15）](https://github.com/IRishWei/Router/issues/15)** — 前置：[T13 / #14](https://github.com/IRishWei/Router/issues/14)。研究任务结束后，自动检查要求覆盖及来源是否支持对应论点，显示遗漏与不确定项。

15. **[T15 图像理解的模型选择与自动验收（#16）](https://github.com/IRishWei/Router/issues/16)** — 前置：[T06 / #7](https://github.com/IRishWei/Router/issues/7)、[T12 / #13](https://github.com/IRishWei/Router/issues/13)、[T13 / #14](https://github.com/IRishWei/Router/issues/14)。提交带图像的任务，选择确实兼容的模型执行，并按参考答案和明确要求验收。

16. **[T16 受阻后的单 agent 专家咨询（#17）](https://github.com/IRishWei/Router/issues/17)** — 前置：[T12 / #13](https://github.com/IRishWei/Router/issues/13)、[T13 / #14](https://github.com/IRishWei/Router/issues/14)。当前模型重复受阻时咨询另一个合适模型，将建议交回当前模型继续执行。

17. **[T17 稳定边界接管与完整上下文交接（#18）](https://github.com/IRishWei/Router/issues/18)** — 前置：[T16 / #17](https://github.com/IRishWei/Router/issues/17)、[T15 / #16](https://github.com/IRishWei/Router/issues/16)。咨询后仍受阻或需要重新规划时，由另一模型接续同一任务，保留可靠上下文。

18. **[T18 整条任务链的故障恢复与暂停（#19）](https://github.com/IRishWei/Router/issues/19)** — 前置：[T17 / #18](https://github.com/IRishWei/Router/issues/18)、[T10 / #11](https://github.com/IRishWei/Router/issues/11)。执行、咨询或接管出错时有限恢复，必要时暂停，并保留任务结果与可追溯状态。

19. **[T19 首次引导、三页管理与任务时间线（#20）](https://github.com/IRishWei/Router/issues/20)** — 前置：[T18 / #19](https://github.com/IRishWei/Router/issues/19)、[T11 / #12](https://github.com/IRishWei/Router/issues/12)、[T07 / #8](https://github.com/IRishWei/Router/issues/8)、[T08 / #9](https://github.com/IRishWei/Router/issues/9)、[T05 / #6](https://github.com/IRishWei/Router/issues/6)。用户通过简短引导启用模型池，日常调整策略并查看结果、费用口径与路由过程。

20. **[T20 四类任务的冻结样例与自动对照报告（#21）](https://github.com/IRishWei/Router/issues/21)** — 前置：[T19 / #20](https://github.com/IRishWei/Router/issues/20)、[T14 / #15](https://github.com/IRishWei/Router/issues/15)。在界面启动可控的四类对照实验，生成包含失败和未知的完整报告，建立真实评估入口。

21. **[T21 真实对照实验与继续开发门槛（#22）](https://github.com/IRishWei/Router/issues/22)** — 前置：[T20 / #21](https://github.com/IRishWei/Router/issues/21)。在批准预算内执行真实四类对照，给出继续自研、转为集成或停止路由层的证据结论。

22. **[T22 本地观察、影子计算与策略版本（#23）](https://github.com/IRishWei/Router/issues/23)** — 前置：[T19 / #20](https://github.com/IRishWei/Router/issues/20)、[T14 / #15](https://github.com/IRishWei/Router/issues/15)。任务结束后本地记录可验证结果，显示候选策略的影子选择及差异，不额外执行候选模型。

23. **[T23 小范围真实策略试用、采用与回退（#24）](https://github.com/IRishWei/Router/issues/24)** — 前置：[T21 / #22](https://github.com/IRishWei/Router/issues/22)、[T22 / #23](https://github.com/IRishWei/Router/issues/23)。用户一次性开启后，以不超过 5% 的初始比例试用候选策略，证据达标才扩大，退化时回退。

24. **[T24 目标桌面的完整交付验证（#25）](https://github.com/IRishWei/Router/issues/25)** — 前置：[T23 / #24](https://github.com/IRishWei/Router/issues/24)。在最终批准范围内验证安装、首次配置、任务执行、学习、重启恢复和卸载，交付可安装版本。

## 执行边界

- 全部 24 张任务票的正文、ready-for-agent 标签与 36 条 GitHub 原生阻塞关系已核验；结果记录于 publication.json。父规格仅作为子票正文引用。
- 当前可开始的任务只有 [T01 / #2](https://github.com/IRishWei/Router/issues/2)；前置均完成后才能领取后续票。ready-for-agent 表示票已可供实现，不代表其阻塞已解除。
- T21 的真实效果结论是额外决策门槛；关闭本票不等于效果通过。T23/T24 必须检查允许继续的结论与用户开启条件。
- 模拟验证、真实宿主验证与真实计费调用证据分别记录；无凭据、资格或实验预算时不得宣称已完成真实验证。
- T04 仅处理最小社区路径和复用决定，不承诺在一张票内迁移整个社区项目。

## 覆盖检查

- 安装、原生选择与配置生命周期：T01、T02、T19、T24。
- API/兼容端点/已有 DSH/官方 OAuth：T05—T11。
- 全部调用记账与预算：T03；订阅口径：T11。
- 起始模型、咨询、接管与恢复：T12、T16—T18。
- 编程、写作、研究、图像验收：T13—T15。
- 社区复用与四类真实对照：T04、T20、T21。
- 本地观察、真实试用及回退：T22、T23。

发布映射与核验状态见 [publication.json](publication.json)；每张任务票保留独立的本地正文副本。

