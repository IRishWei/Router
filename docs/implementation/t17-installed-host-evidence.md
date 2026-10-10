# T17 受控安装证据

[T17/#18](https://github.com/IRishWei/Router/issues/18) 的稳定边界接管与完整上下文交接已完成源码及受控目标 Desktop 工程验收。源码、安装证据的独立 Standards / Spec 复审均 PASS，当前发现 0 项。本轮 DSH 生产模型请求为 **0**；响应来自本地预设 Adapter。

## 固定源码、包与检查

源码固定为 `82d67da51b0dbc7faf6502d6d764f63d3c4c9eee`，相对集成基线 `3a8d9891fd11e1b4e2fd4621a32ad5204996d963` 包含三个提交：`6e1b6ca`、`e26ac7e`、`82d67da`。完整合同见 [takeover contract](t17-takeover-contract.md)，源码 TDD、失败及修复见 [source evidence](t17-takeover-source-evidence.md)。旧固定提交的失败报告与收据保留，不冒充最终通过证据。

最终源码完整 serial 回归 **535/535 PASS，68.479s**；非作者 merger 独立回归 **535/535 PASS，100.7074199s**。build、check、全部差异检查均通过。Merger 最初的 PowerShell executable 解析失败及完成所有检查后的摘要解析失败另行保留，后者只修正结果读取，没有重跑检查。

最终包 `artifacts/irishwei-dsh-router-0.16.0.tgz` 只打包一次，233897 bytes、37 files，SHA256：

`64A7CFA962C08760D8C0C3235FCAB662CA449DD54C98B10796114728CC5C04FA`

官方 bundled CLI 离线安装到新的隔离 DSH_HOME，exit code 0。实际安装的全部 37 文件及完整文件集与已审包逐字节一致；不导入真实账号、凭据或旧 profile。控制与重启阶段的实际 RPC/Renderer、fixture、启动前依赖副本均绑定 hash。启动前清单的 `actualDesktopExecuted:false` 原样保留，另由执行与停止回执证明实际运行。

## 完整 Native Task 与账本

最终 e label 为 `t17-v0160e`：**10 个场景、12 个 Task、60 个 Call、59 次本地 stream、472 个预设 token**。两个额外 Task 是显式图像 setup；1 个 Call 在派发前释放。每次实际 stream 的用量是夹具声明的 8 token，全部标题、咨询和执行调用均匹配原 Task 账本，不能推断真实费用或套餐扣减。

实际 rc.2 Host/AgentLoop、Session/SessionController、ModelSelection、公开异步 SessionQuery、Tools registry、附件服务及 Router RPC 参与运行，仅外部模型响应使用本地 fixture。共 69 次 native seam 观察；目标请求保留原 Native Request 身份及原 Task/session/turn，完整 system、messages、tools、toolHistory 和最终 DTO 逐项重算一致。原 prompt、用户约束、4→9→14 的 source 产物、咨询及已完成工具记录未压缩或丢弃。目标预设 24 字符产物重新通过验收，同 Task 接管仅一次。

| 场景 | 实际受控结果 |
| --- | --- |
| 文本 | 同 Task 接管、完整输入与约束保留，目标产物重新验收通过 |
| 图像 | 原图片引用及 SHA/bytes 保留，公开 readImage 实际读取，完整模态交接通过 |
| 工具 | 全部原生 schema、call ID、result 与 history 保留，新 ID 重复读取允许 |
| 重复副作用 | 同声明 operation 的写操作只执行一次，重复目标操作拒绝并暂停 |
| 手动固定未授予跨模型接管 | `FIXED_MODEL_TAKEOVER_NOT_AUTHORIZED`，目标请求 0 |
| 小容量目标 | `TAKEOVER_CONTEXT_CAPACITY_EXCEEDED`，目标请求 0 |
| 未知交接协议 | `TAKEOVER_PROTOCOL_UNKNOWN`，目标请求 0 |
| 不支持的工具协议 | `TAKEOVER_TOOL_PROTOCOL_UNSUPPORTED`，目标请求 0 |
| 文本目标接收图像 | `TAKEOVER_IMAGE_CAPABILITY_UNSUPPORTED`，目标请求 0 |
| 预算等待中撤销目标 | 真实等待状态下仅禁用目标，`MODEL_DISABLED`，未派发预留释放，目标请求 0 |

实际 Tools body 共运行三次：两个合法 read、一个 write。防重依据真实定义的 operation/idempotency 声明，不把工具名和参数相同当作副作用证明。原生 scoped `subagent` schema 与两个继承夹具 schema 一同保留；没有从交接输入隐藏第三份 schema。

选择计划与实际执行 owner 分开核对，拒绝切换不伪造目标执行确认。Owner 合同仍限于 Task 起点启用接管的任务，disabled/legacy 的空 owner 不构成后续通用状态展示已完成。最终 DTO hash 是 Router 的 JSON 输入证据，不宣称等于 provider wire bytes。

## Renderer、重启与历史

加载真实已安装且 hash 匹配的 client，使用 rc.2 Cordis、SlotRenderer、React、Typert 与 live public RPC，验证全部 12 个任务记录和 10 行接管计划/实际 owner。产物、图像证据、原因、五元身份及置信度逐项核对；挂载前后 snapshot 相同，错误和诊断均为 0。该检查不是截图或视觉外观验收。

恢复业务配置、原生 default 并撤出夹具模型池后进行只读重启。新增 stream **0**，全部历史 Task/Call/ledger、配置、captures 和完整 counter 保持。两阶段只停止本次拥有的 PID/startTime/executable 及捕获的子进程，停止回执通过。

e 使用启动前已声明的 `t17-current-registry-refresh-v1` 判据：持久 state 的全部 non-connections 字段序列化字节相同；14 个原夹具候选仅 authEpoch/configRevision 各 +2、registry revision +28，以及明确的 observation/tombstone 时间刷新，其余身份、状态、能力与 handoff 字段全部相同。当前注册表发现过程的代际刷新不改写历史任务身份，也不证明永久授权连续性。

原始 sealed state 与重启后的 state 均为 1403939 bytes，hash 分别为：

- 原始：`3878FFC41DE78CC27C21369928F7A7E3BB788B0CAFB2449AC718C5726D8655C6`
- 重启后：`1B19C5CA44A97D267353BCD1DB7BBA2188CE1AFF433185B2AB95E45B3DC838BB`

因此 `rawRouterStateBytesUnchanged:false` 如实保留，不声称整个 state 文件相同。独立 [scope review](../../VERIFY/t17-installed-restart-scope-review.md) 与补充 4 在 e 启动前复制并绑定。

## 保留的失败与后处理修复

- a：完整 native 输入大于预留容量，产品正确拒绝派发目标；1 Task/5 本地 streams。补充 1 改为公开 pre-input 工具限制并核对当前产物，原失败保留。
- b：辅助断言错误预期恰好两个 schema；native 记录前抛错，0 streams。后续先保存完整 native 观察，不将辅助错误当产品失败。
- c：两个继承工具之外存在真实 scoped `subagent`，原三份 schema 均已记录，0 streams。补充 3 修正完整 schema 集判据，未删除该原生工具。
- d：全部场景、Renderer、公开只读重启通过，但原“整个 state 字节相同”判据失败；96 项冻结文件及 FAIL 不改。发现仅当前连接注册表刷新后，独立评估、补充 4 及新 e 判据均先于 e 启动。
- e：场景与重启完成后，原后处理 validator 误按 RPC 嵌套 identity 读取持久 candidate 的 flat 五元字段。原 TypeError 与脚本保留；另存 repair validator 和实际 freezer，仅修正字段读取。14/+2/+28、完整历史/counter 字节及其他字段判据不变；没有新增 Desktop、RPC 或 stream。

每次调整保持同一已审源码和包，未掩盖旧失败。此前冻结文件、T15、Go/兼容包及原历史 state 也保全。

## 归档与结论范围

独立审查实际核验当前 e 的 276 项及 a/b/c/d 的 37/42/44/96 项，共 **495 项**，SHA/bytes mismatch 0。原 `validation-complete-pending-independent-final-review` phase 不改；最终复审另列 [archive index](../../VERIFY/t17-final-review-archive.json)。仓库归档 49 份原始字节副本及该独立 index，共 50 文件，包含完整公开 proof、实际执行脚本、包身份、重启范围、全部失败清单和四份最终审查报告。原始捕获仍在 `C:/Users/a1500/AppData/Local/Temp/router-implementation`，私有日志正文、bootstrap URL 和凭据未导出。

本票认证受控完整上下文、同 Task 接管、能力/预算拒绝、工具防重、账本、安装与历史保持。预设回答不认证真实 Go 接管、官方 API、第二账号、模型/视觉质量、实际账单或路由收益。#6/#7/#11、#22 与最终交付 #25 的真实门槛保留；用户批准的 Go 开发顺序继续生效。
