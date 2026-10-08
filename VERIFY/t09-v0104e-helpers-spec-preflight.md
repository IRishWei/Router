# 结论：PASS（仅允许 prepare-only；未获新人工许可时禁止 apply/auth/Task）

## Findings

未发现阻断问题。d 对 raw/public 连接形状的误判已修复。

## 需求符合度

- 固定 public a evidence 仍严格绑定 10073229 字节/SHA `327AAC…E5AD32`。E 从通过 pin 的 public bytes 派生 accountId、issuedClientId、connectionId，并要求 public provider 精确；raw state 允许省略派生 provider/available，但若显式 provider 错误则拒绝。
- prepare/apply 均将 pinned public Tasks 仅移除顶层 `ledger` 后与 raw Tasks 全量深比较，并对完整 config 深比较；三身份、connection→account 绑定、旧 232 Tasks/539 Calls/config572/claim 也保留。proposal 仍只把 claim 改为 null。
- 实际 raw state 实测 9022698 字节/SHA `F8D4B0CE…47C410`，连接键仅 `accountId/configRevision/connectionId`；其 Task 投影、config 与三身份均匹配 pinned public evidence。d 失败记录保留且 E proposal/human authorization/marker 均不存在。
- canonical ledger、OAuth waiting cleanup、一 Task/两请求/65536/120000、forecast 非硬 cap、无 extension/retry/refresh/billing fallback、owner/provenance/restart/decoder 等 d 边界保持。

## 验证

fixture-only guards 11/11 PASS；MJS syntax 与 PowerShell AST PASS。测试使用实际 raw bytes 的只读副本并仅在临时目录 prepare/apply；外来三身份、显式错误 provider、Task/config 及同步 prior+live 漂移均在 proposal 写入前拒绝。未执行 live/RPC/CLI/模型/Git。

## 冻结 SHA256（14）

- `apply` `B3EDAB40D83683F1A3D015DD4E5B209C221CEB8B764BC67C56302656352C3DB3`
- `helper-test` `179121B109F26B40628856609211DFBA184E719813918FD0EA95D7DB2706B27E`
- `helper-lib` `41F2D494D1A45F74252E7B9BB7B725FF62AAD8230DD3F507AFD3A9FC404AA99F`
- `auth-template` `FDCDD7C474671767DC74DD28CFA16B0EA6856453EA73B33514555544609BABEC`
- `launch` `BEEBD0AF5273C0429246DDEC5AD289122D979317101C3704D1B4134FB5DA19B4`
- `prepare` `663F6ABEFF8BC6B97002D2F97136B6BD4EEEC182015A2BC5606391901838A456`
- `preserve` `C1792483C3B63ABB258C845A0AAA3353E681675841AEDDE85244F3AEA0E2DCA7`
- `native-read` `99A63F1F8D0889304F7B8001AD99E957FA1951067A8525026230D449EABA115F`
- `relogin` `848E557AD338BC4C92F578C5213375D3AFDAECC4B09E47825508400F6334AD46`
- `claim-test` `DF7FA8407CFCB7A408E481AF6BDA59EADB68C75C3DB39D13F385807EA68DB54A`
- `claim-lib` `F804C1066C695E02BED85A928D2EF1A3A6E880EED880439C5201C04709FC201C`
- `restart` `CB963D34573D857CF88BBCCF270FF9B574EAB386B06C61FF63F40B5CAA550700`
- `restore` `86EEDD3DB518BF0C288D8C25D328A4E2CEFA27D361374463B3BE937C4FAADE55`
- `stop` `707917D259F893DC282C207C0524562C629EF19BD7AC19AB3389F48AD8174D4E`

## 剩余风险

新人工许可仍未收到；prepare-only 不重置 claim。T09 实际仍 BLOCK。
