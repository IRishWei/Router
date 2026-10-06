# T15：图像理解的模型选择与自动验收



## Parent

[首版规格 #1](https://github.com/IRishWei/Router/issues/1)

## What to build

提交带图像的任务，选择确实兼容的模型执行，并按参考答案和明确要求验收。

## Acceptance criteria

- [ ] 保持输入图像与任务要求，图像任务不分给无法接收该输入的文本候选；能力未知明确处理。
- [ ] 支持识别/定位/解释的参考样例和歧义样例，不把开放式推测当作已知事实。
- [ ] 已知答案、明确要求与必要评审分别记录，冲突或不足保持无法确认。
- [ ] 图像请求、返回及评审消耗进入账本，能力/格式不匹配在调用或交接前可见。
- [ ] 受控完整任务和目标桌面兼容模型路径分别验证；不扩展到图片生成。

## Blocked by

- [#7 [T06] OpenAI API 连接到完整任务](https://github.com/IRishWei/Router/issues/7)
- [#13 [T12] 轻量判断与起始模型自动选择](https://github.com/IRishWei/Router/issues/13)
- [#14 [T13] 编程、写作验收与有条件模型评审](https://github.com/IRishWei/Router/issues/14)
