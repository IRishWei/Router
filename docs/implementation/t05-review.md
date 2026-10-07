# T05 双轴复审与剩余验收

最终实现 `d4b874916069e83ee2df10a62bf1f41c4640a683`，非作者集成 `fc384a70f99dc070663e85bf80e4a254e4abc4ff`。完整实现以 `473df19184a8e826f5f9f50210ca70efb8ac6512` 为基准，历次修复由同一组原审查者独立复验。

Standards 最终 PASS，0 剩余强制规则违规。保留四项非阻断建议：UI 与协议的局部 schema 重复、持久化方法命名、RouterService 职责集中、构建脚本手工维护模块复制与导入改写。新增发布包闭包测试覆盖最后一项的漏打包风险。

Spec 最终 PASS，0 剩余代码阻塞。审查及实际安装发现并修复了检测预算扩展仍使用旧 deadline、合法超长 duration 使 Node timer 溢出、新模块未进入发布包、真实 sibling Fiber 中缺少 SessionController 依赖声明。deadline 锚定原 Task 开始时间，持久化扩展后分段重新调度；token-only 扩展不延期，停止与终态清理。发布包必须解析全部相对导入，并在真实 rc.2 Host 加载。SessionController 通过 required inject 获得，测试不再以根 Context 服务替代真实插件依赖边界。

非作者集成验证 `npm test` 214/214、`npm run check`、`git diff --check HEAD^1 HEAD` 全部通过。真实 Controller、正式 SDK 与本地 HTTP/SSE 覆盖成功、工具往返、401、取消、预算扩展、标题辅助调用和凭据撤销；这些受控用例不认证真实 API。0.7.4 的实际安装、连接、预算等待、停止、断开和重启证据见 [目标宿主证据](t05-installed-host-evidence.md)。

T05/#6 保持打开：还需要用户安全提供自己的 DeepSeek API Key，并授权一个有限预算的真实检测 Task。目录可见、配置保存成功和受控 SSE 不能替代该验收。T06 的 OpenAI 凭据选择仍是独立门槛；T14/T16 可以沿已关闭的原生前置继续实现。

原始报告保留在专用验证目录：`t05-shared-standards-review.md`、`t05-shared-spec-delta-review.md`、`t05-fixed-standards-delta-review.md`、`t05-fixed-spec-delta-review.md`、`t05-package-standards-delta-review.md`、`t05-package-spec-delta-review.md`、`t05-fiber-standards-delta-review.md`、`t05-fiber-spec-delta-review.md`。诊断失败记录保留，未用后续通过结果覆盖失败证据。
