# 批量外链提交成功率稳定化设计

## 背景

本轮测试批次 `c835732d-d0db-4c5b-8157-78a3370383d6` 相比此前表现较好的批次 `ba2dcd37-bfab-43ce-92b3-42462f51268b`，成功类结果下降明显。日志对比显示，主要损失不是三段输入策略整体失效，而是若干边界问题叠加：

- 个别 URL 调度链路没有任何 `task.start`、`timeout` 或 `confirmed` 事件，存在静默漏处理风险。
- 部分页面已经生成、填充并点击提交，但提交后验证在短 grace timeout 内收口，未等到 backlink 验证结果。
- `textarea` 选择存在误伤：日志显示目标评论内容已完整存在，但最终提交前又读到空评论框并失败。
- AI 生成偶发不返回，导致整条 URL 超时失败。
- 页面已确认无可用评论区时，仍可能等待到全局超时，拖慢批处理。

目标是在不推翻当前可用路径的前提下，提高批量提交外链的稳定性和可解释性。

## 目标

1. 批处理不能静默跳过 CSV 中的 URL；即使打开失败，也必须写入明确结果和日志。
2. 评论框选择要稳定，提交前验证必须基于实际写入的同一个评论控件。
3. 已观察到提交成功迹象时，验证流程应给 backlink 检查足够时间，但不能让每条都长时间等待。
4. AI 生成失败时不重试大模型，直接复用最近一次成功生成的推广文案。
5. 如果第一次 AI 生成就失败且没有可复用文案，要在“AI 网站推广助手”浮窗中用红色文字提示 AI 生成内容出问题。
6. 如果连续 3 次 AI 失败都在复用同一份文案，也要在“AI 网站推广助手”浮窗中用红色文字提示 AI 生成内容出问题。
7. 无评论框或不可注入页面要快速落盘结果，减少无效等待。

## 非目标

- 不改变三段输入策略的核心逻辑。
- 不扩大成功标准；仍以提交后源码或审核预览中出现推广网址的真实链接作为严格成功依据。
- 不在本轮改造 iframe、复杂验证码、登录墙等低频站点适配。
- 不把 AI 失败时的复用内容伪装成新的 AI 生成结果；日志必须标明复用来源。

## 设计方案

### 1. 批处理调度可追踪

在 `openNextTab` 调度链路补齐本地 debug 日志：

- 准备处理某个 `urlIndex`。
- 写入 pending task。
- 调用 `chrome.tabs.create`。
- tab 创建成功或失败。
- content ping 成功或失败。
- 发送 `BATCH_HANDLE` 成功或失败。

如果 `chrome.tabs.create` 返回错误、tab 为空、或 pending task 无法发送，应立即将该 URL 记为 `fail`，错误信息写明调度阶段，随后继续下一条。这样不会再出现“从 4 直接跳到 6，但 5 没任何记录”的情况。

### 2. textarea 稳定选择

评论填充阶段记录实际写入的评论控件指纹，例如：

- `textareaId`
- `textareaName`
- 所属 form id/class
- 关键 DOM 路径或候选序号

提交前验证优先使用“刚刚写入成功的控件”。只有该控件不存在、不可见或已脱离 DOM 时，才重新从 form 中选择评论框。验证日志需要同时记录：

- preferred textarea 的长度和 host 命中情况。
- fallback textarea 的长度和 host 命中情况。
- 最终采用哪个控件。

如果实际内容满足长度和推广 host 校验，不允许再因为另一个空 textarea 报 `comment textarea is empty before submit`。

### 3. 提交后验证等待

现有 8 秒 grace timeout 对部分站点偏短，尤其是已经观察到以下成功迹象时：

- `success_message_found`
- `comment_appeared_on_page`
- `navigation_without_error`
- 进入 `comment-page`、`#comment-id` 或 moderation preview 页面

改为条件等待：

- 没有任何提交成功迹象：保持快速收口。
- 有中等成功迹象：最多等待约 20 秒做 backlink 验证。
- 有强成功迹象：最多等待约 25 秒做 backlink 验证。

等待期间按顺序检查当前页、comment anchor 页、原始 URL、审核预览 URL。任一页面源码出现推广网址真实链接，即落为 `success` 或 `success_pending_moderation`。到上限仍未验证到，则落为 `submitted_unconfirmed`，并记录最后一次验证目标和失败原因。

### 4. AI 失败复用策略

AI 生成失败包括：

- 请求失败。
- 超时。
- 返回空内容。
- 返回内容被判断为不可用。

发生失败时不重新请求大模型。系统读取最近一次成功生成并通过本地校验的文案，作为当前 URL 的备用内容继续填充和提交。

复用时必须写日志：

- 当前 URL。
- 复用来源 URL 和 `urlIndex`。
- 复用内容长度。
- 当前连续复用同一内容的次数。

连续 3 次都复用同一个内容时，在“AI 网站推广助手”浮窗的批量进度 tab 中显示红色提示：

`AI 生成内容可能异常，已连续复用同一份文案 3 次。请检查本地后端或大模型服务。`

后续如果 AI 再次成功生成新内容，连续复用计数清零，红色提示隐藏。

如果当前批次还没有任何成功生成的文案，AI 失败时不能复用，应直接将该 URL 记为 `fail`，错误信息说明 `AI generation failed and no reusable copy is available`，并立即在“AI 网站推广助手”浮窗的批量进度 tab 中显示红色提示：

`AI 生成内容失败，且当前批次暂无可复用文案。请检查本地后端或大模型服务。`

### 5. 无评论框快速结束

当初扫和最终扫描都没有可用评论框，并且页面没有可展开评论区、iframe 评论区或延迟加载迹象时，快速落为 `no_comment_box`。这类 URL 不应等待全局 60 秒超时。

为了避免误杀，以下情况仍允许短等待或继续现有逻辑：

- 页面存在 `add comment`、`reply`、`leave a comment` 等可展开信号。
- 页面包含疑似评论 iframe。
- 页面仍在明显加载中。

## 日志要求

新增或补强以下日志阶段：

- `batch.open_prepare`
- `batch.pending_task_saved`
- `batch.tab_create_done`
- `batch.tab_create_failed`
- `batch.message_send_failed`
- `submit.textarea_choice`
- `submit.textarea_choice_mismatch`
- `ai.generate_failed_reuse_start`
- `ai.generate_failed_reuse_done`
- `ai.reuse_warning_shown`
- `ai.first_generation_warning_shown`
- `verify.wait_extended`
- `verify.target_checked`
- `verify.wait_exhausted`

日志中不得写入密钥、cookie、账号、token 等敏感信息。

## 验收标准

1. 同一 CSV 的每个有效 URL 都至少有一个最终结果，不能静默消失。
2. `textarea` 已完整填入内容时，不再因另一个空评论框导致提交前失败。
3. 对有强成功迹象的页面，验证等待不再固定 8 秒收口。
4. AI 生成失败且已有可复用内容时，任务继续执行，并在日志里标明复用。
5. 第一次 AI 生成失败且无可复用内容时，助手浮窗立即显示红色告警。
6. 连续 3 次复用同一内容时，助手浮窗显示红色告警；AI 恢复后告警消失。
7. 无评论框页面比全局超时更快结束。
8. 现有自动化测试通过，并新增覆盖调度漏处理、textarea 选择和 AI 复用策略的测试。
