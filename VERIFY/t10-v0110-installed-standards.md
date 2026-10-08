# T10 安装证据与归档 Standards：PASS

固定归档提交：`0b9ec4fe21cc898d3240b232966bc6838ca041b9`（E:/GPT/Router项目）；比较 `git diff d3ced6136b866fb988a5889727361abe45598d1a...0b9ec4fe21cc898d3240b232966bc6838ca041b9`。源码 pin：`87e61a3b6a64487ca17222bf54dd68a6c7ee35e8`；非作者 merge：`d3ced6136b866fb988a5889727361abe45598d1a`。范围：README、ticket-contracts、VERIFY 公共证据及独立验证目录 t10-v0110c-* 验收/归档脚本，必要的 b 失败与 Loader red-green 依据；不重新审查源码实现。

**硬标准违规：0；可操作启发式建议：0。** 依据 AGENTS.md 的公开接口/无 Computer Use 边界、GLOSSARY 的“验收证据/无法确认”、ticket-contracts 与 T10 contract 第 7、12、19、21 行的隐私、持久化、验收分层及操作限制，未发现违规。

独立只读核对：

- 包 SHA-256 `C6D7957C1807542FE84259500747BD5FEE6B9971520FB07BA6C604258CA9FAB6`、195401 bytes；直接读取 tgz，30 个条目与清单、安装文件逐项一致，26 个构建运行文件一致；merge tree 与作者 tree 相同。
- 10 份公共归档与原件字节一致；公开 JSON/文本未检出 token、cookie、原始 subject/email 等敏感值。脚本使用公开 Host RPC、SessionController、CredentialProvider 与 Loader inject；已安装夹具保留精确本地 origin 拒绝检查。
- 4 Task、5 本地 Responses、1 refresh、1 revoke、0 夹具错误与原生结果/标题一致；配置设置恢复、重启配置/历史深比较、默认模型和历史 claim 保留均有对应数据。b 的 INVALID_CLIENT、默认认证请求次数未知及离线安装失败均保留并如实披露。
- 旧 76 个冻结文件哈希一致，真实 state 9114595 bytes、既有 SHA-256 不变。两阶段 owner/stop 回执身份一致，当前对应 PID 与受控服务进程均不存在；未发现越权清理证据。

仅执行文件、哈希、公共接口声明及进程状态读取；未启动 Desktop、发送请求或重复 396 项测试。受控 PASS 不证明官方 OAuth 生命周期完成；README、ticket-contracts 与验收记录明确真实门槛未完成，#11 必须保持 OPEN。旧报告保留。
