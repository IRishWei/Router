# T15 图像验收合同

0.15.0 将 `image-acceptance` contributor 接入唯一 `AcceptanceCoordinator`。验收与匿名评审默认关闭，公开策略/RPC 沿用现有有限配置；模型和客户端不能提交 verdict、参考答案证据或评分。已知答案核对仅证明与用户声明的有限合同一致，不认证参考答案真伪、开放视觉质量或效果收益。

## 有限要求与答案

专用段落使用 `仅检查以下图像要求：`，分句为换行或 `「」` 外的中文句号；遇到研究或普通明确要求段落即停止。图像编号从 1 开始，按原 Task 已认领的人类消息中的图像出现顺序累计；同内容的两次出现保留不同输入身份。

```text
仅检查以下图像要求：
图像1识别「颜色与形状」的参考答案为「红色圆形」。
图像1定位「圆形位置」的参考答案为「左侧」。
图像1解释「箭头含义」的参考答案为「指向右侧」。
图像1识别「人物身份」存在歧义。
图像1解释「场景关系」的评审标准为「仅解释可见关系」。
图像1解释「场景关系」的高风险评审标准为「仅解释可见关系」。
```

最终 assistant 产物使用对应的有限答案形式；问题、操作和编号必须一致，答案为精确字面比较。定位只接受声明的文字答案，不隐含坐标、区域或误差容限。

```text
图像1识别「颜色与形状」答案为「红色圆形」。
图像1定位「圆形位置」答案为「左侧」。
图像1解释「箭头含义」答案为「指向右侧」。
```

单一、无歧义参考与完整答案不符（或缺少答案）为 `failed`。歧义、矛盾参考、重复答案、开放或不能解析的要求、无绑定图像、未完成或取消产物为 `unconfirmed`。歧义不会通过模型投票消除。Rubric 只有绑定输入、完整产物和单一对应答案才进入必要评审；不能由模型新增要求或把自述成功当证据。

固定处理限额为输入文本 32768 UTF-8 字节、产物 262144 UTF-8 字节、16 次图像出现、32 条图像要求。超过限额产生可见 `image-unresolved`/`IMAGE_*_LIMIT_EXCEEDED`，不派发图像评审；原生输入、原产物和完整附件引用仍保留。

## 输入、证据与历史

SessionController 接收 wire block `{type:'image',mediaType,data:base64}` 后保存 immutable `ImageAttachmentRef`。DSH 可以在接纳时归一化媒体；Router 保留接纳后的 ref，不重新缩放、编码、删除或替换。`Task.acceptance.image.images` 保存：

```text
{id,version,index,attachment,hash,
 origin:{kind:'user-message',messageId,requestId,seq,blockIndex}}
```

图像要求包括 `imageIndex/imageId/imageHash/imageInputHash/operation/question/origin`，以及参考答案或 rubric；这些参与 `requirementHash`。`hash` 对应附件的 `attachmentId`，`imageInputHash` 对应整个 ref 的身份快照。Host contributor 的返回值必须与精确原 Task 输入、artifact 身份和有限规则重算值一致，不能伪造附件、证据或评审范围。

证据分别记录 `image-binding`、`reference-answer`/`explicit-requirement` 和 `answer-match`。绑定仅说明 Host 接纳了有效 ref，参考是用户声明；coverage 只取最终答案核对（未解析要求取 `requirement-interpretation`），不会将前两项当作要求通过。Rubric review 是该有限标准的代理信号。失败和不足进入现有 Blocking；图像模型评审不授予编程检查的可修复资格。

原生 steer 仍归原 Task，重新绑定全部已认领输入与新产物；旧结论及图像、普通要求、研究证据按现有白名单保留为 superseded history。历史保存 image hash/ref、reference/rubric、review finding 和 Call 引用；重启保留记录，不重放模型评审。

## 匿名多模态评审协议

一个 image review case 合并全部可评审的图像 rubric；任一 rubric 为高风险则要求两份一致结论。它与普通 rubric、研究评审共用整个 Task 已有的最多两个 `review` Call。首次无效或无法确认可用剩余额度复核；冲突、无效、未完成、预算停止或额度不足保持无法确认。确定性失败不会被评审覆盖。

System 将产物与图像内嵌指令作为不受信数据。User content 为 `[text(JSON), ...nativeImageBlocks]`，每个 image block 携带对应接纳 ref。匿名 JSON 只含产物、有限标准和图像绑定，不附加 provider/model、账号、连接、计费或策略身份：

