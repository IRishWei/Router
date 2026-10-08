# T10 安装证据独立 Spec 复审

Pin：文档提交 `0b9ec4fe21cc898d3240b232966bc6838ca041b9`；源码 `87e61a3b6a64487ca17222bf54dd68a6c7ee35e8`；非作者合并 `d3ced6136b866fb988a5889727361abe45598d1a`。包 SHA256：`C6D7957C1807542FE84259500747BD5FEE6B9971520FB07BA6C604258CA9FAB6`。

范围：按 code-review Spec 轴核对 [#11](https://github.com/IRishWei/Router/issues/11)、lifecycle contract 与 README、ticket-contracts、VERIFY；审阅 V 中 c 验收、准备、安装、归档和最终保留脚本及原始证据。未启动 Desktop、未执行真实 OAuth/模型请求、未重跑396项源码测试。

**结论：受控安装验收证据及归档文档 Spec PASS。missing / partial / scope creep / wrong 均0项。**

独立离线核对结果：

- 作者与 merge tree 相同；归档提交未改源码。包195401 bytes、30文件，tar内容、安装文件与逐项manifest哈希全部一致；10份公开归档与原始文件字节一致。
- 原始任务及服务计数支持4个Task、5次本地Responses、1次refresh、1次revoke：A到期任务完成，B切换后以独立账号/模型完成；两次完成的Router结果、原生turnOutline及标题均为LIFECYCLE_OK。退出B保留A和两份注册。
- 资格错误使A任务paused，保留登录、撤下连接，用量unknown；后续Task无Call。5次Responses与实际已派发Call逐项吻合，无隐藏重试或API Key回退证据。
- restart与final配置、任务历史深比较一致；固定模型、启用池、预算及自动路由恢复原值，配置版本正常推进。历史claim和原生默认模型的脚本断言明确。旧76文件重新逐项哈希通过；旧state仍9114595 bytes，SHA256为7b8c6e6bceffefb871caedc6df404b4b5b76403b2e5044314d8c4429e194906a。

b失败记录保留INVALID_CLIENT、本地零请求及默认认证端点次数未知，文档没有把它误称全程离线。独立执行最小Loader复现：缺依赖时构造捕获false，声明依赖后true；c配置明确注入两项服务，transport拒绝非本地origin，产品包未修改。

上述仅证明目标Desktop使用合成凭据和本地响应的受控结果。README、契约及VERIFY均明确官方真实OAuth生命周期未完成；查询确认#11仍OPEN，旧真实许可不继承。该待验收门槛保持打开，不冒充已完成，也不作为本轮证据文档缺陷。