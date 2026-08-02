# 批量导入草稿持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让未启动的批量 CSV 导入在刷新或重开页面后恢复，同时明确新文件替换与重复文件不重复导入的规则。

**Architecture:** 在 `chrome.storage.local` 新建按推广网站隔离的导入草稿，不与已有批量运行快照混用。将草稿的纯数据构建、恢复校验和文件指纹比较放入独立逻辑模块；`batch.js` 负责浏览器存储和界面恢复。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、Node.js 内置 `node:test`。

## Global Constraints

- 所有文件使用 UTF-8；不得写入或记录令牌、Cookie、邮箱等敏感信息。
- 仅保存已解析的数据与文件指纹，不保存原始文件内容。
- 普通 CSV 与 Semrush CSV 使用同一套草稿生命周期。
- 先写失败测试，再写最小实现；不得改动正式运行状态的恢复语义。

---

### Task 1: 草稿状态纯逻辑

**Files:**
- Create: `lib/batch-upload-draft.js`
- Create: `tests/batch-upload-draft.test.js`

**Interfaces:**
- Produces: `buildUploadDraft(input)`, `isSameUploadDraft(current, candidate)`, `isRestorableUploadDraft(draft, promotionKey)`, `buildUploadDraftViewState(draft)`。
- Consumes: `input = { promotionKey, importType, fileName, fileFingerprint, parsedUrls, display }`。

- [ ] **Step 1: Write the failing test**

```js
test('same file fingerprint keeps the existing draft', () => {
  const current = buildUploadDraft({ promotionKey: 'https://promo.test', importType: 'csv', fileName: 'a.csv', fileFingerprint: 'a:1:2', parsedUrls: [{ url: 'https://source.test' }], display: {} });
  const candidate = buildUploadDraft({ promotionKey: 'https://promo.test', importType: 'csv', fileName: 'a.csv', fileFingerprint: 'a:1:2', parsedUrls: [{ url: 'https://other.test' }], display: {} });
  assert.equal(isSameUploadDraft(current, candidate), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/batch-upload-draft.test.js`

