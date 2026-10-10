# T17 installed restart scope review

**判定：现有差异未证明#18/#1源码缺陷；整份state.json字节恒定是Root额外判据。** 固定源码`82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`。d已按原判据FAIL，96文件失败冻结及旧标准必须保留；本报告不将d改判为最终PASS。

冻结#18正文L16要求“携带完整可跨模型对话、用户约束、文本/图像和已完成工具记录”，L19要求“同一账本记录全部开销；不新建独立任务”；#1 L109要求“任务记录保留任务身份、模型/账号身份、配置版本、决策原因、验收证据来源、资源置信度和终态”，L175要求“重启持久化”。这些要求保护完整历史事实与权限，未要求当前发现缓存永远保持原字节。

启动`src/index.mjs:1621–1635`先发现native-reference，fixture随后以公开registerOwned恢复owned来源。`src/connections.mjs:189–194、227–238`在候选替换、撤下/恢复或元数据变化时推进代际，`143–162`刷新观测时间，`241–246`记录新tombstone时间。相同最终身份仍可能经历这些过渡；必须使旧capture失效，`300–307`正以authEpoch/configRevision拒绝过期capture。源码不是每次刷新都无条件递增各候选epoch。本次仅revision36→64、时间及14候选epochs/configRevision各+2，与该路径相符。

fresh label宜预声明：

- 已结算checkpoint的全部Tasks/Calls/inputs/完整历史/验收/工具receipts/owner/plan/冻结captures/账本及所有非connections持久字段精确相等；配置、启用池、预算、全局default及fixture counter不变，0新streams。
- connections只允许明确白名单：revision、capturedAt、候选authEpoch/configRevision、tombstone.at；候选数量/顺序/ID、完整identity、ownership/source、可用性/授权状态、能力/handoff、价格及其余字段精确相等。代际为安全整数、不回退，变化须由受控生命周期解释，不能改Task内旧代际或授予新权限。

epochs单调本身不足以认证授权连续性。pending/possible重启另按合同一次降级unknown/paused并禁止自动重发，不适用已结算字节恒定规则。静态源码与既有诊断/回执支持上述判断；本轮未重跑或启动Desktop/模型，未改变任何既有回执。
