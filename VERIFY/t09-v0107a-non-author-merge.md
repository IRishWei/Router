# T09 0.10.7 非作者合并及打包记录

独立集成执行者 `/root/t09_v0105_merge` 未参与实现或双轴审查，仅执行已审提交的合并、构建和主包打包。

- 集成分支 / 原 HEAD：`codex/dsh-router-v1` / `fc2579ad2f68b40f3f30c2193ab89b67549eb51f`
- 审查基线：`91932319c8958f2d3273bf4330d4b84a20ffb1fb`
- 最终作者 HEAD：`a75394e8ea7dc60b543f53c3967d0aa668180296`
- 非作者合并提交：`d9e3f4069a83b08cd53d7c66f7ef6c5afdf0c90e`

原候选 Standards BLOCK 时未合并。修正 itemId/outputIndex/contentIndex 关联后，v2 双轴均 PASS 且绑定上述精确身份：Standards SHA-256 `CE33AF48BFCD1E14EB29DEDE143FFE871C28D849D69832411FFB067244927078`；Spec SHA-256 `90899EAC9C038B841411FFEC36B411A8607299153F44F1A16088B29FA5014372`。原 BLOCK 及所有原报告保留。

核对根分支及作者工作树均干净后，执行 `git merge --no-ff`，无冲突、无源码改写。相对 integration 原 HEAD 仅包含声明的六个文件。source 全量原日志为 345/345 PASS，35646 bytes，SHA-256 `0FE2E0B86F5A836110EFB9C948BA0ED67BECE0C9A3038B636248C0EA0F9BB896`；未重复全量测试。

在 root 顺序执行 `npm run build`、`npm run check`，均退出 0，再执行 `npm pack --pack-destination artifacts --json`。只打主包，未运行 bundle、未重打 companion。companion 生成文件 SHA-256 仍为 `4D34D6301355FCE62EA51BADE6454503A8C1214F4DBB3DA0EAA513EE64CC3FB4`；44 个已有 tgz 均按 SHA-256 核对保持一致。

主包：`E:/GPT/Router项目/artifacts/irishwei-dsh-router-0.10.7.tgz`，185622 bytes，29 entries，SHA-256 `C59537DF4C82D2C0DA36275155FC4AAF6B12B6D55EBE80569A1A5A03C4EBCAC8`。

完成后 root 在合并提交、tracked/index/工作树均干净；作者工作树仍在最终作者 HEAD 且干净。本记录仅在临时验证目录独占创建，未 stage 其他文件。

受控源修复不代表实际接入成功。T09/#10 继续 OPEN；真实验证由主任务在剩余 verification 1 Task / 2 请求范围内执行，成功后停止。本次未 push、装包、启动 DSH/Host、发起真实请求、读取凭据或 Codex 配置，未修改网络或用户数据，也未推进其他任务。
