# 历史归档外链状态检查与筛选导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史归档页批量重新检查推广外链是否仍存在，并支持导出当前筛选结果。

**Architecture:** 本地后台新增检查接口，负责抓取来源页面 HTML 并复用现有反链验证逻辑。前端历史归档页把当前筛选记录发送到后台，收到结果后只写入新的 latest backlink 字段，不覆盖原始提交结果。CSV 导出复用现有导出 helper，并追加最新检查字段。

**Tech Stack:** Node.js、Express、Chrome extension storage、原生 `fetch`、Node `node:test`。

## Global Constraints

- 源码、HTML、CSS、JSON、Markdown 和配置文件按 UTF-8 处理。
- 不硬编码或记录任何凭据、API key、token、cookie 或带 secret 的 URL。
- 新增日志必须有稳定操作名、数量、耗时和非敏感错误摘要。
- 手动编辑优先使用 `apply_patch`。
- 新功能先写失败测试，再写实现。

---

### Task 1: 后台外链检查服务

**Files:**
- Create: `api/backlink-check.js`
- Modify: `server.js`
- Test: `tests/backlink-check.test.js`

**Interfaces:**
- Consumes: `verifyBacklinkInHtml(html, promotionUrl)` from `lib/batch-submit-logic.js`
- Produces: `POST /api/backlink-checks` accepting `{ records: [{ id, sourceUrl, promotionWebsiteUrl }] }`
- Produces response `{ success: true, checkedAt, results: [{ id, latestBacklinkStatus, latestBacklinkCheckedAt, latestBacklinkMatchedHref, latestBacklinkReason }] }`

- [ ] Write failing tests for successful match, missing link, skipped record, and fetch error.
- [ ] Run `node --test tests/backlink-check.test.js` and verify the tests fail because the module/route does not exist.
- [ ] Implement `api/backlink-check.js` with injectable fetch for tests, timeout via `AbortController`, status mapping, structured logs, and route export.
- [ ] Register the route in `server.js` with `app.use('/api', require('./api/backlink-check'))`.
- [ ] Run `node --test tests/backlink-check.test.js` and verify it passes.

### Task 2: 历史归档逻辑与 CSV 字段

**Files:**
- Modify: `lib/batch-results-logic.js`
- Test: `tests/batch-results-logic.test.js`

**Interfaces:**
- Produces: `mergeBacklinkCheckResults(records, checkResults)` returning records with latest backlink fields merged by `id`.
- Produces: `getLatestBacklinkStatusDisplay(record)` returning `{ text, cssClass, title }`.
- Updates: `buildArchiveExportCsv(input)` to include latest backlink columns.

- [ ] Write failing tests for merging latest check fields without changing `result`, and exporting latest status/date/reason columns.
- [ ] Run `node --test tests/batch-results-logic.test.js` and verify the new tests fail.
- [ ] Implement the helper functions and extend CSV headers/rows.
- [ ] Run `node --test tests/batch-results-logic.test.js` and verify it passes.

### Task 3: 历史归档页面按钮、表格列和存储回写

**Files:**
- Modify: `batch.html`
- Modify: `batch.js`
- Test: syntax checks and existing tests

**Interfaces:**
- Consumes: `mergeBacklinkCheckResults(records, checkResults)` and `getLatestBacklinkStatusDisplay(record)` from `window.BatchResultsLogic`.
- Consumes: `POST http://127.0.0.1:3000/api/backlink-checks`.

- [ ] Add `checkArchiveBacklinksBtn` and `exportArchiveBtn` in the archive filter action area.
- [ ] Add archive table columns `外链状态` and `检测日期`.
- [ ] In `batch.js`, wire `checkArchiveBacklinksBtn` to collect the current filtered records, call the backend, merge results into `BACKLINK_ARCHIVE_KEY`, and rerender archive.
- [ ] In `batch.js`, wire `exportArchiveBtn` to the existing export function while archive tab is active.
- [ ] Render latest backlink status/date cells for each archive record.
- [ ] Run `node --check batch.js` and verify it passes.
- [ ] Run `node --test tests/batch-results-logic.test.js tests/backlink-check.test.js` and verify both pass.

### Task 4: Final verification and distribution copy

**Files:**
- Modify: `dist/auto-comment-plugin/batch.html`
- Modify: `dist/auto-comment-plugin/batch.js`
- Modify: `dist/auto-comment-plugin/lib/batch-results-logic.js`

**Interfaces:**
- Distribution files mirror extension source files for loading the packaged plugin.

- [ ] Copy updated extension source files into `dist/auto-comment-plugin`.
- [ ] Run `npm test` and verify all tests pass.
- [ ] Run `node --check batch.js`, `node --check api/backlink-check.js`, and `node --check lib/batch-results-logic.js`.
- [ ] Run `node scripts/scan-mojibake.js` because Chinese UI copy changed.
- [ ] Check `git status --short` and confirm only intended files changed.
