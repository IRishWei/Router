# T02 目标桌面与公开 RPC 验收

2026-10-07，集成 `51906ee` / 实现 `a6af4c6`，安装 `@irishwei/dsh-router@0.2.1`。宿主为 Windows DSH Desktop 0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`，Cordis 4.0.4、Node 24.18.1、Host protocol 4。

通过官方 `dsh plugin --profile desktop add` 更新独立验证 home；不更改正常 DSH profile 或 Codex 配置、认证。包 SHA256 为 `36C48C9D7A248C38EDD30A553B838ABD543165922C196C12FE2F82CE30169E15`，安装客户端与构建产物 SHA256 同为 `CC4F8A3A087772B45BDC93511999BAC61DF6AFE6FF688D159C7C8ABE981518B9`。

## 页面与迁移

真实桌面设置中三个分页正常显示，模型池列出两个 fixture 及已知、声明、未知能力；没有重新出现空白页。由 0.1.2 升级后保留 automatic=false、version=2、旧 `ROUTER_OK` 任务和真实 Call。桌面取消勾选 A 后 Host 保存 version=3，A 禁用、B 启用；路由页显示暂停、无固定模型及已生效版本 3。

后续鼠标操作被用户中止；用户要求停用 Computer Use 后，剩余验证全部通过命令行、宿主公开 HTTP RPC 完成。下表不声称进行了更多 GUI 点击。

## 安装宿主的实际任务

读取本次独立进程自身启动日志中的 localhost launch URL，在内存中通过官方 `GET /?token=…` 交换浏览器会话 cookie。按照 Connection 的 `client-request` / `server-response` 信封，调用 `/api/router/*` 与 `/api/session/*`。launch token、cookie 不写入证据、不打印；不读取认证文件。

任务经公开 `session/create` 与 `session/prompt` 准入，等待同一宿主 `router/snapshot` 的终态，并核对公开 `session/projections` 中的 lastUsed/next。没有直接调用模型适配器、手工渲染页面或调用自动 `selectModel`。

| 配置与任务 | 实际观察 |
| --- | --- |
| version=4；A 禁用、仅 B 启用；`RPC_AUTO_B` | Task `518420f4-c741-458d-9fbe-5ee5eb89be2e` 完成，唯一 Call 为 B/4，真实 header 与 lastUsed/next 均为 B。 |
| version=6；固定 B、A/B 均启用；`RPC_FIXED_B` | Task `3bdc15e7-7aee-4682-b6af-b1106de9fd73` 完成，唯一 Call 为 B/6，无自动跨模型替换。 |
| version=7；移除 B，仍固定 B；`SHOULD_NOT_SEND` | Task `673fa212-9c6f-4663-a3f6-d00c95a7851d` 暂停，FIXED_MODEL_UNAVAILABLE，零 Call、空结果，lastUsed/next 为空。 |
| version=9；重新加入 B、关闭自动路由，固定设置仍为 B；`RPC_PAUSED_NATIVE_A` | Task `ff128ba7-a547-4b80-acc0-4c20965dda26` 完成，合法原生 A/9 请求，lastUsed/next 为 A；暂停后仍可管理模型及设置。 |

三个完成 Call 的 dispatchState 均为 header-confirmed，真实请求快照与 Router 模型、版本一致，各自报告 fixture input=8、output=4、total=12。自动选择前后公开 modelCatalog.default 始终为 A，未写部署默认。验收 verdict 仍为 unconfirmed，fixture 响应不是业务效果通过的证据。

## 重启与自动化覆盖

所有任务终态且 snapshot 已 flush 后，只终止本次独立验证 home 的已核对 PID/executable，使用相同 home 通过 `Start-Process -WindowStyle Hidden` 重启。新进程重新交换会话并读取公开 RPC：automatic=false、fixed B、version=9、A/B 启用池全部相同；旧 T01 与四个新 Task 共五条记录保留，各 Call、结果及暂停原因相同；原生默认仍为 A、storageError=null。此处验证的是独立进程重启持久化，未声称正常 GUI 退出测试。

运行中待生效/已生效、流与工具稳定边界、派发前撤销、重试、零候选、未知图像能力、选择竞争、客户端挂载和生命周期已由真实 rc.2 Controller/AgentLoop/Renderer 的完整任务验证，见 [自动化证据](t02-host-evidence.md)。合并后 28/28 测试、check、diff 检查通过；独立复审见 [审查记录](t02-review.md)。

## 验收边界

T02 六项验收条件已有目标安装宿主和真实宿主模块证据。原生同路由重选可能残留 pending 的限制仍存在：冲突时明确暂停，公开选择不同有效目标后恢复；未改私有缓存或伪造 header。按共享契约，T12/T17/T18 必须继续尊重此所有权限制。这项宿主限制的自动消费没有通过，不能描述为已修复。

没有外部模型网络请求或真实费用；本票不认证 T05—T11 的接入能力，也不解除 T21/T23 的预算及效果许可门槛。父规格保持原状态。
