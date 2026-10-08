# T11 v0.12.0b 非作者合并记录

结果：PASS

- 固定 base：`0b9ec4fe21cc898d3240b232966bc6838ca041b9`
- 目标分支：`codex/dsh-router-v1`
- 合并前目标：`13b8698a992544c41991f01f10dfe77857fca533`，工作树与 index clean
- 作者分支：`codex/subscription-reference`
- 作者提交：`5b4048dd96237a95ad29d5973c837d60324597f3`，作者工作树 clean
- Standards 最终报告：`t11-v0120b-standards-review.md`，PASS、0 findings，2394 B，SHA-256 `444DAD67272800D4690906CDF97FE6B3527088F7F15A87D417669D4B7C208F8F`
- Spec 最终报告：`t11-v0120b-spec-review.md`，PASS、0 findings，2488 B，SHA-256 `D12C9C56160CD7B64B54C031C3E8BA6F1F78AC6F22589BA39C1A0379B04ED12B`
- 全量日志：`t11-v0120-full-test-20261009-c.log`，410/410 PASS、build/check exit 0，43794 B，SHA-256 `C75445C9DF6A401ACB997A20023E9092855BA1D8F5EDF80A16D3D30EF544B60B`
- 执行：`git merge --no-ff 5b4048dd96237a95ad29d5973c837d60324597f3 -m "Merge reviewed T11 subscription reference accounting (#12)"`
- merge commit：`58fbdc2b17e377fadb711f5fa53deeb9bdaf7699`
- parents：`13b8698a992544c41991f01f10dfe77857fca533`、`5b4048dd96237a95ad29d5973c837d60324597f3`
- merge tree：`bcb2aee8b4f92187d84f6067166da49380b4dd66`
- 作者 tree：`67690a688c8124d32b4020a240a0daee4e72794b`

合并 tree 相对作者 tree 的差异严格只有：

1. `VERIFY/t10-v0110-installed-spec.md`：blob `9a1996b854d420786145d4286c84153e198ad479`，2377 B，SHA-256 `9637D1077688019ABD3C66754E2EE74256D47822142D184A5BDABA5E8FEDFABC`。
2. `VERIFY/t10-v0110-installed-standards.md`：blob `bb610754456015e028ac95abd7c58d350fe4c1c7`，2205 B，SHA-256 `97EB6B9F339CAFA8476DA967890D6CB44F28FA1B1AE4DC5CD3C9464E76F1ED32`。

两份文件的 merge blob 与合并前目标完全相同。合并后分支正确、工作树与 index clean；无冲突、无手工 resolve。未修改源码或旧证据，未 pack、push、关闭 Issue、启动 Desktop 或调用真实模型。
