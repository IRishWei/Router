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
| t18.caps.test.mjs | 接管/恢复 max 128/512 两方向、forecast 16384/32768 两方向、原接管上限保留、两套 prepared/final 及精确预留一致、16500 token 预算与真实原图附件/字节 |
| t18.consultation-caps.test.mjs | 咨询/恢复 max 64/128 与 forecast4096/8192 两方向、4500 token有限预算、原咨询许可保留、owned prepared/final/hash/reservation 同步、一个 intent/一次 advice/全部实际 Call、复制 owned 请求拒绝 |
| t18.allocation-caps.test.mjs | 原 Native compatible1024 与恢复64/2048两方向、owned compatible咨询128/恢复64、logical2048但原实际 prepared1024、精确有效许可与完整 Task账本 |
| t18.terminal.test.mjs | 真实预算等待停止后的终态恢复归一、完整持久化 recovery/timeline重启保留、0新请求/工具、manual resolver stop 的实际RECOVERY_CANCELED |

OAuth 证据只认证本地受控刷新拒绝链路，通用 AUTH fixture 只认证分类。标题与恢复执行均逐 Call 对账；例如标题 1、原执行失败 1、恢复执行 1 = 3 Call / 36 fixture token。phase 共享案例原执行 4、咨询 2、目标 1 = 7 Call / 84 fixture token，目标首次失败后没有第 8 次请求；咨询仍一个 intent，接管仍一个 notice。副作用重复案例 body=1；ambiguous late child 红阶段 body=1，修复后 body=0。

非固定 alternative 案例先完成一个实际原模型 Task，再解除固定。新恢复 Task 通过会话真实 current/lastUsed 保持既定起点，原模型 2 次、alternative 1 次分别对账；不依赖随机 candidateId 排序。原准备 Task 不计入新 Task 的成本或调用数，但其完整对话保留。图像测试先经实际公开 Task 建立支持图像的 native header，随后保留原 attachment 与实际 byte；没有绕过宿主 admission。

## TDD 与原始记录

原始日志只新增到授权临时笔记目录 `implement-spec-go-20261009/t18-slice-*` 与 `t18-source-*`；不覆盖 Root review 命名或旧证据。开发逐条增加完整行为失败，最小实现，观察 green 后再继续。slice01–11 覆盖首次恢复、次数、retry-after、许可撤回、故障事实、工具语义、防重复副作用、替代完整输入、人工 CAS、咨询与接管。slice12–22 继续覆盖实际 OAuth refresh、聚合未知 usage、未知金额预算、live restart、prepared、Renderer/RPC、reasoning partial、ambiguous ancestry、人工 source-only、lifecycle exception 与 unknown account。

修正过的外部 fixture/断言也保留失败日志：slice11 初始清理错误不能作为行为 red，采用 `red-2`；slice15 初始清理遮蔽采用 `red-2`；slice17 的 codec helper 错误保留 `green-1/2`，以实际 `green-3` 为准。alternative 旧 source-coverage 排序失败、标题并发未证明预算的初始暂停、image admission/附件 API 断言纠正等原输出均保留。少数早期 author 重试复用了同名 author 日志路径，文件只有该路径的最后输出，更早输出仍在工具历史中；后续重试均使用独立后缀，旧票/Root 证据未覆盖。新增已被现有 gate 覆盖的控制案例直接标为 coverage pass，不伪造 red。各切片改动由工具 patch 历史及最终 source diff 固定，部分切片额外保存 red/green source diff。

首轮固定源码检查：`node --test --test-concurrency=1 --test-timeout=30000 test/*.test.mjs` **576/576 PASS**（旧 535 + 新 41），`npm run build`、`npm run check`、`git diff --check` 均 PASS。原输出依次为 `t18-source-full-serial-4.log`、`t18-source-build-final-2.log`、`t18-source-check-final-2.log`、`t18-source-diff-check-1.log`；T18 单独完整覆盖为 `t18-source-native-all-5.log` **41/41 PASS**。旧 T15/T17 测试、冻结 VERIFY/artifacts 和 N/V 文件均未修改。T17 原失败标准继续在完整串行回归执行。固定提交后的独立复审与安装轴不属于这些 author 源码检查。

## r1 固定提交复审修复

