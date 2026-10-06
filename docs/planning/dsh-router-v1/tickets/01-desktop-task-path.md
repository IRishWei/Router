# T01：桌面插件安装与最小完整任务



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

从桌面安装插件，启用一个可控模型完成任务，查看模型选择与结果；关闭路由后保留原生执行和设置入口。

## Acceptance criteria

- [ ] 在 Windows DSH Desktop 0.2.0-rc.2 通过原生插件管理安装并启用最小 bundle；配置页可加载，不要求用户修改桌面依赖。
- [ ] 使用宿主已有 Framework 实例；通过可控响应完成一次任务，显示实际 provider/model、结果与简短记录，不发真实计费请求。
- [ ] 原生 session controller 与插件只有一个有效选择；组装请求与状态显示一致，自动选择不改写全局默认模型。
- [ ] 启用/暂停路由、重启和停用均可验证；暂停仍保留设置入口和有效原生路径。
- [ ] 建立一次完整任务的外部测试入口，证明选择一致、配置持久化与基础故障状态；不把模拟结果当作真实 provider 已可用。
- [ ] 不读写 Codex 配置或认证；记录宿主接入证据及无法成立的契约。

## Blocked by

None (can start immediately).
