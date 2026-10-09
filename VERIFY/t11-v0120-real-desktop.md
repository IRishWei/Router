# T11 0.12.0 真实 Desktop 验收

2026-10-09，目标 Windows DSH Desktop 0.2.0-rc.2。产品源码、冻结包及受控结果沿用既有固定点；本轮仅新增真实证据。脱敏证明见 `t11-v0120-real-proof.json`。

- source：5b4048dd96237a95ad29d5973c837d60324597f3；包 SHA256：47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8。
- 用户明确回复“允许本轮 T11 有界真实验收”，grant 绑定已冻结 r3 proposal SHA256；随后确认同账号官方登录完成。独立 DSH home，无旧凭据导入。
- 1 个新 Task、2 次 gpt-6.1-sol 请求（执行及原生标题），完成结果 `CHATGPT_CONNECTION_OK`。65536 token／120000ms 限制，无自动重试、扩额或 API Key 回退。官方输出无 token 硬上限。
- 执行返回：input 6547、output 8、reasoning 0、total 6555；标题返回：input 121、output 48（包含 reasoning 35）、total 169。两次缓存读写均明确为0，输入分区完整。
- 独立 oracle 核验每个 Call 及 Task：0.013174 + 0.000722 = 0.013896 USD 订阅参考价值；未重复计价 reasoning。实际账单支出和账号套餐额度仍未知，不作现金节省结论。
- 安装客户端以真实 Native Renderer／Typert codec 和实时公开 RPC 读取真实记录，参考价值、价格依据及未知状态显示通过；无额外模型调用。使用 react-test-renderer，未做截图视觉验收。
- 目标 Desktop 重启后，配置、完整任务历史、检测 claim、原生默认模型均保留；两个自有启动阶段均已停止，无额外模型调用。
- 综合冻结 manifest 的150份文件逐字节哈希不变；更早保护由既有 RPC preservation guard 检查。包未覆盖、未重打包，Codex 配置与认证未读写。

首个 authorize 命令在 Desktop 私有入口就绪前退出；未创建 authorization intent，未打开官方页，模型请求0。确认入口就绪后原脚本授权成功，未更改冻结 helper。此启动时序记录保留，不作为产品失败或模型重试。

独立 Standards PASS、Spec PASS，均0 findings，见 `t11-v0120-real-review.md`。本轮 T11 真实门槛通过。T10 官方续期、账号切换与退出恢复仍未通过；用户暂时没有第二个账号。本轮许可不覆盖 T10，也不继承到后续调用。
