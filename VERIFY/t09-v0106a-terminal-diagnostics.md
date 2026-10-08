# T09 0.10.6：终态诊断及失败用量结算

2026-10-09。此候选补足诊断与已知用量结算；真实 0.10.5b completed/streamed 分歧尚未查明或修复，#10 保持 OPEN。

## 触发与行为

0.10.5b 的唯一真实 Task 已接收并关闭 `CHATGPT_CONNECTION_OK` 文本块，随后因 `Completed Responses output disagrees with streamed output` 暂停。原生会话不保存 terminal response 的完整 output，现有证据不能判断缺块、多块或内容差异。完整实际结果及独立 BLOCK 结论见 [真实结果](t09-v0105b-real-result.md)。该轮 1 Task / 2 请求许可已用完。

0.10.6 保留全部终态输出一致性检查，在不一致时补充固定结构的比较元数据：两侧块数、首个差异位置、类型、UTF-8 字节数及匹配布尔。诊断不含正文、call ID、工具名、参数或其哈希。输出仍必须严格通过校验后才能发出成功 finish 或确认 inference。

终态 output 校验失败时，若该终态已经报告合法 usage，先将它交给统一账本再抛出原失败；缺失 usage 继续未知。此改动不追填 0.10.5b 或更早调用的未知用量，也不自动重试、扩预算或切换 API Key。

## 固定身份与验证

- 作者提交：`91932319c8958f2d3273bf4330d4b84a20ffb1fb`；基线 `e7b2cd7e67ca98b068ecfd3b5a6f464ceca1adf6`。
- [非作者合并](t09-v0106a-non-author-merge.md)：`e6f5b354d75aadddca1cfafbb7d2b1c045190f9f`，无冲突、无源码改写。
- [Standards](t09-v0106a-standards-review.md) 与 [Spec](t09-v0106a-spec-review.md) 均 PASS，无发现项；分别独立执行相关 28 项及新增 3 项测试。
- 作者先以 `node --test --test-name-pattern 'contradictory completed output' test/t09.responses.test.mjs` 观察未实现比较元数据的失败（0/1），再通过新增 3 项聚焦测试。fixture 只复现受控错误分支，不代表已捕获真实 terminal payload。
- 新增测试覆盖四种冲突 output 的脱敏比较、合法与缺失 usage、unsupported output，以及完整原生 Task 暂停后结算 18 tokens、零 retry、零 inference confirmation。
- 全回归 341/341 PASS、0 fail；原日志 `t09-v0106a-full-regression.log` 34988 bytes，SHA-256 `3C4754A6304BD8105A5F200BFC3308E31B7D5374F97658F6A6551620EC5744B3`。合并后 build/check PASS，未重复已通过的完整回归。
- 包 `irishwei-dsh-router-0.10.6.tgz`：184985 bytes、29 文件，SHA-256 `D6A5F7ACCE4E6B42F69F8AD69CC997CF5BA455E4E1183471A1CA59F4CAE1BC56`。独立原件保存在临时目录 `t09-package-20261009-0.10.6`。

下一次真实验收须取得新的有界许可。离线测试、审查及装包不能认证真实推理成功。
