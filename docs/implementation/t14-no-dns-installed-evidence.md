# T14 安装后无需修改 DNS：实际验收

2026-10-07，Router 0.9.3 在目标 Windows DSH Desktop 0.2.0-rc.2 的独立 home 完成自动网络兼容验证。默认生产来源读取、完整 19 项实际 Task、已安装 Renderer、配置恢复、重启、公开移除测试夹具和再次重启均通过。最终独立 Standards/Spec 均 PASS，无阻断 finding；已具备 T14 关闭资格，待最终文档增量复审后同步 #15。

## 实现与固定包

生产作者提交 `8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f`，非作者合并提交 `6fffd362d72f5befc7f1b03dc920866842c3d5d9`。新增应用范围内的默认来源传输：读取现有 Windows 系统代理，兼容代理虚拟 DNS；公共目标精确绑定、原域名 TLS、逐跳 URL/地址校验及 query 脱敏保持。必要的辅助解析通过既有代理访问固定 HTTPS 公共解析服务，只发送域名和记录类型，不写系统 DNS。代理发现、解析、CONNECT/TLS 与正文共享原绝对 deadline 和取消信号；slow-drip 不能延长超时。

| 对象 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Router 0.9.3 | 163149 | `AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3` |
| controlled companion 0.3.4 | 3980 | `CB5127BAFE4CE2784700BFD6747EC4F60EB07563326B7C6816ACD086213A53B5` |

使用官方 CLI 安装、公开 PluginManager 启用/移除；每次只操作权威文件确认的 owned PID、精确启动时间、exe 与独立 home。Router 全部 25 个安装文件与冻结包逐字节相同，21 个 lib 与已审作者构建逐字节相同、与 ROOT 构建按 LF/CRLF 规范化后相同；夹具精确四文件匹配。非作者排他复制，没有覆盖旧包。

源 resolver 回归 20/20、Task/Renderer 回归 17/17。作者完整串行 289/290 的既有 T16 Windows 临时目录 ENOTEMPTY 失败及隔离 1/1 通过均保留；非作者 ROOT 最终完整串行 290/290、check/build 和导入闭包检查通过。Companion 0.3.4 源码与全新解包各 11/11。后续仅 helper、夹具及文档变化，未重复全量生产测试。

## 原网络中的真实来源

