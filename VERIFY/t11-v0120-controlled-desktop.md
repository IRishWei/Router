# T11 0.12.0 目标 Desktop 受控验收

2026-10-09，Windows DSH Desktop 0.2.0-rc.2 / Cordis 4.0.4。源码 `5b4048dd96237a95ad29d5973c837d60324597f3`、基线 `0b9ec4fe21cc898d3240b232966bc6838ca041b9`，独立 Standards/Spec 最终均 PASS、0 findings，410/410 测试及 build/check 通过。非作者合并 `58fbdc2b17e377fadb711f5fa53deeb9bdaf7699`；相对作者 tree 只额外保留两份原有 T10 安装复审文件，字节不变。

冻结包 `artifacts/irishwei-dsh-router-0.12.0.tgz`，198923 bytes、31 files，SHA-256 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。官方 CLI 离线安装至全新 `t11-v0120a-controlled-home`；tgz 内容、清单与安装文件逐项一致。启动及重启前再次检查安装身份，没有重打旧包。

| 完整 Task 场景 | 每次 Call 的结果 | Task 结果 |
| --- | --- | --- |
| 精确 `gpt-6.1-sol` | 聚合输入1000，其中普通700、缓存读200、缓存写100；输出50含推理30。Standard API 参考值 USD 0.00217，记录来源、日期及精确映射。 | 主调用及原生标题各一次，订阅参考合计 USD 0.00434。 |
| 未确认别名 `sol-latest` | 映射与报价未知，完整值、小计均 null；不按相似名称套价。 | 订阅参考合计未知。 |
| 缺少缓存写明细 | 聚合输入1000仅供审计及判定短上下文；普通输入未知。完整值 null，可证明的输出与缓存读小计 USD 0.00052。 | 完整合计未知，可证明小计 USD 0.00104。 |
| 长上下文 | 聚合输入272001，普通100000、缓存读100000、缓存写72001；输出10含推理5。采用长上下文费率，USD 0.780155。 | 订阅参考合计 USD 1.56031。 |

4 个 Task 均 completed，Router result、原生 turnOutline 及标题为 `REFERENCE_OK`，共8次本地 Responses、夹具错误0、真实模型请求0。以上响应和用量为合成数据，不证明真实套餐消耗。实际账单始终单独 unknown；账号额度比例与重置时间 unknown、`scarcityApplied: false`，不调用私有额度接口。

安装后的 `lib/client.js` 通过真实 rc.2 Native Renderer、Typert RPC codec 和实时公开 RPC 载体检查，DOM 挂载使用 react-test-renderer，未做截图或 Computer Use。4条实际 Task 的记录分别显示价格来源/日期/精确映射或未知原因、聚合输入与缓存缺项、可证明小计、实际支出及额度未知，没有现金节省推断。读取前后配置、完整历史和原生默认模型相同。

原配置值恢复后重启，配置及全部4条 Task 深比较一致；原生默认模型与历史检测 claim 保留。两次 Desktop 均只按精确 PID、启动时间、exe、home 和捕获子进程树停止，本地服务也已退出。Astra 与 T10 的166份冻结文件哈希不变，旧真实 state 保持9114595 bytes、SHA-256 `7b8c6e6bceffefb871caedc6df404b4b5b76403b2e5044314d8c4429e194906a`；没有重置旧许可、读取 Codex 认证或修改系统网络。

保留的失败及修复依据：源码 a 轮复审发现缓存分项缺失时丢失可证费用小计，零金额上限未阻止后续请求；修复后原样复现进入 waiting-budget，仅派发一次，新增回归与最终双轴通过。初次完整测试另有旧 T09 普通输入断言不再符合缺项未知语义，更新该断言后全套通过。目标 Renderer a 脚本过早查询异步加载的记录，b 脚本使用了与实际界面不同的字符串；c 脚本等待真实 Task 并匹配实际提示后通过。各旧脚本及失败证据保留，后两项没有修改产品包或追加模型请求。

公共证据为同目录 `t11-v0120-*` 的源码双轴、非作者合并、包/安装身份、Desktop/重启、Renderer、保护检查及完整测试日志；原始辅助脚本和旧失败位于独立验证目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation/t11-v0120*`。

T11/#12 保持打开：尚待新授权下的真实返回用量与界面验证。T10/#11 的官方续期、账号切换与退出恢复门槛同样未完成，当前累计关闭10/24；源码与受控 PASS 不替代真实门槛，旧调用许可不继承。
