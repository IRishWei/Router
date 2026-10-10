# T18 归档路径规范化

两个独立安装复审完成后，归档 helper 在选择文件阶段把同一个 Windows 绝对路径的 `/` 与 `\\` 表达当作不同来源，严格字符串断言失败。该阶段尚未写入仓库副本，Root 工作树仍干净。冻结 profile、源码、安装包和审查报告均未修改或重新执行。

原 helper 与重新捕获的失败输出分别保存在 `t18-review-archive-driver-before-path-normalization.mjs` 和 `t18-review-archive-path-normalization-failure.log`。只将重复名称的来源比较改为 Node `path.resolve` 后的绝对路径相等，保留不同真实来源的拒绝及全部字节/hash 检查。修正只影响完成复审后的文件归档，不增加 Host、模型或工具调用。
