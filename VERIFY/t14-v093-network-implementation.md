# T14 0.9.3 绝对截止时间修正：作者实现记录

## 固定点

- 基线：0.9.2 提交 `a4534a3d464dab2466cb813bccb288ff0713a258`
- 修正提交：`8cc67dd2259ee2fd20c3b427e69b6a7a317bec3f`
- 集成祖先：`14e2f56e2f07c5db8df3e03dfc621e4119604db2`
- 包：`t14-v093-author-package-8cc67dd/irishwei-dsh-router-0.9.3.tgz`
- 包大小：`163149` bytes
- 包 SHA-256：`AB78E7F703871EA6316A41A61BEE647E6C9184B627612BEB29BBAF7E56253DD3`

0.9.2 提交、tgz、实现报告、双轴审查报告和 slow-drip RED 记录全部保留，未覆盖。

## 审查 finding 与修正

0.9.2 Standards/Spec core 唯一阻塞是共享 `readResponse()` 使用 `request.setTimeout(timeoutMs)`。Node 将其作为 socket inactivity timer；持续小流量会刷新计时并突破来源的绝对 deadline，上层 bounded wait 先返回时底层连接也可能继续。

0.9.3 在 `readResponse()` 进入时只计算一次 `deadline - Date.now()`，设置独立的一次性 timer。timer 从请求创建开始覆盖直接连接、代理 CONNECT、TLS、固定 DoH 和来源正文；到期时销毁 request，销毁 Agent 管理的 socket，并返回 `SOURCE_TIMEOUT`。原 signal 取消走同一 stop/finish 清理路径并返回 `CANCELED`。成功、响应错误、请求错误、过量、超时和取消都会清除 timer、移除 signal listener、销毁 Agent；持续流量不能刷新 timer。

没有扩大 deadline、signal、重定向次数或传输预算，没有改变代理发现、公共地址门禁、DoH 内容、来源 URL/hash、Host/SNI/TLS、RPC 或 Task 语义。

## RED / GREEN 与底层清理证据

- RED 记录：`t14-v093-slow-drip-red.md`。
- 场景：总 deadline 35ms；来源每 10ms 写 1 byte，共 20 次。
- 0.9.2：约 334ms 后返回 `available`，1/1 fail。
- 0.9.3：公开 resolver 在原 deadline 返回 `SOURCE_TIMEOUT`；服务端收到连接 `close`，写入数小于20，等待30ms后写入数不再增长。
- 原 signal 取消：200ms deadline 下于25ms取消，返回 `CANCELED`；服务端收到连接 `close`，等待30ms后写入数不再增长。

## 验证

- slow-drip/取消资源清理：1/1 PASS。
- `test/t14.research-acceptance.test.mjs`：20/20 PASS。
- `test/t14.integration.test.mjs` + `test/t14.client.test.mjs`：17/17 PASS。
- `npm run build`：PASS。
- `npm run check`：PASS。
- `git diff --check`：PASS。
- 串行全量：289/290 PASS；唯一失败是既有 Windows 临时目录清理 `ENOTEMPTY`，位于 T16 budget-revoke 测试，不涉及本次源码。
- 该失败用例随后隔离执行：1/1 PASS；未修改 T16 代码或测试，未重复全量。
- 源码到构建闭包：`src/source-network.mjs` 与 `lib/source-network.js` 字节相同；`research-acceptance` 保持既有两处 `.mjs`→`.js` 构建改写。
- 包到构建闭包：解包后的 `lib/index.js`、`lib/research-acceptance.js`、`lib/source-network.js` 与作者构建结果 SHA-256 相同。
- 关键 SHA-256：
  - `src/source-network.mjs` / `lib/source-network.js`：`EE947CE5A2BC33267F2A7E11D3B83FFCF73B2F950CEB06AF5AAD0BAC252CB1F4`
  - `src/research-acceptance.mjs`：`E6D76FFF4C794011ECE6263848FEACE3547207AF359EC09D541A9B37EB1E5A2B`
  - `lib/research-acceptance.js`：`BA681B31C9865BF8090C81C90CB9D366137A1495EFD15F4F2617BA412D6368B0`
  - `test/t14.research-acceptance.test.mjs`：`F038341ECCD5B52A48F033E20E380104A35A6B680CFD4A92DF7366C07F5A09AB`

## 冻结包默认来源复验

从冻结 0.9.3 tgz 解包后直接导入发布 `lib/research-acceptance.js`，不注入 lookup、代理或公共解析覆盖，在保持 DNS、代理、hosts 和路由器原样时读取固定来源：

- access：`available`
- HTTP：`200`
- UTF-8 正文：`2214` bytes
- content SHA-256：`bd44743e93c46cd6f028491d96cae78e085f25a603380a725fd2337dbc4633a2`
- 固定预期 hash：匹配
- network settings changed：`false`

本轮未安装 Desktop、未调用 RPC、未创建 Task、未读取凭据、未调用付费 API。

## 兼容性、风险与回滚

公开 resolver、Task/Controller、RPC 与研究证据结构不变。0.9.3 只收紧已有绝对 deadline：过去可因持续流量超过 deadline 的请求现在会按合同停止并保持来源无法确认。

回滚到 `a4534a3`/0.9.2 会恢复 slow-drip 超时漏洞；回滚到0.9.1还会恢复虚拟 DNS 来源不可用。所有版本均未写系统网络配置，没有 DNS、代理或路由器恢复步骤。

## Reviewer 审查包

- 需求：关闭 0.9.2 双轴唯一 core finding，同时保持无需改 DNS 和全部来源安全边界。
- diff：`a4534a3..8cc67dd`；完整功能 diff：`14e2f56..8cc67dd`。
- 重点风险：绝对 timer 是否从请求/CONNECT前开始；DoH 与 source 是否共享相同实现；timeout/abort 是否实际销毁底层连接；全部 finish 是否清理 timer/listener/Agent；没有恢复 inactivity 语义或扩大 deadline。
- 测试证据：上述资源关闭断言、20/20、17/17、build/check/closure、冻结包默认固定来源 200/hash。
- 后续门槛：0.9.3 独立 Standards/Spec、非作者合并及目标 Desktop 完整实际验收；本记录不宣称 T14 已关闭。
