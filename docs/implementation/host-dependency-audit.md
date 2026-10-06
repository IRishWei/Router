# 目标宿主依赖审计

2026-10-07，集成 `0256d4f` / Router 0.3.3。`npm audit --json` 返回12个受影响包节点（5 high、7 moderate、0 critical），对应两个根源公告；包节点数不是独立漏洞数。链路来自固定的 `@deepseek-ai/dsh@0.2.0-rc.2` peer及其MCP、office依赖。

只读核对实际Desktop公开安装库 `app.asar/dsh/node_modules`，确认目标build `04f392c9ddd144fa426da2045178797da6db6c11` 内含 `@modelcontextprotocol/client@2.0.0`、`@modelcontextprotocol/core@2.0.0` 和 `fflate@0.8.2`。只读取这些包的package元数据，未读取用户profile、OAuth记录或凭据；采用隐藏的Electron Node模式，未使用Computer Use。

| 根源 | 实际版本 | 上游证据与影响范围 |
| --- | --- | --- |
| MCP OAuth issuer绑定 | client/core 2.0.0 | 维护者公告指出受影响HTTP OAuth客户端可向MCP server指定的另一授权服务器发送既有OAuth凭据；stdio客户端不在该影响范围。修复需client/core 2.2.0及issuer正确持久化，旧无issuer凭据和部分provider仍需额外处理。[维护者公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) |
| ZIP64边界处理 | fflate 0.8.2 | 畸形ZIP64可能使unzipSync无限循环；0.8.3包含Zip64 extra field越界修复。[漏洞记录](https://github.com/advisories/GHSA-px8p-9vwx-vf98)、[维护者0.8.3发布说明](https://github.com/101arrowz/fflate/releases/tag/v0.8.3) |

本次预算验证仅使用隔离home、本地模型及公开localhost RPC，没有连接外部MCP OAuth服务器或处理不可信ZIP。未证明用户环境受到利用，也未认证目标Desktop的整体安全性。Router bundle复用宿主runtime；只调整开发依赖不能证明实际宿主已修复。

T24交付前须记录这些上游问题的处置及实际安装库证据。修复需维持或重新验证目标宿主、peer和SDK契约；`npm audit` 提示部分宿主链路需跨主要版本调整，因此不能将未验证的依赖替换当成兼容完成。当前审计保持未解决，不改写原目标版本或宣称漏洞已消除。

安全原始记录位于本次temp目录：`npm-audit-v033.json`、`npm-audit-mcp-chain.json`、`npm-audit-fflate-chain.json`、`runtime-audit-versions.json`。未修改Codex配置、认证或正常DSH安装库。
