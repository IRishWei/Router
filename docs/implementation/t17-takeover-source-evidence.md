# T17 源码验证证据

版本0.16.0；author branch `codex/t17-context-takeover`，integration base `3a8d9891fd11e1b4e2fd4621a32ad5204996d963`。对应 [#18](https://github.com/IRishWei/Router/issues/18)，合同见 [T17 takeover](t17-takeover-contract.md)。该记录证明源码受控行为；目标 Desktop 安装与独立两轴复审由 integration 流程另行完成。

## 公开 seam 与 TDD

#1 预先接受的完整 native Task seam：实际 Cordis、AgentLoop、LLM、Session/SessionController、原生 ModelSelection、public asynchronous SessionQuery、真实 Tools registry、附件服务与 Router RPC/snapshot。外部 LLM 只替换为本地 adapter；不替换 Task 内部函数。客户端使用实际 rc.2 SlotRenderer、Typert registry/API gateway，仅 Connection carrier/DOM 为外部测试边界。

逐条完整 Task 红→绿保留在外部 `C:/Users/a1500/AppData/Local/Temp/router-implementation/implement-spec-go-20261009/t17-slice-*`。首条红时主产物停在8字符，无 takeover；绿后同一 Task4→6→咨询→8→target14重新验收通过。slice08 保留原始 all projection 首 Task codec 失败诊断；none 同 cut canonical 比对路线的首条测试明确只有1 Task，无额外 priming 文本请求或费用。

新增有区分度的红绿包括实际 prepared model 与事先 resolve 元数据容量不一致、同 schema tool re-registration 改变语义、预算撤权单独唤醒、最终 query await 中自动开关/连接/停止变化、实际 llm-retry 自动重发2→1、通用 nested child unknown/完成但无表示/未 settle 的 target请求1→0、raw PTC记录拒绝、target child body1→0及实际async wrapper后替换body不沿用旧operation证明。fixture 清理时只关闭自己创建的资源；不会读取真实账号、凭据或私有日志。

## AC 对照

| #18 要求 | 完整任务观察 |
| --- | --- |
| 依据/目标可观察；固定/池/预算；不写默认 | source/target/evidence/hash/原 owner 分开；独立 fixed grant 拒绝；禁用/撤权/固定变化在预算等待中停止；native default 前后相同 |
| 全跨模型对话/用户约束/文本/图像/工具 | 原 prompt、所有4/6/8响应和 advice 逐项保留；原图像 SHA bytes 不变；原 callId/result/schema 保留；same/different adapter replayState 均拒绝 |
| 容量/工具协议/模态不兼容取消 | owned/exact prepared capacity 小值/未知、unknown handoff、system format、image未知/不支持/定价未知、全 tool schema 协议分别拒绝；未发 reservation released |
| 稳定边界/未完成工具/无混合/无新证据不反复 | 原 WeakSet native seam，一次 actual prepared handle；全 awaited races CAS/recheck；new evidence 不足不请求；attempt1；公共 nested pending/unknown 拒绝 |
| 重新验收/同账本/不新 Task | text一Task/turn1/5Calls/60tokens，canonical14passed；target9再次failed/attemptlimit；合法重复读7Calls/84tokens；未知 usage 保留 |
| 图像/工具/容量/格式/重复副作用；不压缩 | source image attachment真实公共 read；duplicate operation/callId body不运行；新ID重复read允许；替换历史拒绝；nested completed无完整表示拒绝 |

固定 fixture 每个完成 Call8input/4output/12total；来源为本地测试数据，不能推断真实价格、模型效果或省钱。图像 Task 前的原生 setup Task 明确独立记账，tested turn=setup.turn+1；Router 本身不创建额外 Task。

Owner 验证分别覆盖 predispatch取消、目标 adapter进入后首 chunk前失败、部分响应后失败和完成。首响应前故障保留 confidence possible/dispatch-unknown；响应后 confidence response-observed/interrupted；两者 usage.total 未知，不退回确定源 owner或制造目标 ack。持久真实 pending/possible freeze 文件重启两次，状态只降级一次、未知消耗保留、没有 adapter 自动调用。生产 native llm-retry 同样不能重发未知目标。

工具验证使用真实定义扩展/execute/result。completed callId不可复用；operationId作为真实副作用幂等 key，不是name+args去重。same schema再注册read语义不能覆盖历史write保护；不相关registry追加允许。通用 Tools.execute({parent:exec.token,...}) fixture无手造PTC事件，分别验证 outer completed不能掩盖childunknown、childpending或不可平面表示的completedchild。

收尾追加八条真实 ancestry 红→绿：缺 agent、已知 parent 但 root 冲突、真实未归属 parent token、两 Session 共用 root 的模糊归属、缺 definition 的 error result、其他 agent 的错误 claim、completed parent 的延迟 child，以及同 Session 后续 turn 不接收旧 child receipt。前六项和延迟 child 的执行 body 或目标请求从1降为0；跨 turn 红时旧 Task 缺 receipt，绿后归属冻结并保留原 Task。最新八项联合8/8收据为 `t17-finish-original-turn-green.log`，各自 `t17-finish-{ancestry,conflicting-root,unobserved-parent,ambiguous-root,missing-definition,conflicting-agent,completed-parent,original-turn}-*` 保留原红绿。missing-definition 第一份 red 只暴露测试错误码字段误用，修正公开 `error.info.code` 后的 `t17-finish-missing-definition-behavior-red.log` 才是目标请求1→0的行为红，不将前者冒充产品失败证据。

Host-only trusted Node 验收并未加入模型会话工具树。T17启用的真实编程 Task 独立验证通过可信 `node-test-workspace-v1`；冻结 workspace 前只等待现有 Router flush，不修改 T13/T16 判据或命令。执行 owner 仍仅对 Task 起点已启用接管的 Task 记录，disabled/legacy null 合法，不构成后续 T19 的通用 owner 合同。

收尾第一轮全套为529/530，唯一失败是 T16 完成任务 fixture 的 Windows ENOTEMPTY teardown，保留 `t17-finish-full-suite.log`。真实 T16完整任务+公开文件IO边界连续10次诊断：`ctx.fiber.dispose()` 返回时10/10仍有1个 Router IO，捕获的既有公开 `flush` 在 dispose后可将全部 IO drain到0（`t17-finish-dispose-repro.mjs/.log`）。仅修改 T16该测试的 cleanup：在 dispose前捕获 `ctx.router.flush`，dispose后再次等待它，删除目录前确保已排队写入结束；不改业务断言、验收标准、源码生命周期，不加重试或吞异常。该单条复验1/1（`t17-finish-t16-dispose-green.log`），完整 serial复验另记；该fixture teardown 证据不代替真实Desktop安装、停用和重启的产品生命周期验收。

## 实际检查收据

早期完整 T17 Task 检查47/47（`t17-slice-25-green.log`），客户端 T16+T17实际 Renderer/RPC2/2（`t17-slice-18-green.log`）。早期全量517/518暴露 Host验收工具receipt污染检查scope（公开fixture evidence `CHECK_INPUT_CHANGED`），按native root归属修复后联合76/76（`t17-native-receipt-scope-green.log`）；后续收据与失败均保留。

最终固定源码前 `node --test --test-concurrency=1 test/*.test.mjs` 全量530/530 PASS（98.206s，`t17-finish-full-suite-final.log`）；T16单处 teardown 修复前的529/530记录保留。0.16.0 build PASS（`t17-finish-build.log`），check与全文件diff-check结果在同一 `t17-finish-*` 收据中保存；merge integration current tip 时 Already up to date（`t17-finish-integration-merge.log`）。最终 SHA 在 Git 与外部 `t17-finish-result.md` 绑定，避免文档自引用；不以旧冻结包或 VERIFY 作为本次通过证明。

本轮没有打包、Desktop启动、真实模型请求、凭据读取或配置复制。Declared candidate/tool/image facts、公共 canonical native审计与provider私有wire/真实质量分别保留边界；无法证明的上下文、协议、工具旧owner或私有replay明确拒绝。官方 API、第二账号及真实效果仍由原最终门槛处理。
