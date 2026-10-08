# T09 0.10.5 Spec 审查

## 结论：PASS

未发现阻断问题。本结论只确认源码修复符合规格；不代表真实套餐请求已恢复，也不满足关闭 T09/#10 的实际目标宿主门槛。

## Findings

无。

## 需求符合度

- 合同要求“`store:false`、`stream:true`，只以 `response.completed` 作为完成依据”（`docs/implementation/t09-chatgpt-oauth-contract.md:17`）。请求字段仍由 `src/chatgpt-responses.mjs:205-217` 固定；新逻辑仅在成功响应缺少媒体类型时进入现有 SSE 解码器（`:699-725`），完成事件仍经过状态、输出和用量校验（`:534-573`）。
- 显式 JSON、HTML及其他媒体类型仍拒绝；缺头的空、JSON、HTML、畸形、未完成正文均不能产生 finish/usage（`test/t09.responses.test.mjs:302-379`）。未发现将失败误判成功、泄露响应正文或新增 API Key 回退。
- DSH 集成测试覆盖缺头两请求工具往返、失败暂停、单次派发、未知用量保持 null（`test/t09.integration.test.mjs:83-139`）；零重试仍由 `src/chatgpt-responses.mjs:9` 和集成测试 `:141-160` 约束。
- 改动范围限于适配器、定向测试、版本号及新增验证说明。七组冻结证据保护检查均 PASS；diff 未改旧验收记录或持久化历史。

## 测试与验证缺口

独立运行三个聚焦测试文件，26/26 PASS。未重复 338 项全量回归。缺头且 `response.completed` 不含 usage 的完整 DSH 成功路径没有专门用例；现有共享结算逻辑应保持 null，但可在后续补强。

## 剩余风险

0.10.4e 的真实响应正文未保存，无法证明当时正文是合法 SSE；因此该修复只消除已复现的过严 Content-Type 门槛。`VERIFY/t09-v0105a-unlabelled-stream-fix.md:5,39` 正确保留这一限制并要求新的有界真实验收后再判断 T09。
