# T17 Standards r2

PASS：当前固定源码的 Standards 硬违反为 0；r1 的 1 项硬违反已关闭。修复 delta 新硬违反 0，有实际影响的 Fowler smell 0。

集成 base：`3a8d9891fd11e1b4e2fd4621a32ad5204996d963`。
固定 HEAD：`e26ac7ec3c518ce945da382f36ec147d10a82276`（起始确认一致）。
本轮仅审 `git diff 6e1b6ca925044f058fe19963ea2fbbe82bd2fa9c...e26ac7ec3c518ce945da382f36ec147d10a82276`；源码使用 `t17-review-e26ac7e` 固定快照。提交为 `e26ac7e fix: retain native tool evidence without a definition (#18)`；其前置为 `6e1b6ca feat: add bounded same-task context takeover (#18)`。

r1 关闭依据：`src/takeover.mjs:351` 在 definition 查询前保存冻结 ancestry/taskOwners；`:302` 从独立 ancestry 检查 unsettled，缺定义的等待 child 也不能被 outer completed 掩盖；`:364–371` 在 result 中结束该 token，优先采用自身冻结 ancestry，并为没有 pre-execute 的 early result 汇集活动 matching root 的可能 Task owners。`:379` 保留真实 error 的 unknown 状态及实际公开错误码，没有把可能归属变成执行许可。这满足 `README.md:62`「未知工具结果明确暂停，不能由外层工具成功掩盖」与 `docs/implementation/t17-takeover-contract.md:43,45` 的工具树完整性及冻结归属规则。

SDK 路径区分准确：普通缺定义且参数可 JSON 化的 UNKNOWN_TOOL 仍经过 pre-execute；参数不可 JSON 化的准备错误直接发 result，跳过 pre-execute/guard。新增完整 Native Task 三项测试分别覆盖组合缺定义、尚未 result、early result；预先接受的公开 seam 未改变，断言观察 Task/RPC/公开工具结果和本地 adapter 派发，不耦合 Router 私有方法。

已对四个 delta 文件应用全部 12 项 Fowler baseline，仓库规则优先、判断式使用，跳过工具已强制项；必要的保守归属与状态分支不构成 smell。文档明确保留旧失败及各阶段证据，没有用 530/532 的旧回执冒充最终结果。

已读取三组实际 red/green、最终 533/533（75.846s）及 build/check/diff-check 回执。本轮未新增运行、修改或合并源码；只新建本报告，r1 保留。未打包、安装/启动 Desktop、请求生产模型、读真实 key/profile 或 Codex 配置、使用 Computer Use。PASS 仅限源码标准与修复 delta；目标 Desktop、官方 API、第二账号、provider wire、视觉质量及真实效果仍未由本报告证明。
