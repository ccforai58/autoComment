# 批量外链提交可靠性设计

## 背景

本插件当前定位是本地免费运行工具。核心目标不是支付、积分或云端业务闭环，而是从 CSV 中读取原 URL，逐条打开页面，自动填写评论表单，并尽可能成功提交包含推广网站链接的评论。

前几轮测试暴露出两个方向的问题：

- GitHub 基线版本偏“乐观”：提交前就可能把任务记为成功，因此跑得快，也曾经成功过，但会产生明显的假成功风险。
- 当前本地改动偏“严格”：尝试等待提交证据，但点击与恢复状态机变复杂，导致第一条任务也可能长时间等待；用户手动刷新后，任务状态还可能消失。

因此本次设计采用“实用型两阶段提交”方案：优先保证流程能跑下去、能真实点击提交、能恢复任务；再用提交后的页面源码验链作为最终成功标准。

## 目标

- 批量处理 CSV 中的原 URL，尽可能自动提交带推广网站链接的评论。
- 不因为提交确认等待过久而卡死整个批处理。
- 不因为目标页刷新、跳转、用户误刷新或 batch 页面重载而丢失任务状态。
- 每个 URL 都有可追踪日志，方便后续定位失败原因。
- 成功判断以“提交后的最新网页源码中出现指向推广网址的正向链接”为最高优先级。

## 非目标

- 不做支付、积分、购买 CSV 等生产商业逻辑。
- 不引入云端遥测服务。
- 不保存账号、密码、Cookie、Token、API Key 等敏感信息。
- 不承诺绕过验证码、登录、人机验证、评论审核或站点反垃圾策略。
- 本阶段不做复杂站点适配器框架，只保留必要的通用 WordPress/评论表单增强。

## 推荐方案：实用型两阶段提交

每条 URL 分为两个阶段：

1. **执行提交阶段**
   - 找评论表单。
   - 生成或复用 AI 评论内容。
   - 填写姓名、邮箱、网址、评论内容。
   - 快速触发提交按钮，不让点击函数长时间阻塞。
   - 记录“已触发提交”状态。

2. **提交后验链阶段**
   - 等待页面短时间响应，包括跳转、刷新、AJAX 变化、表单清空或提示文本。
   - 获取提交后的最新页面 HTML/source。
   - 在 HTML 中检查是否存在指向推广网址的正向链接。
   - 根据验链和页面证据给出结果。

## 成功判断标准

最高优先级成功标准：

- 提交后的最新网页源码中存在指向推广网址的正向链接。

链接匹配规则：

- 推广网址先做标准化：
  - 补齐协议用于解析，例如 `example.com` 按 `https://example.com` 解析。
  - 域名统一小写。
  - 去掉 hash。
  - 去掉末尾多余 `/`。
- 页面源码中查找 `<a href="...">` 链接。
- 如果链接的 hostname 与推广网址 hostname 一致，则认为出现了正向链接。
- 如果推广网址包含具体路径，优先要求链接路径与推广网址路径一致或以该路径为前缀。
- 允许 http/https 协议不同。
- 不把纯文本 URL 当作最终成功；纯文本 URL 只能作为辅助日志，不计入 `success`。

辅助成功证据：

- 页面出现常见成功或审核提示，例如 `awaiting moderation`、`thank you for your comment`。
- 评论 textarea 被清空，且没有明确错误。
- 页面发生跳转或刷新，且没有明确错误。

辅助证据不能单独覆盖最高标准。也就是说，如果没有在提交后的源码里找到正向链接，但有提交迹象，应记录为 `submitted_unconfirmed`，而不是 `success`。

## 结果状态

- `success`
  - 提交后的最新网页源码中找到指向推广网址的正向链接。

- `submitted_unconfirmed`
  - 已经完成填写并触发提交。
  - 页面有提交迹象，但源码中尚未找到正向链接。
  - 常见原因包括评论进入审核、站点延迟渲染、AJAX 未回显、或需要站长审核后才公开外链。

- `manual_required`
  - 出现验证码、人机验证、登录要求、Cloudflare、Turnstile、reCAPTCHA、hCaptcha 等需要人工处理的情况。

- `no_comment_box`
  - 页面没有可用评论框或评论关闭。

- `fail`
  - AI 内容生成失败。
  - 必填字段无法填写。
  - 提交按钮找不到或点击异常。
  - 页面出现明确提交错误，例如重复评论、邮箱格式错误、提交过快、spam detected。

## 状态持久化

批处理不能只依赖 `batch.js` 的内存变量。需要把运行状态写入 `chrome.storage.local`：

- `batchId`
- CSV URL 列表和每条原始行信息
- 当前处理 index
- 每条 URL 的阶段和结果
- 当前活动任务
- 是否已经生成 AI 内容
- 是否已经填写表单
- 是否已经触发提交
- 最近一次提交后的页面 URL
- 最近一次验链结果

恢复规则：

- 如果 batch 页面被刷新，应从 storage 恢复列表、统计、当前进度和已完成结果。
- 如果目标页面被刷新，应从 storage 恢复当前 URL 的任务上下文。
- 如果任务已经触发提交，则恢复后只做提交后验链和结果上报，不重新生成 AI。
- 如果任务未触发提交，则可以继续填写和提交。

