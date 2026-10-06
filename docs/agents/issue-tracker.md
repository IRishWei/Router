# Issue tracker: GitHub

规格与任务存放在 https://github.com/IRishWei/Router/issues。
使用 gh CLI 操作；通过 origin 识别仓库，必要时显式指定
--repo IRishWei/Router。

## 常规操作

- 发布规格或任务：创建 GitHub Issue。
- 获取任务：gh issue view <number> --comments。
- 列出任务：gh issue list，按状态与标签筛选。
- 添加评论：gh issue comment <number>。
- 更新标签：gh issue edit <number> --add-label / --remove-label。
- 关闭任务：gh issue close <number>。
- 多行正文写入临时文件，使用 --body-file 提交。
- 状态标签遵循 triage-labels.md。

## Pull requests as a triage surface

PRs as a request surface: no.

Issue 与 PR 共用编号；引用编号含义不明时，先尝试读取 PR，
再读取 Issue。

## Wayfinding operations

- Map：使用 wayfinder:map 标签的总览 Issue，
  包含 Notes、Decisions-so-far 和 Fog。
- 子任务：通过 GitHub sub-issues 关联到 Map；
  不可用时，在 Map 使用任务列表，并在子任务写 Part of #<map>。
- 类型标签：wayfinder:research、wayfinder:prototype、
  wayfinder:grilling、wayfinder:task。
- 阻塞关系：优先使用 GitHub 原生 Issue dependencies；
  API 中使用 Issue 的数字数据库 ID，而非编号或 node_id。
  不可用时写 Blocked by: #<number>。
- 可执行任务：处于打开状态、无未关闭的阻塞项且无人领取，
  按 Map 中的顺序选择。
- 领取任务：先指派给执行者，再开始工作。
- 完成任务：评论记录答案，关闭 Issue，
  并在 Map 的 Decisions-so-far 添加结论及链接。
