# T15 目标 Desktop 图像验收

2026-10-10（上海），Router **0.15.0** 的源码、完整回归、官方 CLI 离线安装、公开 Desktop RPC、已安装 Renderer 和只读重启均有实际证据。本票按用户批准的 Go 开发主线验证工程行为；最终交付的官方 API、第二账号及真实效果门槛保持。

## 固定源码与包

- 源码候选与非作者 ff-only 集成提交：`2219efb7211bd4965777d919374bac10767bcee0`。
- 基线：`216b49684a80d2350b730549f8c8402fe77ea0ed`。源码 Standards / Spec 均 PASS、0 遗留 finding；唯一 P3 跨域证据标签已改为 `acceptance-contributor-validation`。
- T15 完整 Task 测试 **39/39**；集成完整串行回归 **473/473**，失败、取消、跳过均 0；build/check/diff-check PASS。
- 冻结包 `irishwei-dsh-router-0.15.0.tgz`：**219760 bytes**，SHA-256 **`1DFA02BBA32F7C937139A00ABA3400CC88D3B94292B76D83AEF4206270F4FD24`**。36 个安装文件与包逐字节匹配；三轮沿用同一个包，没有重打包或覆盖。

## 实际 Desktop 路径

官方 CLI `plugin --profile desktop add ... --offline` 安装 Router 与本地预定 Adapter。隔离 profile 没有导入 Go/官方 API/OAuth 凭据。公开 SessionController 使用其实际 Typert 参数契约；真实 AgentLoop、Router Host 与唯一 AcceptanceCoordinator 执行任务。

最终 `t15-v0150c` 有 **13 个图像 Task + 13 个显式准备 Task = 26 Tasks**、**44 次本地 Adapter stream**。准备 Task 为 rc.2 会话建立支持图像的 request header，不调用 `selectModel`；它们的执行和标题 Calls 单独保留，不混入图像拒绝的零调用统计。

每次实际 stream 的 provider 都为 `router-t15-controlled-fixture`，实际请求数等于全部 Task Call 数。夹具每次报告 input/output 4/4、total 8，因此完整账本为 **352 个夹具 token**。价格与实际费用缺项保持未知；该预定用量不能推广为生产模型计费。

| 场景 | 实际结论 |
| --- | --- |
| 有限识别、定位、解释三项参考答案 | passed；零评审。参考答案为用户声明，不扩张为整体视觉质量。 |
| 确定性错误答案 | failed；所选评审不能覆盖已知失败，零评审。 |
| 人物身份歧义 | unconfirmed；不把开放式推测当事实。 |
| 普通多模态评审 | 一次同 Task 评审，携带实际图像与匿名产物/要求绑定，passed。 |
| 高风险冲突、错误图像 hash | 各两次评审后 unconfirmed；无额外复核。 |
| 普通与图像共享额度 | 两次普通评审后零图像评审；canonical answer-match 精确记录 `REVIEW_ATTEMPT_LIMIT`、unconfirmed 和已占额度的 Call IDs。 |
| 文本评审候选、缺少视觉估算、格式拒绝、容量不足 | 主执行产物保留；评审派发前拒绝，零 review Calls/实际图像评审请求。 |
| 图像能力未知池、文本候选池 | 图像 Task 明确暂停，零 Call/实际 stream；显式准备 Task 已单列。 |

测试资产为本地 32×16 PNG（158 bytes），hash `a5258c1d2fc60c919c9f1f539034ba6086a5dcee0d5f79c9ce7c20dd0bed038b`。本次公开 RPC 实际 admitted ref 的媒体类型为 `image/png`、hash 与资产相同。验证比较原生实际 ref/hash、message/request origin 和 Adapter 通过公开 `readImage` 取得的实际字节；不假设不同上传途径一定保留同一种编码。

夹具声明每个图像 occurrence 64 visual tokens，评审输出 512、总预留 16384；完整 Task 限额 65536 token/30000ms。此视觉估算只是提供方声明，不能称为真实视觉成本硬上界。

## Renderer、重启与保全

加载已安装且 hash 匹配的 `client.js`，使用 rc.2 Cordis、slots、Renderer 和 Typert codec，carrier 只读取 live `router/snapshot`。逐行核对实际最近 20 个 Task 的 ID、产物、结论及图像问题/media/hash/规范证据原因；挂载前后 snapshot 完全一致。现有页面只显示最近 20 条，最早 6 个 Task 不在窗口内，未声称它们在本轮安装 Renderer 中可见；没有截图或视觉外观验收。

恢复全部配置值及原生 default、从模型池撤出全部夹具候选后只读重启。全部 **26 个完整 Task/Call/ledger、config、counter、原生 default** 深比较相同，新增 stream **0**。两个阶段只停止本次拥有的 PID/startTime/executable 及捕获的子进程；成功退出回执与外壳 exit code 均通过，未停止其他用户进程。

166 份原冻结文件、39 份 T07 冻结文件、Go/兼容冻结包和原 9114595-byte 历史 state 保全。T15 的 a/b/c 捕获证据分别 12/19/28，共 **59** 份也逐字节核对。c 的 pre-restart live state 在重开前已排他 seal，并通过明确 plan 绑定原 manifest 条目；最终 live state 与 sealed bytes 也相同。未覆盖旧失败记录或 manifest。

## 保留的验收脚本失败

- a：create 参数少了 `request` 包装，被公开网关拒绝；0 Tasks/0 streams。修正 create 与两个 prompt 的 wire 形状，独立增量复审 PASS。
- b：14 Tasks/28 streams 后，脚本误在原始 image contribution 查共享限额原因；真实 canonical evidence 已正确阻止第三次评审。改为按图像 requirement ID 严格检查 canonical reason/verdict/Call IDs，独立增量复审 PASS。
- c：完整 RPC 已通过；旧 Renderer 草稿错误期待早期案例越过最近 20 条窗口显示。改为逐行检查实际可见记录，并在只读重启补验；独立增量复审和实际执行通过，没有重新跑 Task。

三轮共 72 次预定本地 stream；**DSH 生产模型请求始终 0**。失败反映验收脚本问题，产品源码和冻结包未改。

## 证据与范围

公开摘要、逐场景 proof、安装包身份、Renderer/restart、保全与冻结清单位于 `VERIFY/t15-v0150c-*`。原始完整 RPC、场景、counter、运行脚本和失败捕获保存在独立验证目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation`；validation manifest 固定其长度与 hash。

本票只认证有限明确图像要求、证据绑定、原 Task 的预算/评审/账本及当前受控 Desktop 兼容路径。预定响应不认证生产视觉准确性、实际账单、额度或路由收益；Go、自定义兼容及 ChatGPT 生产适配器当前仍为 text-only。最终交付 #25 的官方 API/第二账号门槛及 #22 的真实效果验证保持。

最终非作者 Standards / Spec 证据复审均 **PASS、0 finding**，结论限于上述工程范围；报告逐字节归档在 `VERIFY/t15-v0150c-installed-standards-final.md` 和 `VERIFY/t15-v0150c-installed-spec-final.md`。两路独立核对固定包及最终 59 项清单。Standards 未访问 12 份历史私有日志，沿用 root 的既有 hash 保全回执；其余允许读取的历史证据独立核对通过。复审没有重跑 Desktop、RPC 或模型请求，也没有改写原清单的 `validation-complete-pending-independent-final-review` 阶段标记。
