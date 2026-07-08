# 提交结果与历史归档合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将批量页“执行结果统计”和“Promotion archive”合并为一个带 Tab 的“提交结果”卡片。

**Architecture:** 保持当前批次结果和历史归档的数据来源分离，只在 UI 层合并为同一个卡片。`batch.html` 提供共享容器、Tab、共享摘要和两个面板；`batch.js` 负责 Tab 状态、摘要渲染和现有表格渲染函数的最小调整。

**Tech Stack:** Chrome extension HTML/CSS/vanilla JavaScript, Chrome storage APIs.

## Global Constraints

- 设计文档默认使用中文。
- 不修改自动提交核心逻辑。
- 不硬编码或持久化敏感信息。
- 所有源码和文档按 UTF-8 处理。
- 修改后同步到 `dist/auto-comment-plugin` 和 `load-this-extension`。

---

### Task 1: 合并 HTML 结构

**Files:**
- Modify: `autoComment/batch.html`

**Interfaces:**
- Consumes: existing element ids used by `batch.js`.
- Produces: `resultsCard`, `resultsCurrentTab`, `resultsArchiveTab`, `currentResultsPanel`, `archiveResultsPanel`, and shared summary ids.

- [ ] **Step 1: Replace separate result cards with one results card**

Replace the existing `statsPanel` card and `archiveCard` card with:

```html
<div class="card results-card" id="resultsCard">
  <div class="results-header">
    <div class="card-title">提交结果</div>
    <div class="results-tabs" role="tablist" aria-label="提交结果视图">
      <button type="button" class="results-tab active" id="resultsCurrentTab" data-results-view="current">当前批次</button>
      <button type="button" class="results-tab" id="resultsArchiveTab" data-results-view="archive">历史归档</button>
    </div>
  </div>
  <div class="stats-summary">
    <div class="stats-card"><div class="stats-card-label">总数</div><div class="stats-card-value total" id="statsTotal">0</div></div>
    <div class="stats-card"><div class="stats-card-label">成功</div><div class="stats-card-value success" id="statsSuccess">0</div></div>
    <div class="stats-card"><div class="stats-card-label">已存在</div><div class="stats-card-value skipped" id="statsSkipped">0</div></div>
    <div class="stats-card"><div class="stats-card-label">待处理</div><div class="stats-card-value manual-required" id="statsManualRequired">0</div></div>
    <div class="stats-card"><div class="stats-card-label">无评论框</div><div class="stats-card-value no-comment-box" id="statsNoCommentBox">0</div></div>
    <div class="stats-card"><div class="stats-card-label">失败</div><div class="stats-card-value fail" id="statsFail">0</div></div>
    <div class="stats-card"><div class="stats-card-label">成功率</div><div class="stats-card-value rate" id="statsRate">--</div></div>
  </div>
  <div class="results-panel active" id="currentResultsPanel">
    ...keep current batch filters and table...
  </div>
  <div class="results-panel" id="archiveResultsPanel">
    ...keep archive filters, table, and empty state...
  </div>
</div>
```

- [ ] **Step 2: Run a structural sanity check**

Run: `node --check autoComment/batch.js`

Expected: PASS. HTML changes do not affect JS syntax.

### Task 2: Add Tab Styling And Remove Duplicate Panel Styling

**Files:**
- Modify: `autoComment/batch.html`

**Interfaces:**
- Consumes: classes added in Task 1.
- Produces: compact single-card result UI.

- [ ] **Step 1: Add CSS for merged results card**

Add CSS for:

```css
.results-card { display: none; }
.results-card.visible { display: block; }
.results-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.results-tabs { display: inline-flex; padding: 3px; background: #f3f4f6; border-radius: 8px; border: 1px solid #e5e7eb; }
.results-tab { border: 0; background: transparent; color: #6b7280; font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.results-tab.active { background: #ffffff; color: #111827; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
.results-panel { display: none; border: 1px solid #e5e7eb; border-top: 0; background: #ffffff; }
.results-panel.active { display: block; }
```

- [ ] **Step 2: Keep existing table classes**

Do not rename `stats-table`, `stats-filter`, `result-badge`, `ai-content-cell`, or `error-cell`.

### Task 3: Wire Tab State And Shared Summary

**Files:**
- Modify: `autoComment/batch.js`

**Interfaces:**
- Consumes: DOM ids from Task 1.
- Produces: `activeResultsView`, `setResultsView(view)`, `updateResultsVisibility()`, `renderResultsSummary(counts)`.

