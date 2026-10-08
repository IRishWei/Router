# T11 / #12 安装验收与归档独立 Spec 复审

Pin：归档比较 `58fbdc2b17e377fadb711f5fa53deeb9bdaf7699...e6fc853dc0024ef2f0d8b388344881d4605c69c9`；源码 `5b4048dd96237a95ad29d5973c837d60324597f3`，源码基线 `0b9ec4fe21cc898d3240b232966bc6838ca041b9`。沿用源码 b PASS。

**受控安装/归档 Spec PASS；missing / partial / scope creep / wrong 均0项，无可操作 findings。**

依据 #12“缺失 token、价格映射或可信额度占比显示未知”“界面说明为何有或没有估算”及 T11 契约第13、15行。README第25行、ticket-contracts第3行、VERIFY/t11-v0120-controlled-desktop.md 的结论有证据支持。

独立离线核对 tgz：198923 bytes、31文件、SHA-256 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`；包、清单与实际安装字节相同，官方离线 CLI 收据成功。12份归档与原件一致；410项/build/check只核保留日志，未重跑。

4个完整 Task、8次本地 Responses、错误0。每 Call：精确价USD0.00217；别名完整额/小计未知；缺缓存写保留聚合1000，普通输入/完整额未知、小计0.00052；长上下文272001采用长价0.780155。来源/日期/置信度保留，实际账单及额度独立未知、scarcityApplied=false。原生输出/标题与 Router 均为 REFERENCE_OK。

已安装 client 哈希、Native Renderer/RPC脚本及四条实际 Task 对应；react-test-renderer 挂载、实时只读公开 RPC，未声称截图验收。a→b补等待异步 Task，b→c修提示字符串及输出文件名；旧失败保留，最终响应仍8，无新增派发。

恢复配置后重启，完整配置/历史深比较相同，默认模型与历史 claim 保留。166份冻结文件及旧 state 的9114595 bytes/既定哈希独立复核不变；退出脚本与两份收据限定 PID、启动时间、exe、home 及捕获子树。

以上仅为本地合成证据。#12真实用量/界面与#11官方生命周期仍待新授权，两 Issue 实查 OPEN，累计10/24，旧许可未重置。本轮未启动 Desktop、执行源码测试或真实请求；只读源码/包/旧证据，报告以 CreateNew（wx）新建。