## 提交流程

1. `batch.js` 从 CSV 创建批处理任务并持久化。
2. `batch.js` 打开当前 URL，并写入当前活动任务。
3. `content.js` 收到 `BATCH_HANDLE` 或从 storage 恢复任务。
4. `content.js` 查找评论表单并记录日志。
5. `content.js` 生成或复用 AI 评论。
6. `content.js` 填写评论、姓名、邮箱、网址字段。
7. `content.js` 做提交前校验。
8. `content.js` 快速触发提交，不长时间阻塞点击函数。
9. `content.js` 等待短窗口观察页面变化。
10. `content.js` 获取提交后的最新 HTML，并执行源码验链。
11. `content.js` 上报 `success`、`submitted_unconfirmed`、`manual_required`、`no_comment_box` 或 `fail`。
12. `background.js` 持久化结果。
13. `batch.js` 更新 UI、关闭标签页、继续下一条。

## 点击策略

点击函数只负责“尽可能触发提交”，不负责最终成功判断。

点击顺序：

1. 合成 pointer/mouse/click 事件。
2. `button.click()`。
3. `form.requestSubmit(button)`。
4. 必要时使用 `form.submit()` 作为最后降级。

每种点击方式只允许短等待，不允许每个 fallback 都等待 10 到 12 秒。点击完成后立即进入提交后观察和验链。

## 提交后源码验链

验链来源按优先级：

1. 当前 DOM 的 `document.documentElement.outerHTML`。
2. 如果页面跳转或刷新完成，再读取最新 DOM。
3. 如果当前页面 URL 可访问且同源/允许 fetch，可尝试 `fetch(location.href)` 获取最新 HTML。
4. 如果 fetch 被拦截或跨源限制，退回 DOM HTML。

验链日志必须记录：

- 推广网址标准化结果。
- 找到的候选链接数量。
- 是否存在 hostname 匹配。
- 是否存在路径匹配。
- 最终 `linkVerified: true/false`。

不得记录敏感字段、账号密码、Cookie 或完整页面源码。

## 日志设计

每条 URL 至少记录以下阶段：

- `task.start`
- `form.scan`
- `ai.generate_start`
- `ai.generate_done`
- `fill.comment_done`
- `fill.fields_done`
- `submit.click_start`
- `submit.click_done`
- `submit.observe_done`
- `verify.link_start`
- `verify.link_done`
- `result.saved`

日志字段：

- `batchId`
- `urlIndex`
- `url`
- `stage`
- `elapsedMs`
- `result`
- `errorMessage`
- `aiContentLength`
- `formId`
- `textareaName`
- `submitMethod`
- `promotionHost`
- `linkVerified`

日志写入本地：

- `autoComment/output/debug/extension-debug.jsonl`

## 测试计划

自动化测试：

- 推广网址标准化测试。
- HTML `<a href>` 正向链接检测测试。
- 纯文本 URL 不计为成功测试。
- http/https 不同但 hostname 相同的链接匹配测试。
- 具体路径匹配测试。
- 批处理状态恢复逻辑测试。
- 点击结果分类测试。

手动测试：

- 用 2 到 3 条已知 WordPress 评论页测试。
- 第一条包含需要验证码或审核的页面，确认进入 `manual_required` 或 `submitted_unconfirmed`。
- 第二条使用历史上成功过的 PaperTrailDesign 页面，确认不再卡在点击阶段。
- 手动刷新目标页面，确认任务不消失。
- 手动刷新 batch 页面，确认已完成结果和当前进度可恢复。

## 风险

- 很多评论系统会先进入审核，不会立即在源码中出现外链。这类应记录为 `submitted_unconfirmed`，不是 `success`。
- 有些站点用 JS 延迟渲染评论，DOM 可能晚于提交响应更新。
- 跨域 iframe 评论系统仍可能无法自动处理。
- 验证码、人机验证、登录墙无法自动绕过。
- 如果推广网址被站点自动加 `nofollow`，仍然算正向链接出现；本设计只判断 href 指向，不判断 SEO 权重。

## 修改范围

预计修改：

- `autoComment/content.js`
- `autoComment/background.js`
- `autoComment/batch.js`
- `autoComment/lib/batch-submit-logic.js`
- `autoComment/tests/`
- `autoComment/dist/auto-comment-plugin/`
- `load-this-extension/`

不修改：

- 支付模块
- CSV 购买模块
- 敏感配置
- 模型供应商配置，除非现有生成接口继续返回空内容

## 验收标准

- 批处理不会因为单条 URL 点击确认等待而长时间卡死。
- 用户刷新目标页后，当前任务仍可恢复或给出明确结果。
- 用户刷新 batch 页后，已完成结果和当前进度不丢。
- 只有在提交后的最新源码中找到指向推广网址的链接时，结果才是 `success`。
- 无法确认外链出现但确实触发提交时，结果是 `submitted_unconfirmed`。
- 每条失败 URL 都能从日志看到失败发生在哪个阶段。
