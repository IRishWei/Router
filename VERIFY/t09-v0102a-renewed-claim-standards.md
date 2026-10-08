# T09 0.10.2a renewed-claim 工具最终复审

## 结论：PASS

未发现阻断问题；初版 BLOCK 已在独立报告中保留，本结论仅适用于固定新哈希版。

## Findings

无。

## 需求符合度

- `renewed-claim-lib.mjs:16-31,83-105` 固定 validation root、DSH home/state、owner、Desktop exe、唯一 output 与 state-adjacent marker，并强校验 owner purpose/label/restart/0.10.2/stopped/PID/home/exe；`prepare-renewed-claim.mjs:1-4` 拒绝全部覆盖参数，闭合初版任意目标与假 owner 缺口。
- `lib:107-133` 同时检查 owned PID、精确 executable path 与 Win32 `Name` fallback，`ExecutablePath=null` 不再失败开放。
- `lib:149-198,201-220,240-286` 要求 UUIDv4、固定 artifact 路径、完整 owner/state/proposal SHA、显式授权 flag 与人工批准 manifest SHA；独占固定 marker 防重放，第二次停机检查后以同目录临时文件原子替换。
- `lib:45-70,254-270` 验证 231 Tasks/538 Calls、旧 Task paused/两个 settled Calls，并深比较 proposal 只能将旧 `lastDetectionTaskId` 改为 `null`；旧 Task、Calls、maxCalls、usage、config/account 等均不变，不自动扩充既有授权。

## 测试与验证缺口

固定哈希与委托值一致。独立运行合成 guard 2/2；另验证嵌套 output、错误 owner label、即使重新批准 SHA 的篡改 marker manifest 均被拒绝（3/3）。未运行 live prepare/apply，未读取真实 state/approval/凭据。

## 剩余风险

工具当前只具备安全 staging/apply 边界；prepare 尚未 live 运行，apply 必须等待新的明确人类授权。它不证明真实 Responses 成功，T09 仍应 OPEN。
