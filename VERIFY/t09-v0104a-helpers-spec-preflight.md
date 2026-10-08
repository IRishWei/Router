# 结论：BLOCK

## Findings

- **P1 — `t09-v0104a-seal-evidence.mjs:70-77,89-97`**：要求是“seal only AFTER independent installedreviews/rootarchive”，但脚本仅机会式收集当时存在的匹配文件，未要求独立安装评审及 root archive 产物存在、结论/身份匹配，即以 `wx` 创建不可重用的 manifest/checker。触发：final stop 后提前执行；脚本会成功生成宣称 “Reviewed”的不完整封存，之后产出的必需证据无法纳入同一标签。修复：写 seal 前显式列举并校验全部必需评审/归档文件（固定路径、hash、PASS/BLOCK 预期），缺一拒绝；增加 early-seal 负例。

## 需求符合度

其余链路符合：`preserve.mjs:45-93` 全量比较 232 Tasks/539 Calls/config572、DeepSeek、账号/连接/目录/inference/claim，仅排除派生 `nativeDefault.schema`；`:58-62` 持久化 Task 仅去 RPC ledger。launch/stop/restart 固定 purpose/label/stage/home/exe/PID-start、包身份与 29 文件，采用独占证据名，恢复 `DSH_HOME`，不创建 Task、请求模型、OAuth 或重置 claim；seal 校验四个旧保护组。

## 测试与验证缺口

三份 PowerShell AST、两份 MJS `node --check` 均通过；包实测 184530 字节、SHA `E927…662E3`，公开基线实测 232/539/config572/claim 固定/connection=false。未执行 live/RPC/CLI。

## 审阅文件 SHA256

`package-identity` 84810094…F0770F79；`launch` CF11B629…91A917E；`preserve` D24C0C65…847E4940；`stop` 3C2ED610…C947BCBC；`restart` 5E576D60…25AB1ADD；`seal` 350C21EE…62525B10。

## 剩余风险

修复仅恢复证据链前置门禁；T09 实际验收仍因过期授权且旧许可已消费而 BLOCK。
