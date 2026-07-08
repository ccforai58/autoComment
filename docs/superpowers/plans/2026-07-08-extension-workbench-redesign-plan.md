# 插件工作台易用性重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `batch.html` 成为插件主工作台，并优化历史归档的 CSV 序号和排序。

**Architecture:** `background.js` 将插件图标点击入口改到 `batch.html`。`batch.html` 增加运行前检查区域和历史归档序号列。`batch.js` 读取现有配置状态、刷新检查 UI，并调整历史归档排序和渲染。

**Tech Stack:** Chrome extension Manifest V3, HTML/CSS, vanilla JavaScript, Chrome storage APIs.

## Global Constraints

- 设计文档使用中文。
- 不修改自动提交核心逻辑。
- 不硬编码敏感信息。
- 源码和文档按 UTF-8 处理。
- 修改同步到 `dist/auto-comment-plugin` 和 `load-this-extension`。

---

### Task 1: 主入口切换

**Files:**
- Modify: `autoComment/background.js`

**Interfaces:**
- Produces: clicking extension action opens `batch.html`.

- [ ] 将 `chrome.action.onClicked` 的 URL 从 `options.html` 改为 `batch.html`。

### Task 2: 批量页运行前检查

**Files:**
- Modify: `autoComment/batch.html`
- Modify: `autoComment/batch.js`

**Interfaces:**
- Produces DOM ids: `openSettingsBtn`, `refreshSetupBtn`, `setupWebsiteValue`, `setupIdentityValue`, `setupUserValue`, `setupStatusText`.
- Produces JS function: `refreshSetupSummary()`.

- [ ] 在标题下增加“运行前检查”卡片。
- [ ] 从 `chrome.storage.sync` 读取推广网站、姓名、邮箱和 user id。
- [ ] 显示配置是否完整。
- [ ] “打开设置”按钮打开 `options.html`。
- [ ] “刷新配置”按钮重新读取并刷新 UI。

### Task 3: 历史归档序号和排序

**Files:**
- Modify: `autoComment/batch.html`
- Modify: `autoComment/batch.js`

**Interfaces:**
- Consumes archive records with `batchId`, `originalIndex`, `timestamp`.
- Produces archive table first column `#`.

- [ ] 历史归档表头增加 `#`。
- [ ] 每行显示 `Number(originalIndex) + 1`，无值显示 `--`。
- [ ] 历史归档排序为批次最近时间倒序，同一批次内 `originalIndex` 升序。

### Task 4: 同步和验证

**Files:**
- Modify: `autoComment/dist/auto-comment-plugin/background.js`
- Modify: `autoComment/dist/auto-comment-plugin/batch.html`
- Modify: `autoComment/dist/auto-comment-plugin/batch.js`
- Modify: `load-this-extension/background.js`
- Modify: `load-this-extension/batch.html`
- Modify: `load-this-extension/batch.js`

**Interfaces:**
- Produces loadable extension copy.

- [ ] 同步源文件到两个加载目录。
- [ ] 运行 `node --check`、`node scripts/scan-mojibake.js`、`npm test`。
