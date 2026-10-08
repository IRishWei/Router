# 结论：BLOCK（v2）；尚未 detect

预算、identity、retry 与 fallback 的补强方向正确，但 v2 会确定性拒绝生产生成的合法 ChatGPT Task。已完成的只读 baseline 仍有效；T09 保持 OPEN。

## Findings

- **P1 — `t09-v0102b-helper-lib-v2.mjs:9,68-80`**。契约要求从相同账号调用官方 Responses；生产实现把 provider 定义为 ``router-chatgpt-${accountId}``（`src/chatgpt-host.mjs:13,22`），既有真实 Task 的 capture、active selection、两 Call selection/snapshot 也采用该动态值。v2 却固定要求 `openai-chatgpt-oauth`。触发：运行任何合法 b 轮真实 Task。`assertRenewedTask` 会在 provider 断言失败；`restore-config-v2.mjs:29-35` 随即在公开 RPC 恢复配置前退出，唯一授权请求已消耗却无法形成 restore/restart 验收链。修复应从 baseline `accountId` 推导生产 provider，并继续要求 capture/active/Calls/snapshots 全等；正例 fixture 应使用真实动态形状，另加固定 `openai-chatgpt-oauth` 的拒绝用例。

## 需求符合度

`t09-v0102b-helper-lib-v2.mjs:49-80` 已精确检查 65536/120000、money/extension 空、`maxCalls=2`、forecast 2048（仅预估）、不超过两 Call/派发、无显式 retry、subscription billing、baseline account/connection、candidate 与每 Call snapshot。v2 preserve 禁止 capture，只处理 restore 后及 restart（`t09-v0102b-preserve-v2.mjs:13-46`）。初版文件保持原字节；v2 四个 SHA 与任务给定值一致。未见其他 scope creep。

## 测试与验证缺口

guard 正例把同一错误常量写入 fixture（`t09-v0102b-helper-guard-v2.test.mjs:32,69-105`），故 3/3 通过不能发现生产形状不兼容。按要求未执行 live helper、进程或模型调用。

## 剩余风险

修复 helper 只保证授权与证据边界；实际 `response.completed` 和真实非 SSE 原因仍待唯一 b 轮验收。

冻结 v2 SHA-256：lib `F230C08C60E69A14923C8646417CD8A98D30026F5E85710653DCC4576E5FE17B`；guard `B54945427E3A0F43A712CA220E05088855F55077A24511A704454CB4B9AD7658`；preserve `0EC172866E16561EA835715F99ABA16057881E41A13EEB6F1E5F753DD1138C34`；restore `97FEA96BB53610D49DA95000D3ADA1EB7D7BE0FD9FD32267E88DF07F4FB4B298`。
