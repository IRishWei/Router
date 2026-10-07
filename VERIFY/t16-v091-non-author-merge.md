# T16 0.9.1 non-author merge

日期：2026-10-07

## 合入

- ROOT 分支：`codex/dsh-router-v1`
- 合并提交：`8f216a97f60367e85d8882c3fec078562a9f9405`
- 父提交：`cc2de49dfb7e7c64dac314dff5168bc73db38438`
- 作者提交：`42a7620d5803069b1306207b14b48f0e4873a7fc`
- 方式：`git merge --no-ff`，保留作者提交身份。

## 验证

- `npm run check`：通过。
- `npm run build`：通过。
- `npm test`：失败（既有 T05 deadline 测试 1 项；T16 fixed consultation grant 测试 1 项）。总计 287，285 通过，2 失败，0 取消，0 跳过。
  - T05：`test/t05.integration.test.mjs:177`，断言 `0 !== 1`。
  - T16：`test/t16.integration.test.mjs:216`，清理临时目录时 `ENOTEMPTY`。
  失败日志已由命令输出保留；未修改 T05 或 T16 测试。
- 作者树与 ROOT 构建产物 `lib/` 均为 20 个文件；逐文件将 CRLF 规范化为 LF 后比较，差异 0。
- ROOT 工作树：clean（仅相对远端领先本次本地合并提交及既有本地提交）。

## 冻结包

以下包已在目标不存在时复制，并复核字节数与 SHA256；没有覆盖已有文件：

- `artifacts/irishwei-dsh-router-0.9.0.tgz`：159448B，`ED52F806455C941FACD54D5681BADD91C333F081DDC83BBBA7368DCCA287DFC6`
- `artifacts/irishwei-dsh-router-0.9.1.tgz`：160169B，`1D3E99B28B142A45E629C3F371C17C5E2CED53D8D6E58983FB33BE0103BBB575`
- `artifacts/irishwei-dsh-router-native-companion-0.4.2.tgz`：5428B，`BEACD9E24ECDA7568AF25B8A84A7D2AE3EC3B71510E76656E5E6064664B5B76F`

未运行 `npm pack`、bundle；未推送、关闭 issue、操作 Desktop/RPC、修改网络或读取 Key。
