# T09 0.10.2a renewed-claim 工具初版复审

## 结论：BLOCK

审查快照：lib `EC9DC01D…9982`、prepare `97FC92C5…145`、apply `D4B6E370…B557`、guard test `C3D3B24F…C7F`。

## Findings

- **P1 — `t09-v0102a-prepare-renewed-claim.mjs:4-18`; `t09-v0102a-renewed-claim-lib.mjs:94-110,139-146,174-204`：写入目标和停机身份均由 CLI/manifest 任意指定。** 初版只 `resolve` 路径、检查字符串非空和 PID 为正；未绑定已安装普通 Router state、owner purpose/label/version、真实 owner PID/exe，也未验证 manifest、backup、proposal、marker 的固定路径关系。未来即使提供授权 flag 和 manifest SHA，错误 state、假 Desktop exe、已退出 PID 仍可通过，并原子覆盖另一份具有相同 Task 形状的 JSON；实际 writer 运行时还会形成竞态。应固定并规范化 live state/owner/exe 边界，校验普通 Router 所有者元数据与文件类型，要求 staging 文件同目录关系、固定 marker 派生式、各路径互异，且 `rotationId` 必须为 UUID 后才允许替换。补充 wrong state/exe/PID、路径穿越/UNC/reparse、篡改 manifest 路径与 marker 的拒绝测试。
- **P2 — `t09-v0102a-renewed-claim-lib.mjs:57-68,75-77`：Windows Desktop 检测对 `ExecutablePath=null` 失败开放。** CIM 无法返回路径时该进程被忽略，目标 Desktop 仍运行也可能通过。查询并绑定 `Name`，对目标 executable name 的空路径记录拒绝；测试 null-path/name fallback。

## 需求符合度

`lib:24-49,174-190` 可确认 231 Tasks/538 Calls、旧 Task paused/两 settled Calls，并以深比较限制 proposal 只清空 `lastDetectionTaskId`；未提升旧 Task maxCalls/usage。`lib:165-170,191-206` 具备显式授权、manifest SHA、独占 marker 与同目录临时文件替换，但上述身份/路径缺口使其尚不可用于 live state。

## 测试与验证缺口

合成 guard 1/1 通过；它在 `guard.test.mjs:33-43` 主动使用任意临时 state、假 exe 与注入的空进程表，因此不能证明生产所有权或 Windows 路径边界。未运行 prepare/apply，未接触真实 state、approval 或凭据。

## 剩余风险

修复前不得 staging 或 apply；旧失败 Task/Calls 必须继续原样保留，新授权不得由工具自行推定。
