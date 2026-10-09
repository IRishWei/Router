# OpenCode Go 0.13.1 真实限定验收

日期：2026-10-09。固定源码 `0f8612f7345c7bbf23fcb78c14c2758f584db44a`，包SHA256 `D7FE4C7CEB4CB7CDFF8205A1B2CBD41E2403F4EF83478618298196442C57692D`。用户确认Use balance关闭并在DSH密码页面配置Go Key。用户回复已完成后，公开snapshot已有完成的原生检测；未运行另一次检测脚本。

结果：1 Task、2次真实调用（detection/session-title），返回 `OPENCODE_GO_CONNECTION_OK`。服务报告1458+207=1665token，任务耗时2979ms。预算32768token/60000ms，输出cap1024，无扩额/重试。真实模型标记inference verified；任务质量acceptance仍unconfirmed。实际账单与Go剩余额度未知。

## Standards

PASS，0 findings。两份proof与只读脚本一致；归档仅使用snapshot/modelCatalog，无追加推理。重启前后tasks/config/Go状态/原生默认一致。33安装文件身份及无fixture验证完成，166份旧记录与旧状态保持不变。公开归档无Key/token/cookie/私有日志，连通性未扩大为整体质量通过。

## Spec

PASS，0 findings。目标Desktop同账号完成固定Go文本连接检测；2次请求和预算边界满足#26，缓存和推理未重复计入总量。归档/重启未追加调用，历史/config/default/永久claim保持。实际工具往返仍依赖受控证据；不能证明通用质量、费用节省、套餐扣减或官方API/OAuth。

独立两轴只读复审未读取凭据或私有日志，未运行模型/测试。两个自有真实环境阶段现均已停止，凭据保留于独立DSH Host存储。owner的realModelRequests=0表示启动时状态，最终数量以proof/task的2次为准。
