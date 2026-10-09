# T07 兼容连接契约

规格为GitHub #8。2026-10-09用户选择Go开发主线：T07原生前置改为已完成#26；官方API #7和第二账号生命周期#11保持打开，增加为最终交付#25的阻塞项。变更仅开发顺序，不追加真实调用许可。

0.14.0提供最多20条独立兼容连接，API基础地址、手动模型ID、可选GET /models发现、声明工具支持。仅Responses SSE文本/函数协议；图像、Chat Completions、采样参数不支持。生产传输仅公共HTTPS，loopback由本地受控传输验证。地址不能带认证、查询、fragment或具体接口后缀；官方API/OAuth必须使用各自入口。

凭据属于DSH Host独立credential owner，提交密码后清空，不复制或读取既有Go/OAuth凭据。保存/连接不发推理；目录发现是显式、10秒/256KiB限制、无重试，目录内容不证明能力或推理资格。断开/凭据更改撤销候选和prepared stream；删除保留元数据和已消耗的检测claim。

每连接检测最多1Task/2Call（含标题）、32768token/60秒、每次输出1024，禁止扩额或重试；Go地址检测需Use balance关闭声明。普通兼容任务要求有限token/耗时预算，以完整原生system/history/runtime/tools输入作保守预留，辅助调用同样计入Task。所有stream带稳定sessionId、自有User-Agent，禁止重定向或fallback。

同模型/不同来源具有独立provider和五元身份。普通任务和检测使用现有Controller/账本/资格与预算边界；容量仍未知，不伪装已验证。用户可在页面输入带来源/日期的普通输入与输出参考费率，缓存/推理未知保持未知，总金额不冒充实付或Go套餐扣减。

受控验证覆盖文本/工具往返、标题、已使用claim、目录错误/反射凭据、断流/非SSE/限流、禁用/无限预算/不支持内容、凭据撤销与重启。真实Go0.13.1证明保留，仅认证此前固定Go路径。包冻结时本版自定义路径尚待单独真实验收，当时#8不能仅凭受控证据提前关闭；后续实测结果如下。

固定源码`9c7269ff63dc48fe56e1c6199df2a7df1af88ad9`，0.14.0包SHA256 `C126B2B9F03CF0536A971151979FCE4C9BE34F2F6E9061C77B8551EE56A4CB58`（213623字节/35文件）。最终434项全套、build/check及源码/安装两路独立复审通过。官方离线CLI安装后Desktop完成5个Task、9次本地Responses、2次目录、1次工具执行；重启保留任务/claim，删除受控测试凭据并停止隔离进程。两次发送阶段断言和首次renderer异步等待失败均保留，验证脚本修正未改包；renderer无截图验收。受控验证轮真实请求0，完整证据位于`VERIFY/t07-v0140-validation-summary.json`及相应review/desktop文件。

2026-10-09用户单独批准本轮Go有界真实验收并在独立DSH密码页保存Key。冻结包不变，新隔离profile无fixture，唯一已连接Go条目运行1Task/2完成请求（检测1454＋标题208＝1662token），3557ms；精确返回`COMPATIBLE_CONNECTION_OK`。32768token/60秒预算、输出cap1024、无重试/扩额。请求口径为possible2/confirmed2/uncertain0；网络失败存在不确定派发时实际请求数应null。实际账单/Go额度未知，质量验收unconfirmed。撤池、原生默认、重启历史/claim/推理验证及安装renderer通过；两阶段自有进程停止，后续只读新增调用0。真实Key只保留于该隔离DSH Host，脚本不读/复制旧Go/OAuth/Codex凭据。源码及包未改变，两路最终真实证据复审PASS，可在上述有限范围关闭#8；#7/#11最终门槛仍未完成，本轮许可已耗尽。完整证据见`VERIFY/t07-v0140-real-summary.json`及`VERIFY/t07-v0140-real-review.md`。