独立 Spec 复审针对 `2cc486add689e28cce549673b33fc8c96432db08` 确认 P2：接管输出上限会覆盖恢复请求配置，prepared/final 恢复门却仍按 recovery policy 的另一个上限拒绝。新增三个完整 Native Task 案例逐条 red → green；仅替换外部 Adapter，RPC shape 与 0.17.0 版本保持不变。规划、实际请求分配、两套 prepared/final gate 和完整输入/图像/预算使用同一有效 max/forecast；原非恢复接管保持原 policy。每个成功案例当前 Task 为 6 Call / 72 fixture token，接管只消费一个原 plan，恢复只消费一个 grant。

所有本轮日志和红阶段测试副本、逐片源码 diff 都新增到同一授权笔记目录的 `t18-r1-fix-*` 路径，写入前检查文件不存在；没有覆盖任何原始记录。

| 切片 | 有意义的 red 与随后 green | 原始日志 |
| --- | --- | --- |
| 01：takeover128 / recovery512 | 原代码 1/1 失败、仅一次目标入口，reason=RECOVERY_PREPARED_MODEL_CHANGED；green 1/1，原接管与恢复实际 max 均128，两套 prepared/final 和 reservation 输出均128 | slice01-red-1、red-2、green-2 |
| 02：takeover512 / recovery128；takeover forecast32768 / recovery16384 | 先修01后仍 1/2 失败，第二方向实际 prepared 被512覆盖；green 2/2，原接管512/32768，恢复128/16384，两套最终证明和 plan.forecast 同步 | slice02-red-1、green-1 |
| 03：takeover forecast16384 / recovery32768；原图与16500 token预算 | 2/3 通过，新增案例错误预留32768进入 waiting-budget、目标只有首次入口；green 3/3，无预算等待，实际图像视觉预留64、附件和字节保留，有效128/16384 | slice03-red-1、green-1 |

上述文件统一前缀为 `t18-r1-fix-`、日志后缀 `.log`；例如 `t18-r1-fix-slice03-green-1.log`。slice01 的 `green-1` 保留一份断言修正记录：Task 已恢复成功，但测试误读取仅辅助 Call 才有的 snapshot 字段；改为观察实际 Native Request 与两套已保存 prepared/final 证明后，`green-2` 为通过版本。行为 red 在此断言之前已稳定复现。

Standards 的非阻断重复暂停转换在此复审修复阶段合并。真实 ambiguous late child 的人工等待暂停，以及独立 prepared 拒绝测试，增加了原 failure/source/phase/id、次数、等待、完整历史证明与账本保留断言；重构前15/15、重构后连同 cap 案例18/18。公共工具保护和内部故障暂停使用同一 transition，并统一唤醒 waiter。原始输出为 `t18-r1-fix-pause-before-1.log` 和 `t18-r1-fix-pause-after-1.log`；这属于已有行为的重构验证，没有伪造功能 red。

本轮最终实际验证如下。duration 为命令外围 Stopwatch 实际耗时，原日志也保留 Node test runner 自报 duration；所有命令 exit=0。

| 检查 | 结果与 duration | 原始输出 |
| --- | --- | --- |
| 完整 serial test / concurrency1 / timeout30000 | 579/579 PASS（旧535 + T18原41 + 新3），85.475s；runner85.4017029s | t18-r1-fix-full-serial-1.log |
| T18 全部完整测试 | 44/44 PASS，9.783s；runner9.7100569s | t18-r1-fix-native-all-1.log |
| npm run build | 0.17.0 PASS，1.009s | t18-r1-fix-build-1.log |
| npm run check | PASS，2.631s | t18-r1-fix-check-1.log |
| git diff --check | PASS，0.103s | t18-r1-fix-diff-check-1.log |

本轮仍未打包、安装、启动 Desktop 或执行真实模型请求；独立 r2 源码复审和随后安装验证需绑定新固定提交。

## r2 固定提交复审修复

独立 Spec 复审针对 `33116cd196c29c59324466df2e0a15622ef5c7bb` 确认 P2：咨询恢复沿用原 logical request max，未遵守较小的 recovery 上限。先加入 recovery64/consultation128、forecast4096/8192 的完整 Task red，再冻结有效 max 和 owned logical request/hash，green 后才加入反向配置。反向以4500 token有限预算观察原错误8192预留造成 waiting-budget，修复后预留4096、完整 Task完成。原首次咨询分别128和64；两方向恢复均64/4096，1个意图、1次advice、2个咨询实际Call，完整 Task均5 Call/60 fixture token。