- [ ] **Step 1: Add DOM refs and state**

Add:

```js
const resultsCard = document.getElementById('resultsCard');
const resultsCurrentTab = document.getElementById('resultsCurrentTab');
const resultsArchiveTab = document.getElementById('resultsArchiveTab');
const currentResultsPanel = document.getElementById('currentResultsPanel');
const archiveResultsPanel = document.getElementById('archiveResultsPanel');
let activeResultsView = 'current';
```

- [ ] **Step 2: Add event listeners**

In `bindEvents()` add:

```js
if (resultsCurrentTab) resultsCurrentTab.addEventListener('click', () => setResultsView('current'));
if (resultsArchiveTab) resultsArchiveTab.addEventListener('click', () => setResultsView('archive'));
```

- [ ] **Step 3: Add view functions**

Add:

```js
function setResultsView(view) {
  activeResultsView = view === 'archive' ? 'archive' : 'current';
  updateResultsVisibility();
  if (activeResultsView === 'archive') renderArchive();
  else renderStats();
}

function updateResultsVisibility() {
  if (!resultsCard) return;
  const hasCurrent = localResults.length > 0;
  resultsCard.classList.toggle('visible', hasCurrent || activeResultsView === 'archive');
  resultsCurrentTab.classList.toggle('active', activeResultsView === 'current');
  resultsArchiveTab.classList.toggle('active', activeResultsView === 'archive');
  currentResultsPanel.classList.toggle('active', activeResultsView === 'current');
  archiveResultsPanel.classList.toggle('active', activeResultsView === 'archive');
}
```

### Task 4: Adjust Current Batch And Archive Rendering

**Files:**
- Modify: `autoComment/batch.js`

**Interfaces:**
- Consumes: `renderStats()` and `renderArchive()`.
- Produces: one shared summary updated by active view.

- [ ] **Step 1: Update `renderStats()` visibility**

Replace `statsPanel.classList.add/remove('visible')` usage with `resultsCard.classList.add/remove('visible')` through `updateResultsVisibility()`.

- [ ] **Step 2: Update `renderArchiveSummary()` to write shared summary**

Instead of writing English text into `archiveSummary`, set shared numeric fields:

```js
function renderSummaryCounts(records) {
  const total = records.length;
  const success = records.filter((r) => r.result === 'success').length;
  const skipped = records.filter((r) => r.result === 'skipped').length;
  const manual = records.filter((r) => r.result === 'manual_required' || r.result === 'submitted_unconfirmed').length;
  const noCommentBox = records.filter((r) => r.result === 'no_comment_box').length;
  const fail = records.filter((r) => r.result === 'fail' || r.result === 'blocked_illegal').length;
  const rate = total > 0 ? Math.round(((success + skipped) / total) * 100) : 0;
  statsTotal.textContent = total;
  statsSuccess.textContent = success;
  statsSkipped.textContent = skipped;
  if (statsManualRequired) statsManualRequired.textContent = manual;
  statsNoCommentBox.textContent = noCommentBox;
  statsFail.textContent = fail;
  statsRate.textContent = total > 0 ? `${rate}%` : '--';
}
```

- [ ] **Step 3: Use shared summary in both renderers**

Call `renderSummaryCounts(localResults)` in `renderStats()`.
Call `renderSummaryCounts(filtered)` in `renderArchive()`.

### Task 5: Sync Extension Copies And Verify

**Files:**
- Modify: `autoComment/dist/auto-comment-plugin/batch.html`
- Modify: `autoComment/dist/auto-comment-plugin/batch.js`
- Modify: `load-this-extension/batch.html`
- Modify: `load-this-extension/batch.js`

**Interfaces:**
- Consumes: modified source files.
- Produces: loadable extension copy.

- [ ] **Step 1: Copy updated files**

Run:

```powershell
Copy-Item autoComment\batch.html autoComment\dist\auto-comment-plugin\batch.html -Force
Copy-Item autoComment\batch.js autoComment\dist\auto-comment-plugin\batch.js -Force
Copy-Item autoComment\batch.html load-this-extension\batch.html -Force
Copy-Item autoComment\batch.js load-this-extension\batch.js -Force
```

- [ ] **Step 2: Verify syntax and encoding**

Run:

```powershell
node --check autoComment\batch.js
node scripts\scan-mojibake.js
```

Expected: syntax check passes. Mojibake scan does not report newly introduced broken Chinese.
