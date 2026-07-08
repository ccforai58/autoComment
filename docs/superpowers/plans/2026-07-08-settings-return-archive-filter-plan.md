# 设置返回与历史归档默认筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改善配置页返回工作台、结果默认视图和历史归档默认筛选。

**Architecture:** `options.js` 将批量入口改为当前标签页跳转。`batch.js` 负责焦点恢复时刷新配置、固定当前批次为默认 Tab，并根据最近归档记录设置历史推广网站筛选。`options.html` 删除 Contact 区块。

**Tech Stack:** Chrome extension MV3, vanilla JavaScript, HTML/CSS, Chrome storage APIs.

## Global Constraints

- 不修改自动提交核心逻辑。
- 不硬编码敏感信息。
- 所有源码和文档按 UTF-8 处理。
- 修改同步到 `dist/auto-comment-plugin` 和 `load-this-extension`。

---

### Task 1: 配置页返回工作台

**Files:**
- Modify: `autoComment/options.html`
- Modify: `autoComment/options.js`

**Steps:**
- [ ] 将按钮文案改为 `返回工作台`。
- [ ] 点击按钮使用 `chrome.tabs.update({ url: 'batch.html' })`，失败时 fallback 到 `location.href = 'batch.html'`。
- [ ] 删除 Contact 区块。

### Task 2: 工作台刷新配置与默认当前批次

**Files:**
- Modify: `autoComment/batch.html`
- Modify: `autoComment/batch.js`

**Steps:**
- [ ] 新增当前批次空状态元素。
- [ ] 初始化保持 `activeResultsView = 'current'`。
- [ ] 删除“无当前结果时自动切到历史归档”的逻辑。
- [ ] 监听页面 `focus` 和 `visibilitychange` 调用 `refreshSetupSummary()`、`loadUserId()`、`loadPoints()`。

### Task 3: 历史归档默认按最近推广网站筛选

**Files:**
- Modify: `autoComment/batch.js`

**Steps:**
- [ ] `buildArchiveWebsiteOptions` 支持当 selectedWebsite 为空或 all 时选最近记录的网站。
- [ ] `renderArchive` 使用归档记录中的最近推广网站作为默认值。
- [ ] 保留 `all` 选项但不默认。

### Task 4: 同步与验证

**Files:**
- Modify dist and load extension copies.

**Steps:**
- [ ] 同步 `options.html/options.js/batch.html/batch.js`。
- [ ] 运行 JS 语法检查、乱码扫描和测试。
