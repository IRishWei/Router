# T07 / 0.14.0 源码复审

固定基线：`ac3f80e`。固定源码：`9c7269ff63dc48fe56e1c6199df2a7df1af88ad9`。
规格：[GitHub #8](https://github.com/IRishWei/Router/issues/8)，以及用户已批准的 Go 开发主线调整。

## Standards PASS

独立只读 Standards 复审，0 remaining findings。官方主机尾点入口绕过已关闭；目录生产传输回归仅授权自己的 loopback fixture；辅助 system 已计入预留；不声明工具的连接不执行返回的工具调用。未发现新增工程规则违例或需要处理的代码异味。

## Spec PASS

独立只读 Spec 复审，0 remaining findings。目录发现传入 `maxUploadBytes: 0`，有生产传输契约回归；辅助请求独立 `request.system` 纳入预留，原生标题回归核对实际 wire 内容与预留覆盖。文本连接的工具声明、参考费率、不完整缓存账本、身份、claim 与预算边界通过复核。

## 验证范围

- 初始实现全套 431/431 通过；三项边界修复后受影响测试 42/42 通过，build/check 通过。最终固定源码全套 434/434 通过（`t07-v0140-full-test-b.log`，17.4 秒）。
- 两路复审均不发真实模型请求、不读取秘密；本轮真实模型请求为 0。
- Desktop 安装验证将在此固定源码通过后冻结的 0.14.0 包上进行。
- 既有 Go 0.13.1 真实验收只证明此前固定 Go 路径；自定义连接路径的真实验收尚未完成，#8 保持打开。
