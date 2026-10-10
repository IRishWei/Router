# T17 installed Spec final

**PASS，当前发现0项：遗漏/部分0、scope creep0、实现错误0。** 审查固定源码`82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`及fresh e受控安装证据；原base `3a8d9891fd11e1b4e2fd4621a32ad5204996d963`、源码r3 PASS/535回执不变。

独立校验e冻结276项、a37/b42/c44/d96共219项全部字节/哈希匹配，37个安装文件吻合。0.16.0包233897字节，SHA256 `64A7CFA962C08760D8C0C3235FCAB662CA449DD54C98B10796114728CC5C04FA`。四份实际executed scripts及各29项原/复制依赖匹配。

#18 L16要求“携带完整可跨模型对话、用户约束、文本/图像和已完成工具记录”，L19要求“重新验收、同一账本记录全部开销；不新建独立任务”。只读重算10场景：同Task/session/turn、owner/plan与最终native DTO逐项一致，所有原messages/system/tools/toolHistory保留；PNG原ref/hash及工具call/result原文一致。新ID重复read两次合法，重复副作用body仅一次。12 Tasks包含2个显式图像setup；60 Calls/59 preset streams/472 tokens全部归账，无隐藏Task或预算扩额。固定/容量/协议/模态拒绝均target0；预算等待撤权真实MODEL_DISABLED、未派发预留释放。用户设置/default恢复。

#1 L109要求保留完整任务身份、模型/账号、配置、决策、证据与终态，L175要求“重启持久化”。e重启0 streams；全部nonconnections存储字段及完整counter字节精确一致，冻结Task captures未改。仅14个原fixture候选epochs/configRevision各+2、registry+28及观测/tombstone时间刷新，其余身份、状态、能力/handoff字段全部精确相等。whole-state字节不变明确false；d原FAIL与96项冻结保持。

补充4及scope review在启动前复制。后处理TypeError保留；原/修复helper哈希及diff证明仅改flat identity读取、记录替代文件，预声明14/2/28和完整历史判据未减弱，无新增Desktop/RPC/stream。12个native Renderer行及10个plan/owner行通过，未声称截图验证。

本轮仅只读源码/回执及离线重算；pending-review冻结阶段未改。DTO哈希不等于provider wire bytes，当前代际刷新不证明永远稳定授权；535亦不覆盖全部未知路径。真实Go/官方API/第二账号、模型/视觉质量、费用及收益最终门槛仍未验证，0生产调用不将fixture当认证。
