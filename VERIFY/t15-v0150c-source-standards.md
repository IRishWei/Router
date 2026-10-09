# T15 源码 Standards 最终复核

结论：**PASS，0 findings（硬违规0，判断性气味0）**。原P3已解决，无新增finding。原 `t15-source-standards-review.md` 保留不覆盖；完整b588f0d审查与此单行复核共同构成新候选的Standards结论。

固定worktree：`C:/Users/a1500/.codex/worktrees/t15-image-acceptance/Router项目`。
原完整审查BASE：`216b49684a80d2350b730549f8c8402fe77ea0ed`。
原候选：`b588f0d51bd4c3f8773a4a0801f35d02ce632035`。
新候选/实际HEAD：`2219efb7211bd4965777d919374bac10767bcee0`，工作树干净。
增量命令：`git diff b588f0d51bd4c3f8773a4a0801f35d02ce632035..2219efb7211bd4965777d919374bac10767bcee0`。
提交仅 `2219efb fix: name cross-domain acceptance validation evidence`；diff仅src/acceptance.mjs一文件、一行替换。

[acceptance.mjs:246](C:/Users/a1500/.codex/worktrees/t15-image-acceptance/Router项目/src/acceptance.mjs:246) 将跨域CONTRIBUTOR_INVALID evidence的rule从`research-contributor-validation`改为`acceptance-contributor-validation`。中性名称现在准确覆盖research/image等Host contributor的校验失败，解决原Fowler Mysterious Name判断。domain.md:13“命名、规格、任务、测试及方案使用词汇表中的术语。”与GLOSSARY“验收证据”的范围不再被该标签误导。

没有修改判定、source.kind、checkerVersion、要求/证据身份、预算、Call、候选、派发或历史保存；失败仍为unconfirmed。只读rg确认src/test无其他旧rule引用，未发现依赖旧标签的控制分支。除这处原P3修复，固定原候选的其余Standards结论沿用，未扩大复核范围。

root报告既有39/39图像回归与build/check PASS；本reviewer没有重跑或读取验证日志。未执行测试、安装、启动、RPC或模型调用，未读凭据/私有日志/Codex配置或认证，未使用Computer Use，未改代码或GitHub。唯一写入本外部最终笔记。