已安装 `createHttpSourceEvidenceResolver()` 使用生产默认值，没有注入 lookup、代理、解析覆盖或替换 source URL/hash。固定来源为 [GLOSSARY.md 的固定提交](https://raw.githubusercontent.com/IRishWei/Router/97d77e20ba6fc10d4ebb7c153866a8a20b0d23ca/GLOSSARY.md)。实际结果 HTTP 200、UTF-8 正文 2214 字节，SHA-256 精确为 `bd44743e93c46cd6f028491d96cae78e085f25a603380a725fd2337dbc4633a2`。

网络前后证据只保存 DNS 配置、当前用户代理策略及连接配置、hosts 的 fingerprint，原始设置不输出；各项 fingerprint 深比较相同。没有改 DNS、hosts、系统代理、路由器、DSH 全局 dispatcher、Codex 配置/认证或代理环境变量。来源路径成功不等同于任何真实模型账号已授权。

## 完整 19 项实际 Task

使用公开 SessionController/RPC、真实 AgentLoop、共享 Router Host 和唯一 AcceptanceCoordinator。执行脚本为 `t14-v093e-installed-verify.mjs`（34175B，SHA-256 `EBD7880C062DC8D333C8FCBB9C9BDFC632FA58A95CF9D63BCE62996FA966E693`），完整结果 `completed:true`，19 个新 Task ID 唯一。

| 案例组 | 数量 | 证明 |
| --- | ---: | --- |
| 验收关闭、仅来源访问、跨模型未许可 | 3 | 来源可访问仍不等于支持论点；许可不足零评审 Call。 |
| 正文/引文/来源绑定、来源 query 展示脱敏 | 2 | 真实正文/hash/exact quote 与受控评审协议绑定；每 Task 的展示 URL 不泄漏 query。 |
| 引用不能代正文、缺少来源、引文不匹配 | 3 | 明确失败且保留定位证据，零评审 Call。 |
| 私网来源、不支持的研究要求 | 2 | 无法确认，不放行受限目标，也不制造支持结论。 |
| 高风险评审冲突、未知评审、有界推论 | 3 | 冲突和未知保持无法确认；推论严格绑定两个研究 case，整体最多两次评审。 |
| 整体研究上限、研究与通用 rubric 共享上限 | 2 | 同 Task 的所有领域评审合计最多两次，额度耗尽后仍无依据则无法确认。 |
| 评审预算 extend、stop、revoke | 3 | 等待的精确 review Call 未派发；扩展同 Task/turn/Call 后完成；停止或撤销释放预留并保留精确原因。 |
| 真实人类 steer 补充 | 1 | 原 Task/turn 接纳新输入，旧 review 未发出且 released，旧 artifact superseded，新正文和要求经唯一已派发评审通过。 |

预算案例为 16 token，之前完成的实际 Call 已知总消耗为 16；review 完整输入/输出预留为 4096，唯一 waiting Call 精确匹配 waiting.callId、blockedBy=tokens、reservation=waiting。extend 将同任务预算扩展至 8208。stop 为 ABORTED/BUDGET_STOPPED，revoke 为 MODEL_NOT_FOUND/MODEL_DISABLED；两者均 not-dispatched/released、零 review 派发。stop 必须恰一个 budget-stop 事件且 stopRequested=true；revoke 为零事件，公开可省略的 stopRequested 不得为 true。

steer 精确核对两次原始 RPC 的 requestId、messageId、turn、内容 hash、input-claimed timeline；原 research requirement 与新增 includes-literal CORRECTED 分别绑定各自 user-message origin，seq 8→21。两条人类输入与原要求保留，没有把补充当成删除原要求。旧 review 零派发，新 review 绑定最终 artifact hash，整体仍只有两个 review reservation、一个实际派发。

本轮 53 个实际派发 Call、424 个已知 token 和 53 个 PRICE_UNKNOWN 已由独立 Standards/Spec 重算。全部实际 fixture Call 的 selection、candidate snapshot、派发状态和完整 usage 经断言：input/output/cache-read/cache-write/reasoning/total 为 4/4/0/0/0/8。账本按所有实际已派发 Call（包括原生标题辅助 Call）逐项重算；缺价格为 PRICE_UNKNOWN、amount=null、billing unconfirmed。夹具固定输出只证明预算、绑定和协作协议，没有付费 API 调用，也不认证模型的研究判断质量或账号资格。

## Renderer 与完整恢复

加载实际安装且与包 hash 一致的 client.js，通过真实 rc.2 Cordis、Renderer、Typert registry/gateway 和 slots 挂载；carrier 只读取 live router/snapshot。19 个实际新 Task 分别定位自己的历史条目，核对 lifecycle、最终 artifact、verdict、coverage、逐项 claim/support/access/quote/reason 和 superseded history。挂载前后 Tasks/config/DeepSeek 元数据/原生默认深比较不变。使用 react-test-renderer，不宣称截图或视觉外观验收。

新基线为完整 211 条历史、config revision 525；新增 19 条后为 230，全部 211 条旧 Task/Call/ledger 逐字段保留。finally 恢复全部配置值，revision 合法递增至 560，storageError=null。带夹具重启深比较全部 230 条历史、配置、DeepSeek 凭据元数据和原生默认；公开移除夹具后再次重启重复同样比较，fixture 不再可用。配置值已恢复，版本号不回退。

## 保留的失败与修正

原 0.8.1 来源访问失败见 `t14-installed-host-evidence.md`，没有改写。0.9.2 独立审查发现 socket inactivity timeout 可被持续正文刷新，以及 launcher 可接受调用方自证 hash；0.9.3 改为绝对 one-shot deadline/取消关闭传输，并在停止 owned Desktop 前固定包身份。slow-drip RED→GREEN、两轴复审和新包证据保留。

首轮 0.9.3 使用 companion 0.3.2：14 项已验证，第 15 个实际 Task 的通用 rubric 评审协议被旧夹具拒绝；本轮 completed:false、159→174 的完整记录保留。0.3.3 添加严格 rubric 协议后，独立复审又发现原始 JSON 空白/escape 可绕过仅按紧凑重序列化计算的字节界限；0.3.3 没有安装。0.3.4 在 JSON.parse 前限制原始 UTF-8 prompt 为 32 KiB；32768 接受、32769 拒绝且零 chunk，research/rubric 两类均覆盖。

v093c 的 17 项已验证，第 18 个实际 Task 撤销行为正确，但 helper 错把可省略的 stopRequested 当作必填 false；174→192 的失败和恢复保留。v093d 的 18 项已验证，第 19 个实际 Task 的 steer 行为正确，但 helper 误读 Task.inputs 的 seq/text；192→211 的失败和恢复也保留。v093e 按公开 schema 将输入内容绑定至 contentHash、序号绑定至 requirement.origin，并增加两次精确 requestId 与 input-claimed timeline 深比较；独立使用 d 的公开 Task 重放通过，再从 211 全量运行新 19 项。没有降低 source/hash、评审、预算、派发或恢复门槛。

原保护清单与各失败清单全部复核：35 fixed+2 prefix、20+2、20+2、29+2、28+2、24+2。集合重叠，不能相加为唯一文件数。原 manifest 和密封前缀保持；旧失败日志、脚本、报告、冻结包未覆盖，仍保留 completed:false。

## 证据与后续边界

验证根目录为 `C:/Users/a1500/AppData/Local/Temp/router-implementation`，最终前缀 `t14-v093e-`：before-upgrade、installed-hashes、installed-default-source、bundle-enable、execution-evidence、restored-state、renderer-evidence、restart-evidence、bundle-remove、companion-removed-evidence、network-before/after JSON。

Core 两轴、非作者合并、fixture 0.3.4 和 e helper 两轴报告原文排他逐字节归档至仓库 VERIFY。最终实际安装 Spec 原文已排他归档至 `VERIFY/t14-v093e-spec-installed-final.md`，SHA-256 `716EA0BFE5349484E4A40EC2ACB303F14C1C60EB94842F2F69908380982CD11D`，PASS。最终 Standards 原文亦排他归档至 `VERIFY/t14-v093e-standards-installed-final.md`，5449B，SHA-256 `8AC3C2C2F23974B63EDD8F6C175289075DAB1E04842EEFB09F9FF9FB90641B46`，PASS。两轴无阻断 finding，具备 T14 关闭资格；#15 此时仍 OPEN，最终文档增量复审后再同步闭票记录。

本结果解除 T14 的来源读取兼容缺陷。安装后无需改 DNS 的正式要求继续约束后续目录/连接请求和 T24 完整交付；目前的实际证据覆盖目标宿主与已有网络。真实 T05/T06 凭据、调用授权、其他网络环境及全部插件最终交付保留独立门槛。GitHub 24 张票原文和 36 条原生依赖保持；父 #1 不因本票通过而关闭。