```json
{"artifactHash":"...","requirementHash":"...","caseId":"...","requirementIds":["..."],"artifact":{"text":"...","hash":"..."},"requirements":[{"id":"...","imageId":"...","operation":"explanation","question":"...","rubric":"..."}],"images":[{"id":"...","index":1,"hash":"...","mediaType":"image/webp"}]}
```

第二次评审反转标准、图像描述和实际 image blocks 的呈现顺序，保持 ID/hash 配对。返回值只接受以下精确字段：

```json
{"artifactHash":"...","requirementHash":"...","caseId":"...","findings":[{"requirementId":"...","verdict":"passed","artifactQuote":"...","imageRefs":[{"imageId":"...","hash":"..."}],"explanation":"..."}]}
```

`verdict` 为 `passed/failed/unconfirmed`；每项标准恰好一个 finding，`artifactQuote` 必须为非空真实产物子串，`imageRefs` 必须覆盖全部供给图像的精确 ID/hash，`explanation` 非空。错 artifact/requirement/case/image hash、缺失或重复引用、虚构 quote、额外字段及不完整输出不能形成成功证据。原始 review 文本不进入普通记录。

## 派发前能力、格式与预算

主执行沿用 Router 候选门禁；文本或未知图像候选不能因文字描述代替图片而收到图像请求。DSH rc.2 在 Router 之前检查当前 Session 的 `inputModalities`；受控验证先在 Router 固定的图像候选执行文本 Task，建立当前 Session header，再提交图片。自动流程不调用 `selectModel`，不改全局默认。

图像评审预留前同时要求：当前 Host capture 已启用且授权；candidate 图像能力为 `true`；确切 `resolveModelInfo` 明确包含 `image`；公开 attachment reader 成功核验完整性；公共 `ctx.llm.imageRequestPricing(provider,model).priceImages(imageBlocks)` 返回每次图像出现的一项正整数 `visualTokens` 和字符串 `text`。格式拒绝可由 pricing 抛出稳定 `IMAGE_FORMAT_UNSUPPORTED`。具体不确定性不被折算成零输入。

| 前置失败 | 可见 reason | review Call / 请求 |
| --- | --- | --- |
| 文本/未知图像能力或确切元数据 | `REVIEW_IMAGE_CAPABILITY_UNSUPPORTED/UNKNOWN` | 0 / 0 |
| 附件不可读/完整性失败 | `REVIEW_IMAGE_ATTACHMENT_UNAVAILABLE` | 0 / 0 |
| 未提供图像估算/无效逐图估算 | `REVIEW_IMAGE_FORECAST_UNKNOWN/INVALID` | 0 / 0 |
| provider 拒绝格式 | `IMAGE_FORMAT_UNSUPPORTED` | 0 / 0 |
| 文本和视觉估算超过配置预留 | `REVIEW_INPUT_FORECAST_EXCEEDED` | 0 / 0 |
| 上下文容量未知/不足 | `REVIEW_CONTEXT_CAPACITY_UNKNOWN/EXCEEDED` | 0 / 0 |

System/JSON 文本 UTF-8 字节保守估算，加上 provider 声明的视觉 token 与附加文本字节，再和固定输出上限一起检查总预留/声明容量。`imageForecast` 记录 `source:'provider-image-request-pricing'`、`confidence:'declared'`、visualTokens/imageTextBytes/imageCount；PNG 压缩字节、base64 或像素数不被当作严格视觉 token 上界。受控 adapter 声明的每图 64 token 仅用于本地协议 fixture，不推广到任何真实模型。

预留沿用原 Task、原 signal、唯一 `reserveCall` → `streamReservedCall`，不另开预算或账本。预算等待结束后重新捕获身份/资格、核验确切图像元数据、相同 pricing 与附件；变化则关闭未派发流并释放 Call。steer/取消使旧产物评审失效。实际报告用量按统一入口结算，缺失仍保留未知与已知部分；预留不保证绝对上下文、响应或账单上限。

当前 Go、自定义兼容和 ChatGPT adapter 保持文本限制。本模块没有图像生成。源码受控闭环、目标 Desktop 兼容路径和真实视觉语义是不同证据范围；官方 API/账号真实门槛仍由最终 #25 保留，见 [开发主线决策](go-mainline-development.md)。
