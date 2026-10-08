# T11 r3 real-preflight 独立 Spec 复审

Pin：helper manifest SHA-256 `6061ECB9540E196B1C7B288642C860991FD22ED2AB80F811083BD94D5B19520E`；源码 `5b4048dd96237a95ad29d5973c837d60324597f3`；归档 `e6fc853dc0024ef2f0d8b388344881d4605c69c9`；当前root `5294a4aed5d150e1cae1ceb4b101246bb703fe26`；包 `47AE4C313FFF8C030465008C9DEC554BD161622497B9925AF1FC51F2D3AAF7E8`。旧源码/受控结论沿用。

**准备阶段累计 Spec PASS；missing / partial / scope creep / wrong 均0项，无未解决findings。r及r2的FAIL原件保留，所列问题已关闭。**

符合 #12“按实际返回用量和可信同模型价格映射计算订阅参考价值”“缺失……显示未知”及契约第9—11行。独立oracle未导入产品计价模块，以冻结Sol整数费率核对分区、272000档位、推理重叠、Call/Task金额与小计。`t11-v0120r3-usage-oracle.mjs:36` 拒绝部分缓存和超过聚合输入；`:67–76` 校验reported total，只有完整分区且reasoning===0才推导，否则要求Task total为null。

独立11项guard/oracle测试PASS。四个旧反例纯内存重验均被拒绝：空usage、金额999、cacheRead2000>aggregate1000、缺Call total但账本999999。合法缺项保持完整额未知/小计0.00052，合法零推理完整分区可推导total1050。

另经完整acceptance内存stub确认：已知价0.00217通过；四个失败均保存passed=false/unconfirmed、exit1。waiting-budget原Task被精确stop，检测入口各仅一次。`:75` 的oracle位于passed之前，真实用量缺失不会冒充验收完成。

18份辅助哈希和新home的31个安装文件吻合；官方offline收据成功，无fixture、grant、owner或model intent。15份其余helper相对r2仅改家族路径，许可与恢复边界保持：一次wx intent、1Task/2Requests、65536token/120000ms、无输出硬限/retry/扩额/API后备；官方浏览器stdin、已安装只读Renderer、配置/历史/默认/claim恢复及重启、严格owned退出不扩张。旧166文件/state保护入口保留；r/r2共33份helper及两份FAIL报告哈希不变。

本轮未启动真实phase、Desktop或浏览器，未生成human grant；内存复现无文件/网络/子进程。PASS仅表示准备符合规格，不替代人工许可或实际验收。T11真实门槛仍pending，T10生命周期不在提案范围，#11/#12保持打开。报告CreateNew（wx）新建。
