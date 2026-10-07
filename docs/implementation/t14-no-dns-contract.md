# 安装后无需修改 DNS：产品合同与 T14 修复

2026-10-07 用户明确要求：“我希望这个插件在使用时也不需要更改dns，可以安装后直接使用”。这是产品与交付要求；不再把修改用户网络作为解除 T14 阻塞的前提。修复前 0.9.1 未满足本合同；0.9.3 已完成默认生产来源、完整19项实际Task、已安装Renderer、配置恢复、重启和移除夹具后再次重启，网络 fingerprint 前后相同。最终独立审查及闭票状态见 [实际安装证据](t14-no-dns-installed-evidence.md)。本合同继续约束后续目录/连接和 T24 完整交付。

## 产品边界

- 用户在可访问目标服务的现有网络中安装、启用插件，选择已有可用 DSH 连接或完成必要的账号授权后即可使用；无需修改 DNS、hosts、系统代理、路由器或运行网络修复命令。
- 插件继承既有宿主或系统网络策略；兼容普通直连及目标 Windows Desktop 上已经配置的代理。插件不得改写系统网络、DSH 全局代理/dispatcher 或 Codex 配置/认证。
- 外部服务本身不可达、账号未授权或没有可用连接时，显示明确状态并保留任务。安装不能替代账号授权，也不能保证离线访问互联网；网络问题不能被建议用户改 DNS 的安装步骤掩盖。
- 来源访问、插件自有目录/连接请求及最终安装流程都受本要求约束。T14 先修复来源访问；T05/T06 的真实账号及后续 T24 完整交付仍保留原验收门槛。

## 已复现的缺陷

修复前 0.9.1 的生产 `createHttpSourceEvidenceResolver()` 在本机默认解析得到 `raw.githubusercontent.com → 198.18.2.36`，于 HTTP 前返回 `SOURCE_ADDRESS_NOT_AUTHORIZED`。同一固定 URL 在保持网络设置原样时，通过系统默认网络请求返回 HTTP 200，UTF-8 正文 2214 字节，hash 精确为 `bd44743e93c46cd6f028491d96cae78e085f25a603380a725fd2337dbc4633a2`。现有 Windows 系统代理已启用；其配置不作为公开证据输出。

修复前的独立最小探测还通过现有代理连接独立解析得到的公共 IP，使用原域名 TLS SNI 与完整证书验证，再以原 URL 读取来源；HTTP 200、2214 字节、同 hash 均通过。该探测只证明修复方向可行，没有改生产源码、系统 DNS 或代理设置。

固定来源继续为 `https://raw.githubusercontent.com/IRishWei/Router/97d77e20ba6fc10d4ebb7c153866a8a20b0d23ca/GLOSSARY.md`。不得更改来源/hash、放行受限地址或把夹具结果当作真实访问。

## 实现与验收范围

1. 默认来源读取自动采用现有网络路径；普通公共 DNS/直连保持可用，已有 Windows 系统代理无需用户再次导出环境变量或修改配置。
2. 代理虚拟 DNS 结果不得当作实际公共目标。代理连接的目标仍需公共地址验证、精确绑定和原域名 TLS 校验；本地、私网、metadata、非法 URL 及未授权重定向继续拒绝。
3. 若需要有界的加密公共解析辅助，它仅服务于受保护的应用请求，通过现有代理访问固定 HTTPS 解析服务，只发送域名及记录类型，不发送来源路径/query、正文、账号或凭据，不改变任何系统 DNS 设置。保留超时、取消、字节上限与无法确认结果；解析失败不能绕过地址检查。
4. 代理发现、辅助解析、CONNECT/TLS、来源 body 及每跳重定向共用原来源/整体 contribution 的 deadline，取消关闭底层传输；无不可观察的无限重试或 UI/RPC 任意网络入口。
5. 回归覆盖真实公开 resolver 和已约定完整 Task/Controller 验收入口：普通直连、现有代理与虚拟解析、代理失败、TLS/取消/超时、恶意地址和重定向、query 脱敏及来源 hash/quote binding。临时夹具只验证协议。
6. 通过独立 Standards/Spec、非作者合并、固定新包及目标 Desktop 默认生产路径后，再运行 T14 全部 19 项实际验收、已安装 Renderer、配置恢复、重启、移除夹具后再重启。每次以当时完整历史重新捕获基线（最终 v093e 为211，追加19项后为230），不复用旧121/123/142锁定数量或已存在 wx 标签。

## 证据和已知宿主限制

验证目录 `C:/Users/a1500/AppData/Local/Temp/router-implementation` 中保留 `t14-v092-no-dns-red.mjs/json`、`t14-v092-public-ip-proxy-probe.mjs/json`。旧 v081b 失败、所有已审包及 T16 三层保护证据不改写。

公开精确 rc.2 的 `@deepseek-ai/dsh-http-proxy` 只读取代理环境策略，不自动探测 Windows 系统代理；单纯切换到宿主 `ctx.web.fetch()` 不能证明本环境已兼容。探测与包原文位于验证目录 `t14-public-rc2-packages`，不进入发布包。

辅助解析参考 [Google Public DNS JSON API](https://developers.google.com/speed/public-dns/docs/doh/json)；现有 Windows 网络策略读取参考 [Microsoft GetSystemWebProxy](https://learn.microsoft.com/en-us/dotnet/api/system.net.webrequest.getsystemwebproxy)；连接与 TLS 参考 [Node HTTPS Agent](https://nodejs.org/api/https.html)。这些文档说明接口，实际通过仍须本项目独立验收。
