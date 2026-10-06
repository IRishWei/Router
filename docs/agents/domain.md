# Domain Docs

本项目采用单一上下文布局：
- 根目录 GLOSSARY.md：领域术语。
- docs/adr/：架构决策记录。

## 阅读规则

探索相关代码前，阅读 GLOSSARY.md 和涉及该部分的 ADR。
文件尚不存在时直接继续，不要求提前创建空文档；
由 domain-modeling 在术语或决策明确后按需建立。

命名、规格、任务、测试及方案使用词汇表中的术语。
真实的术语缺口交由 domain-modeling 补充。

方案与已有 ADR 冲突时，明确指出冲突及重新讨论的理由。

若以后引入 GLOSSARY-MAP.md，按其中指向读取相关上下文的
词汇表与 ADR，并同步更新本文件的布局说明。
