Spec：FAIL。缺失/部分 0；越界 0；貌似实现但错误 1（P2）。

固定范围：547b8b188036a43f4f5627f4cb103598c0c9d3f0...2cc486add689e28cce549673b33fc8c96432db08。依据原始 #1/#19 与 development-authority；packet 的 diff、source.tar 和三份 authority 字节/SHA256 均匹配。未读 Standards 报告。

1. P2，接管恢复受两套输出上限互相否决。#19 原文：“执行、咨询或接管出错时有限恢复，必要时暂停，并保留任务结果与可追溯状态。”
   src/index.mjs:559 设置 recoveryPolicy.maxTokens，:566 又覆写为 takeoverPolicy.maxTokens；:724 的 prepared 证明和 :1622 的最终请求门仍要求 recoveryPolicy.maxTokens。因此合法配置 takeover=128、recovery=512，目标/完整上下文/预算均满足且首次连接失败无部分响应时，消耗恢复 grant 后会以 RECOVERY_PREPARED_MODEL_CHANGED 暂停，不能恢复。test/t18-harness.mjs:6 与 test/t18.integration.test.mjs:129 都取 128，现有成功接管案例掩盖此组合。最小修复：统一满足两套许可的有效输出上限，并同步预留、prepared 与最终接管/恢复审计；补不同上限的完整 Task 案例。

已检查 await 后复查、原生 normal/always 外层重试、跨阶段 grant、预算/未知用量、替代身份、完整历史/私有 replay、工具祖先和 RPC/UI，未确认其他偏差。作者日志显示 576/576 与 T18 41/41；本复审未运行测试。OAuth 是临时假凭据、本地 INVALID_GRANT 链路；真实 API、第二账号、安装和实际费用/质量仍属最终门槛，不另计为本票开发阻塞。旧日志早期路径复用不能证明所有初始失败原件不可变。
