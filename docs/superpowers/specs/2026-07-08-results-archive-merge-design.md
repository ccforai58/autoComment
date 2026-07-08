# 提交结果与历史归档合并设计

## 背景

批量提交页面当前同时展示“执行结果统计”和“Promotion archive”两个区域。两个区域都包含结果统计、结果筛选、URL、结果状态、错误信息、AI 内容和时间等信息，视觉上重复，占用页面高度，也让用户难以判断应该看当前批次还是历史归档。

## 目标

将两个区域合并为一个“提交结果”卡片，通过 Tab 在“当前批次”和“历史归档”之间切换。减少重复统计和重复表格，同时保留当前批次导出、排查错误、查看历史记录所需的信息。

## 设计方案

采用单卡片双 Tab 方案：

- 卡片标题统一为“提交结果”。
- 顶部只保留一组统计摘要。
- Tab 包含“当前批次”和“历史归档”。
- “当前批次”展示本次运行的结果、耗时、错误和 AI 内容。
- “历史归档”展示已保存的推广记录、推广网站、来源页面、批次和时间。
- 过滤区随当前 Tab 切换，避免无关筛选项干扰。
- 文案统一中文，“Promotion archive”改为“历史归档”。

## 统计口径

当前批次：

- 总数：当前已产生结果的数量。
- 成功：`success`。
- 已存在：`skipped`。
- 待处理：`manual_required`、`submitted_unconfirmed`、`no_comment_box`。
- 失败：`fail`、`blocked_illegal`。
- 成功率：`success + skipped` 占当前结果总数的比例。

历史归档：

- 总数：当前筛选后的历史记录数量。
- 成功：`success`。
- 已存在：`skipped`。
- 待处理：`manual_required`、`submitted_unconfirmed`、`no_comment_box`。
- 失败：`fail`、`blocked_illegal`。
- 成功率：`success + skipped` 占当前筛选历史记录总数的比例。

## UI 行为

- 当前批次没有结果时，卡片不显示当前批次表格。
- 历史归档没有记录时，显示空状态“暂无历史归档记录”。
- 切换 Tab 时不清空筛选值。
- 当前批次过滤项：结果、来源域名、耗时、关键词。
- 历史归档过滤项：推广网站、结果、关键词。
- 表格保持紧凑密度，AI 内容仍支持点击展开。

## 涉及文件

- `autoComment/batch.html`
- `autoComment/batch.js`
- `autoComment/dist/auto-comment-plugin/batch.html`
- `autoComment/dist/auto-comment-plugin/batch.js`
- `load-this-extension/batch.html`
- `load-this-extension/batch.js`

## 验收标准

- 页面只出现一个结果卡片，不再上下堆叠两个重复结果区域。
- 可以在“当前批次”和“历史归档”之间切换。
- 当前批次结果仍能正常筛选、查看错误、查看 AI 内容。
- 历史归档仍能按推广网站、结果、关键词筛选。
- 历史归档统计随筛选更新。
- 扩展加载目录已同步。
- `batch.js` 语法检查通过。