Expected: FAIL because `../lib/batch-upload-draft` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
function buildUploadDraft(input) {
  const source = input && typeof input === 'object' ? input : {};
  return { version: 1, promotionKey: String(source.promotionKey || ''), importType: String(source.importType || ''), fileName: String(source.fileName || ''), fileFingerprint: String(source.fileFingerprint || ''), parsedUrls: Array.isArray(source.parsedUrls) ? source.parsedUrls : [], display: source.display && typeof source.display === 'object' ? source.display : {}, savedAt: Date.now() };
}
```

- [ ] **Step 4: Extend failing tests for restore safety**

```js
test('restored draft always produces an idle view state', () => {
  const state = buildUploadDraftViewState(buildUploadDraft({ promotionKey: 'https://promo.test', importType: 'semrush', fileName: 'a.csv', fileFingerprint: 'x', parsedUrls: [{ url: 'https://source.test' }], display: {} }));
  assert.equal(state.status, 'idle');
  assert.equal(state.parsedUrls.length, 1);
});
```

- [ ] **Step 5: Implement validation and run tests**

Implement `isRestorableUploadDraft` to require version 1, a matching promotion key, and a non-empty parsed URL array. Implement `buildUploadDraftViewState` to return `{ status: 'idle', parsedUrls, importType, fileName, display }`. Run: `npm test -- tests/batch-upload-draft.test.js`. Expected: PASS.

### Task 2: 在批处理页接入草稿存储

**Files:**
- Modify: `batch.html`
- Modify: `batch.js`
- Test: `tests/legacy-batch-ui.test.js`

**Interfaces:**
- Consumes: `window.AutoCommentBatchUploadDraft` exported by `lib/batch-upload-draft.js`。
- Produces: `saveUploadDraft`, `restoreUploadDraft`, `clearUploadDraft`, `createUploadFileFingerprint` in `batch.js`。

- [ ] **Step 1: Write the failing page integration test**

```js
test('batch page loads the upload draft logic before batch.js', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '..', 'batch.html'), 'utf8');
  assert.match(page, /lib\/batch-upload-draft\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/legacy-batch-ui.test.js`

Expected: FAIL because `batch.html` does not load `lib/batch-upload-draft.js`.

- [ ] **Step 3: Implement storage helpers and restore path**

Add `BATCH_UPLOAD_DRAFT_PREFIX = 'batch_upload_draft_v1:'`. Build the storage key from the normalized promotion URL. Save a draft immediately after either importer has successfully produced `parsedUrls`; restore it in `init()` only if `restoreBatchRuntimeState()` did not restore a formal task. Re-render file information and preview from the restored draft without changing `status` from `idle`.

- [ ] **Step 4: Add integration assertions and run tests**

Add assertions that `batch.js` declares the draft key, invokes restore during initialization, and invokes save after both CSV import functions. Run: `npm test -- tests/legacy-batch-ui.test.js`. Expected: PASS.

### Task 3: 应用替换、重复与清理生命周期

**Files:**
- Modify: `batch.js`
- Test: `tests/batch-upload-draft.test.js`

**Interfaces:**
- Consumes: `saveUploadDraft({ importType, fileName, fileFingerprint, parsedUrls, display })`.
- Produces: repeat imports return `{ saved: false, reason: 'same_file' }`; successful different imports return `{ saved: true, reason: 'replaced' }`.

- [ ] **Step 1: Write the failing lifecycle tests**

```js
test('different fingerprint replaces the prior draft candidate', () => {
  const current = buildUploadDraft({ promotionKey: 'https://promo.test', importType: 'csv', fileName: 'old.csv', fileFingerprint: 'old', parsedUrls: [{ url: 'https://old.test' }], display: {} });
  const candidate = buildUploadDraft({ promotionKey: 'https://promo.test', importType: 'csv', fileName: 'new.csv', fileFingerprint: 'new', parsedUrls: [{ url: 'https://new.test' }], display: {} });
  assert.equal(isSameUploadDraft(current, candidate), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/batch-upload-draft.test.js`

Expected: FAIL until `isSameUploadDraft` compares promotion key, import type, and non-empty fingerprints.

- [ ] **Step 3: Implement import lifecycle**

Compute a non-sensitive fingerprint from `file.name`, `file.size`, `file.lastModified`, and import type. On a same-fingerprint import, keep `parsedUrls` unchanged and display “该文件已导入，保留当前列表”. On a successful different import, replace `parsedUrls`, persist the new draft, and then clear only the formal runtime state. On parse failure, return before any draft save or runtime clear.

- [ ] **Step 4: Clear at semantic boundaries and run focused tests**

Call `clearUploadDraft()` from `resetFile()` and immediately after the formal batch state has been persisted in `startBatch()`. Run: `npm test -- tests/batch-upload-draft.test.js tests/legacy-batch-ui.test.js`. Expected: PASS.

### Task 4: 全量验证

**Files:**
- Test: `tests/batch-upload-draft.test.js`
- Test: `tests/legacy-batch-ui.test.js`

- [ ] **Step 1: Run focused unit tests**

Run: `npm test -- tests/batch-upload-draft.test.js tests/legacy-batch-ui.test.js`

Expected: PASS with no test failures.

- [ ] **Step 2: Run full suite**

Run: `npm test`

Expected: PASS with no regressions.

- [ ] **Step 3: Manually verify extension page**

Load `batch.html` through the already connected Playwright Chrome session, import a CSV, refresh before clicking start, and confirm the same list, count, and filename return. Import the same file again and confirm no duplicate list; import a different valid file and confirm replacement.

## Self-Review

- Spec coverage: Task 1 defines a separate, testable data model; Task 2 persists/restores it; Task 3 covers replacement, repeated import, parse-failure preservation, removal and start transitions; Task 4 validates the full behavior.
- Placeholder scan: no incomplete requirements or unspecified test commands remain.
- Type consistency: all page-facing helpers consume and return the draft shape defined in Task 1; all drafts are keyed by the normalized promotion URL.
