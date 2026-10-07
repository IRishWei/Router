# T16 目标 Desktop 安装验收

2026-10-07，Router 0.9.1 与 controlled companion 0.4.3 在独立 DSH home 完成 `v091c` 的 17 项实际验证、已安装客户端的 Renderer 验证、重启、移除夹具和再次重启。实际安装验收及最终独立 Standards/Spec 证据审查均 PASS，#17 已具备关闭资格。

## 固定代码与包

生产代码提交 `bae8af6e3b8b232bf3445b6d6d003361727003f2`，作者最终文档提交 `42a7620d5803069b1306207b14b48f0e4873a7fc`，非作者合并提交 `8f216a97f60367e85d8882c3fec078562a9f9405`。集成验证记录提交 `4fe76435ed1474179240b7017485ef7058933ac4` 与 `8635b6341c4622a5a3f0acfc3e20e4431a7a3445` 保留原失败及复验结果。

| 对象 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Router 0.9.1 | 160169 | `1D3E99B28B142A45E629C3F371C17C5E2CED53D8D6E58983FB33BE0103BBB575` |
| companion 0.4.3 | 5613 | `4288C6E3E6B1A6EB264A973F2DBB6E32ED34FD0014B3FB113D64ADF2F63BA656` |

Router 的全部 24 个安装文件与固定包逐字节相同，其中 20 个 lib 与已审作者构建逐字节相同、与 ROOT 构建按 LF/CRLF 规范化后相同。Companion 精确五文件亦与已审包逐字节相同。复制由非作者使用排他创建完成；旧包没有覆盖或重新打包。

Core 与冻结包先通过两轴独立审查。集成并发全量曾出现既有 T05 deadline 计时失败及 T16 Windows `ENOTEMPTY` 清理失败（285/287），原报告保留；独立 T05 9/9、T16 12/12 和串行完整 287/287 复验均通过。check/build 通过。Companion 0.4.3 的作者及独立两轴源码、解包回归各 6/6。

## 实际执行

使用官方 CLI 安装、公开 PluginManager 启用和移除。每次重启前核对所属 PID、精确启动时间、exe 与独立 home；没有停止其他用户进程。执行使用公开 SessionController/RPC 和真实 AgentLoop、共享 Router Host、唯一 AcceptanceCoordinator；没有 Computer Use 或付费 API 调用。

| 案例组 | 数量 | 实际证明 |
| --- | ---: | --- |
| 协调关闭、自动路由关闭 | 2 | 零 consultation Call，coordination 为 null。 |
| 自修、相关新证据、咨询、继续、验收 | 1 | 同 Task/turn 的真实正文与 canonical 测量 4→9→14；一次自修、一次咨询，建议不直接改验收，最终 episode resolved。 |
| 相关证据未变化 | 1 | 两次执行仍为 4；零咨询，没有因新 artifact ID 重置次数。 |
| 跨模型许可、固定许可、输入预留、容量拒绝 | 4 | 精确拒绝原因、零咨询 Call；容量负例使用已声明 512 context 的候选，保留九字产物。 |
| 限流、连接、传输、认证失败 | 4 | consultation 为 error，保留九字、失败验收和主执行身份；实际 failureCode 分别为 RATE_LIMIT、CONNECTION、TRANSPORT、AUTH。 |
| 预算 extend、stop、revoke | 3 | 咨询为唯一 waiting Call；扩展同 Task/turn/Call 后继续至 14，停止或撤销则零派发、released/not-dispatched，保留九字和精确暂停原因。 |
| 真实人类 steer | 1 | 原咨询零派发并释放，stale/HUMAN_INPUT_PENDING，无建议；同 Task 接纳第二条人类输入，原 10–20 与补充 1–20 同时保留，四字分别 failed/passed，整体正确为 failed。 |
| 运行中关闭全局协调策略 | 1 | 旧 Task 冻结策略仍 enabled，预算扩展后完成咨询与 14 字验收；修改仅影响后续 Task。 |

预算等待案例使用 64 token：两个主执行及可能的原生 session-title 辅助 Call 的已知消耗为 20 或 30，均已完成且小于 64；咨询完整输入与输出预留大于 64。断言 waiting.callId、唯一 waiting Call、tokens blockedBy、reservation waiting、零派发及九字验收，避免把标题或第二次主执行误当咨询等待。

