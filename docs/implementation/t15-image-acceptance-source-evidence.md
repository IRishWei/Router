# T15 / 0.15.0 源码证据

2026-10-09 开始实现，2026-10-10 完成本轮源码验证。以 `codex/dsh-router-v1` 的 `216b49684a80d2350b730549f8c8402fe77ea0ed` 为已合入基线，在独立 managed worktree 实现 #16。验收范围是源码、本地受控 provider、公开宿主接口与自动化；目标为 DSH Desktop 0.2.0-rc.2 / Cordis 4.0.4。目标 Desktop 安装、公开 RPC 任务、页面与重启证据由集成负责人另行记录，本文件不宣称已完成该安装门槛。

## 完整 Task seam

测试从真实 SessionController 输入，经过 AgentLoop、实际 LlmAdapter request、最终 artifact、Host canonical Acceptance、原 Task ledger/timeline。仅 provider 是受控系统边界，没有模拟 coordinator、Router capture、预算、附件服务或内部 collaborator，也没有新增公共评分/verdict RPC。

受控候选通过 Host 注册/启用，并由 Router 固定后的文本 priming Task 建立 Session 图像 header，再由 SessionController 上传图像。没有调用 `selectModel` 或改全局默认；priming 属于独立真实 Task，其消耗也进入 fixture 记录。主 provider 和 reviewer 实际用公开附件接口读取请求中的图片并核对 hash。DSH 将测试 1×1 PNG 接纳为 WebP，检查的是该 immutable ref/bytes，而非假定上传 PNG 不会归一化。

有限识别、定位、解释与歧义样例证明声明合同的绑定和判定。返回内容及每图 64 视觉 token 均为本地 fixture 数据；它们不认证图像语义、真实模型定价或真实视觉能力。验收与评审默认关闭；Go/兼容/ChatGPT 的文本限制未变。

## 逐切片 red → green

每次先添加一个完整 Task 行为测试、保存失败，再实现最小改动并重跑。原始日志位于本机外部目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation/implement-spec-go-20261009/`，未替换任何既有冻结包或历史证据。

| 切片 | red 暴露的行为缺口 | 证据文件 |
| --- | --- | --- |
| 01 | 图像 ref、识别参考与答案核对未形成独立证据 | `t15-red-01.log` / `t15-green-01.log` |
| 02 | 有限定位/解释未被识别 | `t15-red-02.log` / `t15-green-02.log` |
| 03 | 歧义没有独立、不可提升的 unconfirmed 证据 | `t15-red-03.log` / `t15-green-03.log` |
| 04 | 矛盾参考未保持 unconfirmed | `t15-red-04.log` / `t15-green-04.log` |
| 05 | 必要匿名多模态评审未接入原 Task | `t15-red-05.log` / `t15-green-05.log` |
| 06 | 高风险标准尚未识别，冲突复核未接入 | `t15-red-06.log` / `t15-green-06.log` |
| 07 | 超过有限要求数量没有可见限制结果 | `t15-red-07.log` / `t15-green-07.log` |
| 08 | 混合段落被吞为多余研究要求 | `t15-red-08.log` / `t15-green-08.log` |
| 09 | 等待期间确切模型丢失 image metadata 后仍错误通过 | `t15-red-09.log` / `t15-green-09.log` |
| 10 | 同 Task 图像 steer 后旧要求/绑定的 history 白名单缺少图像字段 | `t15-red-10-verified.log` / `t15-green-10.log` |
| 11 | 高风险第二次评审没有反转匿名呈现顺序 | `t15-red-11.log` / `t15-green-11.log` |
| 12 | 构建的 Host import 闭包漏掉图像模块；随后实际 Renderer 展示图像证据 | `t15-red-12.log` / `t15-green-12.log` |

`t15-red-10.log` 另保留了测试设置失败：误把上传 PNG 当作接纳后 bytes，并在未扩展预算时等待下一评审。修正 fixture 后的 `t15-red-10-verified.log` 才是有效行为 red；没有把设置失败算作功能证据。

## 最终验证

- `npm ci --ignore-scripts` 安装本地开发依赖。
- `node --test test/t15.integration.test.mjs`：39/39 完整 Task 测试通过，最终附件读取加强版记录为 `t15-final-regression-r2.log`；此前记录 `t15-final-regression.log` 保留。
- `npm test`（含 build）：473/473 通过，0 failed/skipped/cancelled，最终记录为 `t15-full-suite-r2.log`；此前记录 `t15-full-suite.log` 保留。
- `npm run build`、`npm run check`、`git diff --check` 通过。

39 项图像回归覆盖三类有限答案、歧义/冲突、匿名评审/高风险复核、严格无效返回、跨域两次总额、11 种预留前零 Call 门禁、文本/未知主执行零调用、预算扩展/停止/撤销、等待期间 metadata 变化与带图 steer、未知用量、真实 Host 重启、构建模块闭包和实际 rc.2 Renderer/既有 snapshot RPC。等待被撤销或 superseded 时原 artifact/ref 保留、未发送预留释放；重启保留旧普通 acceptance 和新图像闭包。全量测试同时保留 T13/T14 的 blocking、coverage、history 与旧 ledger 行为。

源码版本为 0.15.0；该阶段未打包或安装新 tgz。生产模型网络请求 0、真实 Key 读取 0、Codex 配置/认证访问 0，未使用 Computer Use。没有新增官方 OpenAI/DeepSeek 接入，没有关闭 Issue 或推送分支。后续仍需独立源码双轴复审、非作者集成、目标 Desktop 受控兼容路径；受控通过不会消除 #25 的官方 API/账号真实验收门槛。
