# T07 / 0.14.0 有界真实验收执行前复审

用户已回复“批准”前一轮具体范围：1 新 Task、2 次 gpt-6-luna 请求（含标题）、32768 token/60000ms、每次输出最多1024、无重试或扩额，Use balance 保持关闭。随后用户确认已在原生 DSH 自定义兼容密码页保存 Go Key。

固定源码 `9c7269ff63dc48fe56e1c6199df2a7df1af88ad9`；冻结包 `C126B2B9F03CF0536A971151979FCE4C9BE34F2F6E9061C77B8551EE56A4CB58`。

初稿 `t07-v0140-real-detection.mjs` 未执行，两路执行前复审发现：失败时撤池未放入finally、将possible派发数误称实际请求数。原脚本保留。新稿 `t07-v0140-real-detection-b.mjs` 修正：finally撤池/停止活动Task，RPC清理失败精确停止自有进程；分开可能派发、完成回执、不确定派发，有不确定项时实际请求数null。

## Standards PASS

独立只读复审，0 remaining findings。唯一dispatch文件与原上限有效；仅选择唯一已连接的匹配Go条目，记录所选身份、逐Call输出cap；修正清理与证据口径符合ADR 0002。

## Spec PASS

独立只读复审，0 remaining findings。1 Task/2 Call永久claim、token/时限/输出限制、无目录/校准/重试/扩额均保留；其余保存连接不调用；失败也执行finally，API不可用时停止精确自有进程。

两路只读复审均未执行模型、读取Key/私密日志或修改文件。此报告认证执行边界，真实结果另行归档。
