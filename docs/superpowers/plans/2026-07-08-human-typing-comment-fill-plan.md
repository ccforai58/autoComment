# 评论框拟人工逐字输入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将批量评论填充改为默认拟人工逐字输入，并输出可回溯日志。

**Architecture:** 在 `lib/comment-fill-logic.js` 增加可测试的输入计划和逐字填充函数。`content.js` 使用同样策略执行真实 DOM 输入，并在 `fill.comment_done` 日志输出策略指标。`lib/batch-submit-logic.js` 将默认批量填充选项改为 `human-normal`。

**Tech Stack:** Chrome extension content script, vanilla JavaScript, Node test runner.

## Global Constraints

- 不修改提交按钮点击和成功验证逻辑。
- 保留评论内容中的真实换行。
- 不硬编码敏感信息。
- 修改同步到 `dist/auto-comment-plugin` 和 `load-this-extension`。

---

### Task 1: 测试输入策略

**Files:**
- Modify: `autoComment/tests/comment-fill-logic.test.js`

**Steps:**
- [ ] 为 `buildHumanTypingPlan` 写失败测试：`human-normal` 每字符都有非零延迟，标点后延迟更大。
- [ ] 为 `fillTextSequentially` 写失败测试：返回输入指标并保留 href 换行。

### Task 2: 实现输入策略工具

**Files:**
- Modify: `autoComment/lib/comment-fill-logic.js`

**Steps:**
- [ ] 实现 `buildHumanTypingPlan(text, options)`。
- [ ] 修改 `fillTextSequentially` 支持 `strategy`、`delayScale`，返回 `{ success, chars, durationMs, avgDelayMs, strategy }`。

### Task 3: 接入 content.js

**Files:**
- Modify: `autoComment/content.js`
- Modify: `autoComment/lib/batch-submit-logic.js`

**Steps:**
- [ ] 批量默认填充选项改为 `{ fast: false, typingStrategy: 'human-normal' }`。
- [ ] `content.js` 的非 fast 填充使用异步拟人工逐字输入。
- [ ] `fill.comment_done` 日志输出策略指标。

### Task 4: 同步和验证

**Files:**
- Sync modified files to dist and load extension directories.

**Steps:**
- [ ] 同步 `content.js`、`lib/comment-fill-logic.js`、`lib/batch-submit-logic.js`。
- [ ] 运行相关测试、语法检查、乱码扫描和完整测试。
