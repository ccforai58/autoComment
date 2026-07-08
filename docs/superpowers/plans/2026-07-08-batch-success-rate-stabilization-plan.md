# Batch Success Rate Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve batch backlink submission stability without replacing the current segmented comment input path.

**Architecture:** Add small pure helpers for policy decisions, then wire them into the existing `batch.js` and `content.js` flows. Keep browser-side behavior observable with local debug logs and sync extension files to `dist/auto-comment-plugin` and `../load-this-extension`.

**Tech Stack:** Chrome extension JavaScript, Node.js built-in test runner, existing local Express debug API.

## Global Constraints

- Do not hardcode secrets, API keys, cookies, usernames, passwords, or tokens.
- Preserve UTF-8 and avoid PowerShell writes for files containing Chinese text.
- Keep the strict success standard: source HTML or moderation preview must contain a real anchor href to the promotion URL.
- AI generation failures must not retry the model; reuse the latest successful generated copy when available.
- If the first AI generation fails and no reusable copy exists, show a red warning in the AI website promotion assistant.
- If the same AI copy is reused 3 consecutive times, show a red warning in the assistant.
- Do not revert unrelated dirty worktree changes.

---

### Task 1: Pure Policy Helpers

**Files:**
- Modify: `lib/batch-submit-logic.js`
- Modify: `tests/batch-submit-logic.test.js`
- Modify: `lib/batch-results-logic.js`
- Modify: `tests/batch-results-logic.test.js`

**Interfaces:**
- Produces: `chooseReadyCommentField(input) -> { field, source, reason, preferredValidation, fallbackValidation }`
- Produces: `getSubmitVerificationGraceSeconds(input) -> number`
- Produces: `buildAiReuseState(input) -> { action, reusableCopy, reuseCount, warning }`
- Produces: `buildAssistantWarning(input) -> { visible, text, level }`

- [ ] **Step 1: Write failing tests**

Add tests proving:

```js
assert.equal(chooseReadyCommentField({
  preferred: { id: 'comment', text: 'hello cfggt.com with enough text' },
  fallback: { id: 'other', text: '' },
  expectedText: 'hello cfggt.com with enough text',
  promotionUrl: 'https://cfggt.com/'
}).source, 'preferred');

assert.equal(getSubmitVerificationGraceSeconds({
  classifiedResult: 'success',
  confidence: 'strong',
  reason: 'success_message_found'
}), 25);

assert.equal(buildAiReuseState({
  aiOk: false,
  reusableCopy: null
}).action, 'fail_first_generation');

assert.equal(buildAiReuseState({
  aiOk: false,
  reusableCopy: { text: 'copy', key: 'copy-1' },
  previousReuseKey: 'copy-1',
  previousReuseCount: 2
}).warning, 'same_copy_reused_3_times');

assert.equal(buildAssistantWarning({
  firstGenerationFailed: true
}).visible, true);
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/batch-submit-logic.test.js tests/batch-results-logic.test.js`

Expected: tests fail because helper functions are not defined.

- [ ] **Step 3: Implement helpers**

Implement the helpers in the two lib files and export them through `module.exports`.

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/batch-submit-logic.test.js tests/batch-results-logic.test.js`

Expected: both targeted test files pass.

### Task 2: Runtime Wiring

**Files:**
- Modify: `content.js`
- Modify: `batch.js`

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces: debug stages `batch.open_prepare`, `batch.pending_task_saved`, `batch.tab_create_done`, `batch.tab_create_failed`, `submit.textarea_choice`, `ai.generate_failed_reuse_start`, `ai.generate_failed_reuse_done`, `ai.first_generation_warning_shown`, `ai.reuse_warning_shown`, `verify.wait_extended`.

- [ ] **Step 1: Add dispatch logging and tab-create failure handling**

In `batch.js`, log before opening a tab, after saving pending task, after creating a tab, and when `chrome.runtime.lastError` or missing tab occurs. On tab creation failure, call `handleTabResult(urlIndex, 'fail', null, 'Tab create failed: ...', 0)` and continue.

- [ ] **Step 2: Use dynamic verification grace**

In timeout checking, read `batchSubmitCtx.successEvidence`, compute the grace with `getSubmitVerificationGraceSeconds`, and only finalize after that value. Log `verify.wait_extended` when the value is greater than the old 8 seconds.

- [ ] **Step 3: Fix textarea selection**

In `content.js`, update `assertCommentReadyForSubmit` to prefer the textarea that was filled when it already validates. Log both preferred and fallback validation details. Do not throw empty-text errors when the preferred field validates.

- [ ] **Step 4: Wire AI reuse behavior**

In batch auto mode, replace `generatePromotionCopyWithRetry(3)` with a single generation attempt. On failure, reuse the last successful generated copy from extension storage when available; otherwise fail current URL and store first-generation warning state. Update reuse count and warning state in storage.

- [ ] **Step 5: Show assistant warnings**

In the assistant progress pane, read warning state from storage and show concise red text when `buildAssistantWarning` returns visible.

### Task 3: Sync and Verify

**Files:**
- Modify copied files under `dist/auto-comment-plugin`
- Modify copied files under `../load-this-extension`

- [ ] **Step 1: Sync changed extension files**

Copy changed runtime and lib files to:

```powershell
Copy-Item -LiteralPath content.js -Destination dist\auto-comment-plugin\content.js -Force
Copy-Item -LiteralPath batch.js -Destination dist\auto-comment-plugin\batch.js -Force
Copy-Item -LiteralPath lib\batch-submit-logic.js -Destination dist\auto-comment-plugin\lib\batch-submit-logic.js -Force
Copy-Item -LiteralPath lib\batch-results-logic.js -Destination dist\auto-comment-plugin\lib\batch-results-logic.js -Force
Copy-Item -LiteralPath content.js -Destination ..\load-this-extension\content.js -Force
Copy-Item -LiteralPath batch.js -Destination ..\load-this-extension\batch.js -Force
Copy-Item -LiteralPath lib\batch-submit-logic.js -Destination ..\load-this-extension\lib\batch-submit-logic.js -Force
Copy-Item -LiteralPath lib\batch-results-logic.js -Destination ..\load-this-extension\lib\batch-results-logic.js -Force
```

- [ ] **Step 2: Run verification**

Run:

```powershell
npm test
node --check content.js
node --check batch.js
node --check lib\batch-submit-logic.js
node --check lib\batch-results-logic.js
node scripts\scan-mojibake.js
```

Expected: all commands exit 0.
