# T07 / 0.14.0 Go 自定义路径真实验收复审

固定源码 `9c7269ff63dc48fe56e1c6199df2a7df1af88ad9`；包 SHA256 `C126B2B9F03CF0536A971151979FCE4C9BE34F2F6E9061C77B8551EE56A4CB58`。用户明确批准 1 新 Task/2 次 gpt-6-luna 请求（含标题）、32768token/60秒、每次输出最多1024、无重试或扩额，并确认在原生 DSH 自定义兼容密码页保存 Go Key。Use balance 关闭为用户声明。

## Standards PASS

独立只读复审，0 remaining findings。包、安装 35 文件、冻结 20 文件及归档记录的长度/哈希全部匹配。两 Call 均绑定选中连接、cap1024；检测1454＋标题208＝1662 token，预算32768/60秒、扩额为空。重启任务与配置一致；撤池、永久claim、推理验证和原生默认保留。重启/renderer新增模型调用0，两阶段精确停止证据完整。初稿脚本及修正记录保留，未见秘密泄露或范围夸大。

## Spec PASS

独立只读复审，0 remaining findings；可按声明的有限范围关闭 #8。1 Task、检测与标题2个完成请求、1662 token、3557ms；possible2/confirmed2/uncertain0，精确连接marker `COMPATIBLE_CONNECTION_OK` 单独核验。只调用唯一已连接的匹配条目，其余3条已保存连接不调用。限制符合许可，撤池、原生默认、重启历史/claim/推理验证和安装renderer证据一致，自有进程均已停止。

## 范围与保留事项

真实证明仅限该 Go `gpt-6-luna` 文本 Responses 路径；函数协议另有受控完整Task验证。不认证图像、Chat Completions、采样参数、任意兼容端点、所有 Go 模型或通用远程工具。质量验收保持 `unconfirmed`，精确连接结果与质量判断分开。实际账单、Go额度未知；renderer使用原生codec/公开RPC，无截图视觉验收。

真实Key只保留于新隔离DSH Host，验证脚本未读取、导入或复制既有Go/OAuth/Codex材料。旧166文件、旧状态及前一轮T07冻结文件保护仍有归档证明。原始Go0.13.1及失败证据不覆盖。本轮许可已耗尽：剩余授权Task/模型请求均为0，后续仅只读验证。官方OpenAI API #7与第二账号 #11仍为 #25最终交付门槛。
