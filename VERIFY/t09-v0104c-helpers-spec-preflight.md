# 结论：BLOCK（禁止执行 c proposal/live）

## Findings

- **P1 — `t09-v0104c-renewed-claim-lib.mjs:26,194-235,319-351`；`t09-v0104c-relogin-detect.mjs:55-69`**：要求 claim prepare/apply/marker 固定绑定已审 a restart evidence SHA `327AACB44DFD924EE715C31F6E4A39BA538F0CBD14C4670B00FB579754E5AD32`。实现没有该常量；prepare 将“当前文件”hash 动态写入 manifest，apply/marker/relogin 只与同一当前文件互相核对。触发：在 prepare 前同步替换 a evidence 与 live state 的 accountId/issuedClientId/connectionId，保持 232/539/config572/expired shape；独立受控复现实测仍成功 prepare，并接受漂移身份及另一个 prior SHA。影响：新人工许可可被用于未审证据/账号。修复：在 prepare、manifest 校验、apply、marker、launch/relogin 入口均要求固定 SHA；增加 prior evidence 与 live state 同步漂移负例。

## 已闭合项

b 的三项阻断本身已闭合：登录前后身份均与 prior evidence 比较；新 Task 使用 ROOT `ledgerOf`/`possiblyDispatched` 精确核 tokens/known/unknown/money/unknownPrice/elapsed/callCount/uncertain；失败 cleanup 至多一次 cancel 并确认不再 waiting，且不覆盖原错误。其余预算、两请求、无扩展/重试/刷新/fallback、完整旧历史、29 文件 provenance、重启 availability 审计与全 Zstd frame 读取边界保持。

## 验证

独立 guards 10/10 PASS；MJS syntax 与 PowerShell AST PASS。另行同步漂移反例 PASS，证明固定 SHA 测试缺口。九个非核心文件与 b 版本归一化前缀后逐字相同。未执行 live/RPC/CLI/模型/Git。

## 冻结 SHA256（14）

`apply` 4D7FC654…1307FB；`helper-test` ADDC03A1…8E1525；`helper-lib` 41F2D494…4AA99F；`auth-template` 384F6A14…EAE85F；`launch` EE888B55…77E05；`prepare` D8FDBFEA…F76DFB；`preserve` 05911392…0C023B；`native-read` 7AE23D88…B9A34；`relogin` FED6ABCE…31820；`claim-test` C619A393…2FB60；`claim-lib` D436EC80…3D2AA；`restart` 1C9AD8A8…0E338；`restore` 34A1F1F5…520BA7；`stop` 8886A26F…EDA0E。

## 剩余风险

新审批尚未收到，proposal 未准备；T09 实际仍 BLOCK。
