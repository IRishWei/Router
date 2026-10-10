Spec：FAIL。缺失/部分 0；越界 0；貌似实现但错误 1（P2）。

固定范围：547b8b188036a43f4f5627f4cb103598c0c9d3f0...33116cd196c29c59324466df2e0a15622ef5c7bb。原 #1/#19、development-authority 与 r2 packet 的 diff/source.tar 字节和 SHA256 匹配；worktree clean。r1 报告未改，1706 字节及原 SHA256 保持。

r1 接管 P2 已修复：有效 output/forecast 取两套许可的较小值，Native 配置、预留、两套 prepared/final、图像/容量证明同步；非恢复接管仍用原上限。新增三个完整 Task 覆盖双向差异及图像有限预算。共享暂停转换保留原 failure/source/phase、次数与等待并唤醒 waiter。

1. P2，咨询恢复仍绕过恢复输出上限。#1 原文（body:154）：“预算、模型池与账号由用户控制，模型或学习策略不能自行提高上限、启用提供商或更改授权。”
   src/index.mjs:1537 优先取 boundedRequest.maxTokens，未与 recoveryPolicy.maxTokens 取较小值；:827 重试请求只更换 provider/model，:830、:912、:1641 随后按原咨询上限预留及证明。合法配置 recovery.maxTokens=64、coordination.maxTokens=128，已知连接失败且无部分内容、预算充足时，咨询重试仍获 128 的输出许可，src/client.js:223 的“恢复输出 token 上限”64不生效。现有咨询案例两者均128，新增 caps 仅覆盖接管。最小修复：冻结同时满足咨询与恢复许可的有效上限，同步实际 bounded request、requestHash、预留、prepared/final；保留原消息和一次咨询意图，补两方向完整 Task 案例。

其余已复核边界未确认新偏差。作者新日志为 579/579、T18 44/44；本复审未执行测试、Host 或 RPC。OAuth 仍仅本地 INVALID_GRANT 受控证据；真实 API、第二账号、安装及实际费用/质量保留为最终门槛，不另计本票开发阻塞。