所有实际 fixture Call 的完整 selection/candidate snapshot、派发状态和 input/output/cache-read/cache-write/reasoning/total usage 均经断言，固定报告用量为 6/4/0/0/0/10。账本按所有已派发 Call（含标题）逐项核对；价格缺失保留 `PRICE_UNKNOWN`、amount=null、billing unconfirmed，未推导零费用。这些本地固定响应只证明协议与协调逻辑，不认证专家建议质量或真实账号资格。

## Renderer 与恢复

加载已经安装且与包 hash 一致的 `client.js`，使用真实 rc.2 Cordis、Renderer、Typert registry/gateway 和 slots，carrier 仅调用 live `router/snapshot`。默认协调及两项许可关闭、空候选均经断言。17 个真实新 Task 分别定位自身历史条目，核对各自 lifecycle、验收、最终产物、自修/咨询次数、episode 和咨询失败原因；挂载前后 Tasks/config/DeepSeek metadata 深比较不变。

DOM mount 使用 `react-test-renderer`，没有截图或视觉外观验收声明。记录保留已安装客户端 hash、实际 harness hash、集成 SHA 和各 Task 条目文本 hash。

`v091c` 从完整 142 条历史、config revision 377 开始，追加 17 个唯一 Task，最终 159 条。finally 恢复全部配置值，revision 合法递增至 434，storageError=null。带夹具重启后，159 条完整 Task/Call/ledger、全部配置、DeepSeek 凭据元数据和原生默认深比较相同；公开移除夹具、再次重启后重复同样比较，fixture 不再可用。最初 123 条历史在 0.8.1→0.9.1 升级时亦逐字段保留，旧 Task 未补写 coordination 字段。

## 保留的失败与修正

`v091` 在第 3 个 Task 遇到 companion 0.4.2 协议遗漏：生产 character-length requirement 固定有 `literal:null`，夹具误以六键拒绝真实七键结构，导致 UNKNOWN/null usage。单变量回归 RED→GREEN 后，0.4.3 只接受精确七键且 literal 严格为 null；六键、非 null、缺省和额外字段仍拒绝。该轮 2 个已验证案例及失败 Task 全保留，恢复并移除/重启后总数 126。

`v091b` 前 15 项完成，第 16 项的验证脚本误把补充要求视为删除旧要求，错误期待四字通过。生产实际正确保留两项约束；该轮 `completed:false`、完整失败 Task 和公开事件保持原样，恢复并移除/重启后总数 142。`v091c` 修正并强化断言：完整 origin/requestId、coverage ID 集、两条唯一 evidence、两个 superseded history、单 episode/consultation、三个 advice 字段为 null；独立真实数据重放与新完整 17 项均通过，没有修改生产验收要求。

原 35 项保护清单及两轮各 20 项失败证据清单全部核对，捕获日志的前缀以排他创建的密封副本保留、原日志只允许追加。两轮 manifest 大小与 SHA 固定，20 文件及两个前缀动态计算后断言。所有旧失败日志、包、脚本和验收记录未改写。

## 证据与后续边界

独立验证根目录为 `C:/Users/a1500/AppData/Local/Temp/router-implementation`。最终关键证据：

- `t16-v091c-before-upgrade.json`、`t16-v091c-installed-hashes.json`
- `t16-v091c-bundle-enable.json`、`t16-v091c-execution-evidence.json`、`t16-v091c-restored-state.json`
- `t16-v091c-renderer-evidence.json`、`t16-v091c-restart-evidence.json`
- `t16-v091c-bundle-remove.json`、`t16-v091c-companion-removed-evidence.json`
- `t16-v091c-{standards,spec}-preinstall-review.md`、`t16-v091c-renderer-wait-{standards,spec}-delta.md`
- 最终独立审查原文已排他复制至仓库 `VERIFY/t16-v091c-standards-installed-final.md`（SHA-256 `6190198031112AB341EA061FD2BF5AA8B7D3E6A07AB93EF034FBC528C33824E5`）与 `VERIFY/t16-v091c-spec-installed-final.md`（SHA-256 `FD8B127375BDEA90ADA776EC95B76293BD5E6590A665FA4936B40A7BF6C63EE3`），两轴均 PASS，无阻断 finding。
- `t16-v091{,b}-partial-evidence.json`、对应 failed-run restart 记录及固定保护 manifest

DNS、代理、hosts、路由器和 Codex 配置/认证保持原样。T14/#15 的来源读取阻塞仍未解除，不能借 T16 通过认定 T14 已完成。Research/model-review 继续 fail-closed，直到上游发布可信失败谓词。T05/T06 的真实凭据及付费授权问题仍未获答复，原生 36 条依赖关系不变。
