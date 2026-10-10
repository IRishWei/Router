# T18 源码受控证据

授权来源为 #1 的 mainline implement-spec 与 #19，基线 T17 `547b8b188036a43f4f5627f4cb103598c0c9d3f0`。author worktree 为 `codex/t18-failure-recovery`。没有真实 provider 请求，没有读取实际 auth/key/profile，也没有 Desktop/RPC 进程、Computer Use、push 或 GH 写操作。最终安装、独立源码双轴复审、非作者合并和闭票由集成流程负责。

## 完整 Native Task seam

`test/t18-harness.mjs` 只替换外部模型 Adapter。Task、AgentLoop、Session、LLM、工具、输入/选择、query 与取消都使用目标 rc.2。测试从公开 SessionController.prompt 开始，通过真实 whenIdle/live Snapshot 观察精确 task/session/requestId；派发入口、失败 Call、原生 native WeakSet、预算、settlement 与工具 body count 共同验证，不 mock Task 内部。

| 文件 | 关键完整行为 |
| --- | --- |
| t18.integration.test.mjs | 同 Task/step 的 distinct Call 恢复、共享 phase 次数、可信 retry-after、authorization/quota/partial/unknown、咨询 one intent/one advice、接管 one notice、固定/非固定替代、真实 native title 对账、重复 operation 防重 |
| t18.controls.test.mjs | 真实 retry plugin 加载顺序/always 与外层忽略决定、人工 CAS、budget wait 的 disable/fixed/policy/human/pending/stop、prepared 独立 gate、最终 observation await、restart、敏感 failure DTO、两真实 Task 的 ambiguous late ancestry、真实 lifecycle plugin exception |
| t18.proof.test.mjs | 相异或 unknown 授权/计费拒绝、protocol/capacity/fixed 保护、真实原图附件与未知 image pricing 拒绝、真实 filesystem write fault、人工 retry-current 不转 alternative |
| t18.oauth.test.mjs | 真实 ChatGPT session/credential/refresh/adapter chain；临时 fake credential home + 本地 HTTP token endpoint 返回 INVALID_GRANT；1 refresh、0 responses、0 模型派发、终态 resolver 拒绝 |
| t18.client.test.mjs | 实际 rc.2 Renderer/Typert codec/严格 RPC 从关闭配置启用恢复、精确 live retry/stop、终态无 resume 按钮、新 Task 指引 |

OAuth 证据只认证本地受控刷新拒绝链路，通用 AUTH fixture 只认证分类。标题与恢复执行均逐 Call 对账；例如标题 1、原执行失败 1、恢复执行 1 = 3 Call / 36 fixture token。phase 共享案例原执行 4、咨询 2、目标 1 = 7 Call / 84 fixture token，目标首次失败后没有第 8 次请求；咨询仍一个 intent，接管仍一个 notice。副作用重复案例 body=1；ambiguous late child 红阶段 body=1，修复后 body=0。

非固定 alternative 案例先完成一个实际原模型 Task，再解除固定。新恢复 Task 通过会话真实 current/lastUsed 保持既定起点，原模型 2 次、alternative 1 次分别对账；不依赖随机 candidateId 排序。原准备 Task 不计入新 Task 的成本或调用数，但其完整对话保留。图像测试先经实际公开 Task 建立支持图像的 native header，随后保留原 attachment 与实际 byte；没有绕过宿主 admission。

## TDD 与原始记录

原始日志只新增到授权临时笔记目录 `implement-spec-go-20261009/t18-slice-*` 与 `t18-source-*`；不覆盖 Root review 命名或旧证据。开发逐条增加完整行为失败，最小实现，观察 green 后再继续。slice01–11 覆盖首次恢复、次数、retry-after、许可撤回、故障事实、工具语义、防重复副作用、替代完整输入、人工 CAS、咨询与接管。slice12–22 继续覆盖实际 OAuth refresh、聚合未知 usage、未知金额预算、live restart、prepared、Renderer/RPC、reasoning partial、ambiguous ancestry、人工 source-only、lifecycle exception 与 unknown account。

修正过的外部 fixture/断言也保留失败日志：slice11 初始清理错误不能作为行为 red，采用 `red-2`；slice15 初始清理遮蔽采用 `red-2`；slice17 的 codec helper 错误保留 `green-1/2`，以实际 `green-3` 为准。alternative 旧 source-coverage 排序失败、标题并发未证明预算的初始暂停、image admission/附件 API 断言纠正等原输出均保留。少数早期 author 重试复用了同名 author 日志路径，文件只有该路径的最后输出，更早输出仍在工具历史中；后续重试均使用独立后缀，旧票/Root 证据未覆盖。新增已被现有 gate 覆盖的控制案例直接标为 coverage pass，不伪造 red。各切片改动由工具 patch 历史及最终 source diff 固定，部分切片额外保存 red/green source diff。

最终源码检查：`node --test --test-concurrency=1 --test-timeout=30000 test/*.test.mjs` **576/576 PASS**（旧 535 + 新 41），`npm run build`、`npm run check`、`git diff --check` 均 PASS。原输出依次为 `t18-source-full-serial-4.log`、`t18-source-build-final-2.log`、`t18-source-check-final-2.log`、`t18-source-diff-check-1.log`；T18 单独完整覆盖为 `t18-source-native-all-5.log` **41/41 PASS**。旧 T15/T17 测试、冻结 VERIFY/artifacts 和 N/V 文件均未修改。T17 原失败标准继续在完整串行回归执行。固定提交后的独立复审与安装轴不属于这些 author 源码检查。

## 限制

这些成功与 token 数均来自预设本地模型和本地 transport，不证明真实模型重试效果、OAuth 官方账号有效性、真实 Go/API 权限、套餐剩余量或节省现金。声明的 portable protocol 只有完整保留/拒绝边界的受控证明；缺少当前真实 provider 的完整元数据时仍保守暂停。没有旧 Task 的公开恢复能力；重启只保留证据并明确停止。
