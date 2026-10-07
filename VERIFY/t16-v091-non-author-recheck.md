# T16 0.9.1 non-author recheck

日期：2026-10-07

本次复验未构建、打包、修改业务或测试代码；此前 `VERIFY/t16-v091-non-author-merge.md` 保持不变。

## 独立复验

- `node --test test/t05.integration.test.mjs`：通过，9/9，退出码 0。
  - 完整日志：`C:\Users\a1500\AppData\Local\Temp\router-implementation\t16-v091-t05-recheck-20261007-1855.log`
- `node --test test/t16.integration.test.mjs`：通过，12/12，退出码 0。
  - 完整日志：`C:\Users\a1500\AppData\Local\Temp\router-implementation\t16-v091-t16-recheck-20261007-1855.log`

此前全量并发运行中出现的 T05 deadline 计时失败与 T16 Windows `ENOTEMPTY` 清理失败均未复现。

## 串行全量复验

- 命令：`node --test --test-concurrency=1 test/*.test.mjs`
- 结果：通过，287/287，0 失败、0 取消、0 跳过，退出码 0。
- 完整日志：`C:\Users\a1500\AppData\Local\Temp\router-implementation\t16-v091-full-serial-recheck-20261007-1855.log`

未执行 push，未操作 Desktop/RPC、网络设置或 Key。
