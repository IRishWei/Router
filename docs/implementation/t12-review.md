# T12 双轴复审

固定范围 `1ab2ab1524a9a160b4943eb3f8c6541641d14243...c9509aa82e5cbe0eb7eee0496f6c0709059ce2b3`。初审目标 `f47002bd305914b21ceffc285272c0dcea8165f8`，同一组非作者审查者分别复验修正增量；集成提交为 `47e8893c0902355a02ca19b79982f7928341619c`。

Standards：0 强制规则违规。保留六项非阻塞 Fowler 建议：目标枚举重复、pending 字符串哨兵、UTF-8 字节估算命名为 contextTokens、身份/revision 比较重复、判断载荷与 revision 职责分散、输入元数据与活动明文分别管理。没有将这些建议当作仓库硬规则。

Spec：最终 PASS，0 剩余代码阻塞。初审发现判断仅含 fixture 提示而未携带实际 Task 正文，以及 assessor 使用手工投影快照，两项均修复。真实 Controller 复现确认判断输入包含用户正文；普通公开一次性请求、16 KiB 限制、长 await 后输入版本复查及唯一 Host capture 均有回归。

作者及非作者合并验证 `npm test` 143/143、`npm run check`、`git diff --check` 通过。最终0.5.1的18项实际桌面用例及完整历史/配置重启检查通过，见 [安装证据](t12-installed-host-evidence.md)。0.5.0诊断包未安装，不沿用其初审阻塞结论认证最终包。