随后逐条审查 allocation：compatible Native 的1024预设会覆盖恢复64，实际 prepared门拒绝；反向 recovery2048则可扩大原1024许可；compatible owned请求也会把咨询128/恢复64改为1024。新增完整 Task逐片 red→green，原 Native首发1024保留，恢复受原实际Native/owned prepared上限及全部phase/recovery许可共同限制。咨询 logical2048但实际prepared1024的额外切片先被拒绝，修复后正确冻结1024，完整输入证明、requestHash、实际请求与预算一致。四个allocation案例分别2 Call/24、5 Call/60、2 Call/24、5 Call/60 fixture token。

原 stopped budget-wait 只断言 Task暂停；新的完整终态/只读重启 red观察到 before recovery=call-reserved/reason=null，after被改成RECOVERY_RESTARTED_UNKNOWN。Native turn/end现在关闭未结束恢复，实际 before/after均paused/RECOVERY_STOPPED，原调用、次数、完整proof和timeline保留，重启0模型请求/0工具。manual resolver stop已有取消链路保持paused/RECOVERY_CANCELED、1 Call/12 fixture token；这条为已有行为coverage，不伪造red。

所有本轮原输出、red测试副本和逐片green源码diff使用全新的 `t18-r2-fix-*` 文件名，以FileMode.CreateNew拒绝覆盖。原r1/r2审查、旧证据和冻结包没有修改。

| 完整切片 | red → green 原输出（统一 t18-r2-fix- 前缀、.log 后缀） |
| --- | --- |
| recovery64/consult128及较小recovery forecast | slice01-red-1 → slice01-green-1 |
| recovery128/consult64及较小consultation forecast，4500 token预算 | slice02-red-1 → slice02-green-1 |
| 原Native compatible1024/恢复64 | allocation-native-red-1 → allocation-native-green-2 |
| recovery2048不得扩大原Native1024 | allocation-source-red-1 → allocation-source-green-1 |
| owned compatible首发咨询128/恢复64 | allocation-owned-red-1 → allocation-owned-green-1 |
| logical两套2048/原实际prepared1024 | allocation-owned-source-red-1 → allocation-owned-source-green-1 |
| budget stop终态及读取历史 | terminal-budget-red-1 → terminal-budget-green-2 |

复制owned options的公开LLM重入案例由既有gate拒绝：原咨询失败保持CONNECTION，恢复Call不派发、预留released，3个实际入口/36 fixture token，无advice；原输出为owned-identity-coverage-1（3/3）。独立request-hash-coverage-1保留一次fixture假设失败：尝试修改已由SDK冻结的nested messages，先抛TypeError成为AUXILIARY_CALL_FAILED，未到final hash门，不能冒称验证该门；这条无效用例已移除。两方向cap成功案例经过原独立final hash门，证明新的有效max已绑定到保存的logical hash。allocation-native-green-1保留一次断言纠正：Adapter收到SDK投影，不能用Adapter副本证明native WeakSet，改为观察原公开llm/stream原始request和已保存final native证明。terminal-budget-green-1保留JSON落盘省略undefined字段的断言纠正，green-2直接与实际持久化记录比较。均未覆盖原失败输出，也未用这些fixture错误代替行为red。

本轮新增9个完整行为案例：咨询cap2、owned复制拒绝1、allocation4、terminal2。最终原输出如下，duration为外围Stopwatch；所有命令exit=0。

| 检查 | 结果与duration | fresh原输出 |
| --- | --- | --- |
| 全部serial test / concurrency1 / timeout30000 | 588/588 PASS（旧535 + T18 53），85.605s；runner85.5150257s | t18-r2-fix-full-serial-1.log |
| T18全部完整测试 | 53/53 PASS，13.029s；runner12.927613s | t18-r2-fix-native-all-1.log |
| npm run build | 0.17.0 PASS，0.462s | t18-r2-fix-build-1.log |
| npm run check | PASS，2.147s | t18-r2-fix-check-1.log |
| git diff --check | PASS，0.116s | t18-r2-fix-diff-check-1.log |

本轮未打包、安装、启动Desktop/RPC或执行真实模型请求；独立r3源码双轴和后续集成验证须绑定新固定提交。

## 限制

这些成功与 token 数均来自预设本地模型和本地 transport，不证明真实模型重试效果、OAuth 官方账号有效性、真实 Go/API 权限、套餐剩余量或节省现金。声明的 portable protocol 只有完整保留/拒绝边界的受控证明；缺少当前真实 provider 的完整元数据时仍保守暂停。没有旧 Task 的公开恢复能力；重启只保留证据并明确停止。
