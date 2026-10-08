# T09 0.10.5b：真实验收未通过，恢复与保全通过

2026-10-09，使用用户新批准的1 Task、最多2请求（含标题）、65536 token完整输入预留、120000ms绝对时限；无自动重试、扩预算或API Key计费回退。此前许可不复用。

## 实际结果

- 通过已安装0.10.5 Renderer、真实公开Typert RPC及独立DSH Desktop完成同账号官方重新授权，再立即发起唯一验收Task。
- Task：`eaf5b278-ff85-41a6-9e21-b373ef929f5c`；Session：`session-1e53c466-68f5-4cd6-93f2-fa7825e87b42`。
- 共2次实际派发，包含标题调用；完整预留40138 tokens，耗时5689ms，无扩额、retry或API计费回退。
- 原生会话7个Zstd帧/19条记录，唯一关闭文本块精确为 `CHATGPT_CONNECTION_OK`。随后adapter在终态抛出 `Completed Responses output disagrees with streamed output`。
- Task最终为 `paused / MALFORMED_RESPONSE`，推理资格未确认。文字已出现和接收到终态事件都不能代替最终一致性检查通过。
- 主调用失败，标题调用被中止；两Call用量均未保存，统一账本各项token保持null、unknownTokenCalls各项为2、unknownPriceCalls为2。不得改写为零或追认未知用量。
- 此次终态原始output未记录，无法从现有原生会话判定差异来自缺块、多块或文本内容。不能把模拟fixture当作真实失败正文，也不能由此直接放宽输出一致性。

## 恢复及证据

配置值和native default已恢复；重启后全部234 Tasks、543 Calls、config584、同账号/issued client/connection/catalog、推理未确认状态及新claim保持。旧233个Task与轮换前原始状态逐对象完全一致。

验收PID43828与重启PID4584均按PID/start/executable/home精确停止，未停止普通Desktop。最终零Desktop进程。最终原始状态9068103 bytes，SHA-256 `9D228DC643EC7C144215A0FAC5F0AB44E7941A077149B28DDA8882724B1FD3AB`，原件另存为 `t09-v0105b-final.private-state.json`。

预审v1/v2的拒绝提示问题、BLOCK报告及辅助脚本原件保留。最终使用v3启动器和其余v2辅助脚本；两轴最终预审PASS，受控保护测试11项及新版拒绝路径3项通过。准备证据72文件独立冻结，manifest17110 bytes / SHA-256 `4CB96903C6134FA0F9DB2A7BF7862806DDFAB55ED9A0E3EAEE93BDB3371BD028`；不冻结可变工作目录源码。

独立实际复核：[Standards](t09-v0105b-actual-standards.md)、[Spec](t09-v0105b-actual-spec.md)均判真实推理BLOCK，工程边界和数据保全PASS。#10保持OPEN；本轮1 Task/2请求许可已消耗。

下一步离线补充不含正文的终态对比信息，并在输出验证失败时结算终态已报告的合法用量；不凭本次失败确认根因或成功接入。再次真实调用须取得新的有界许可。
