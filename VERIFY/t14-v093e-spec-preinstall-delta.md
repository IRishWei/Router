# T14 v0.9.3e Spec 预安装增量审查

## 结论

**PASS（helper-only gate）**。未发现阻断问题。生产 Router 0.9.3、fixture 0.3.4 和包门禁没有变化；本结论仅允许继续执行 e 的实际验收，不代表 T14 已通过或可关闭。

## Findings

无。

## 需求符合度

- `t14-v093e-installed-verify.mjs:363-400` 修正了 d 对公开 `Task.inputs` schema 的错误假设。两次 RPC 使用预先固定且不同的 requestId；两个 input 分别精确匹配 requestId、Task turn 和原始 content 的 SHA-256，并通过各自 messageId 绑定初始 `research-claim` 与新增 `includes-literal: CORRECTED`。两项 origin 均要求 `user-message`、对应 requestId 和递增的安全整数 seq；全部 `input-claimed` timeline 还必须与两个 input 按序深等。
- 用公开 `t14-v093d-restored-state.json` 的第 211 个 Task 独立重放上述新断言通过：两个 contentHash 均与重建 RPC content 相同；origin seq 为 8、21；旧 review 为 `not-dispatched/released`，新 review 为 `completed`。
- `t14-v093e-installed-verify.mjs:401-419` 保留同 Task/turn、两次 review、旧 Call 零派发并释放、新 artifact hash 绑定 review、原 artifact 进入 superseded history 及证据记录；d→e diff 未删除既有预算、usage/ledger、cap、source/claim/quote、stop/revoke 断言。
- `t14-v093e-installed-verify.mjs:16,40-46,422-452` 将历史基线固定为 211，仍要求 19 个 case 名称顺序固定、Task ID 唯一、完整旧 Task 前缀不变，并在 `finally` 恢复配置、模型、DeepSeek 元数据与默认模型。独立比较确认 e capture 与 d restored 的 Tasks/config/DeepSeek/default 全部深等，config version 525，marker 为 `complete211BaselineVerified`。
- Renderer 仅迁移 e 证据标签并把最终 Task 数锁为 230；provenance/default-source 仅迁移标签。四个 e JavaScript helper 均通过语法检查。launcher 和 bundle-control 与 d 版逐字节相同。
- d 失败保护 manifest 为 6589B / `F84F2A022139E6FB25A1DB6C42FDDA696505E03F0A55A0C307A62EB8CF6D14E5`；只读 checker 复验为 24 fixed + 2 captured prefixes PASS。e network-before fingerprint 与 d network-after 相同。

## 测试与验证缺口

未执行 Desktop/RPC 或创建 Task。e 的完整 19 case、Renderer、restart、remove 尚待实际运行；d 的 18 case PASS 与公开第 19 Task 只能证明新断言可重放，不能替代 e 的 fresh completed evidence。

## 剩余风险

实际 e 运行仍可能暴露时序或宿主状态问题。完成全部验收并保存恢复、重启、移除及网络不变证据前，不得宣称 T14 PASS、Issue 可关闭或真实账号/全部 24 项验收完成。