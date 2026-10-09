# Go 0.13.1 安装复审

固定源码 `0f8612f7345c7bbf23fcb78c14c2758f584db44a`；包SHA256 `D7FE4C7CEB4CB7CDFF8205A1B2CBD41E2403F4EF83478618298196442C57692D`，205504字节。

## Standards

PASS，0 findings。独立只读核对安装目录全部33文件，长度及哈希匹配manifest。真实Desktop完成1Task/2本地响应，installed renderer经原生codec与实时公开RPC展示任务、密码框、永久claim。重启保存配置、任务与原生默认；删除受控凭据仍保留claim。两阶段按PID/启动时间/路径验证并停止自有进程树。旧记录166文件及旧状态哈希保持一致。

## Spec

PASS，0 findings。检测与标题共2次本地Responses，稳定session、输出cap1024、预算32768/60秒，无扩额；费用/quota未知。配置和原生默认恢复；重启保留历史及claim。安装后客户端通过原生RPC codec/实时公开RPC验证密码框、任务展示、检测已使用状态。受控传输拒绝远程地址，真实请求0。

范围仅控制安装验收，尚未认证真实Go请求。renderer使用react-test-renderer，无截图视觉验收。原24项官方API/OAuth/第二账号验收未由Go替代。0.13.0失败冻结包保留，不覆盖。
