# T09 0.10.6 非作者合并记录

由独立集成执行者 `/root/t09_v0105_merge` 完成；未参与本次实现或独立双轴审查。

- 集成分支及原 HEAD：`codex/dsh-router-v1` / `de10788f42cd772f54a57b55f6642dfd2697ebe2`
- 审查基线：`e7b2cd7e67ca98b068ecfd3b5a6f464ceca1adf6`
- 作者提交：`91932319c8958f2d3273bf4330d4b84a20ffb1fb`
- 非作者合并提交：`e6f5b354d75aadddca1cfafbb7d2b1c045190f9f`

合并前核对两分支精确身份，根目录无 tracked/staged 改动，作者工作树完全干净。双轴原报告均 PASS 且绑定精确基线/作者提交；Standards SHA-256 `8A5DE3F8C61E1D0D4EE366C5DFE5419881D6BA467E5B3E6F8387C427C4891E20`，Spec SHA-256 `F6267FE4CFC1259D3A9BF014943CFC34715332D03C54FA939BC798D7DBF12BD3`。

以 `git merge --no-ff` 合并，无冲突或源码改写。相对原 integration HEAD 仅改变已审的 adapter、两个测试文件及 package/lock 版本这五个文件。根目录已有十份未跟踪报告逐一按 SHA-256 核对保留；未 stage 或提交它们。

build/check 沿用作者验证；已核对全量原日志为 341/341 PASS、0 fail，34988 bytes，SHA-256 `3C4754A6304BD8105A5F200BFC3308E31B7D5374F97658F6A6551620EC5744B3`。Standards 独立聚焦 28/28，Spec 独立新增测试 3/3 及 check PASS；本次未重复全量测试。

本版本仅补充脱敏比较元数据、在非法终态输出时结算合法 reported usage。严格终态一致性和 inference confirmation 门槛未放宽；没有修复或证明修复真实 completed/stream 分歧。0.10.5b 实际结果继续 BLOCK，T09/#10 保持 OPEN，既有 1 Task / 2 请求许可已消耗，无新增真实调用许可。

本次未 push、装包、启动 Host、发起真实请求、读取凭据或 Codex 配置，也未修改网络及用户数据。本记录在临时目录独占创建并原字节复制到 VERIFY，暂不提交，留给主任务统一归档。
