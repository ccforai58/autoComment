# Unified Manual Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one unified manual assistant that supports normal browsing, multi-type semi-automatic backlink submission, shared submission records, and shared resource-library data without weakening the existing batch backlink workflow.

**Architecture:** Add a focused detection/runtime layer around the existing mature `content.js` blog-comment workflow, then replace the old mixed manual/progress panel with a state-driven assistant shell. Batch mode keeps its existing submit path and only uses the progress-only assistant window while running.

**Tech Stack:** Chrome extension content scripts, vanilla JavaScript, Node.js Express backend, MySQL via existing `api/link-assistant.js`, Node built-in test runner.

## Global Constraints

- Do not hardcode or log secrets, cookies, tokens, passwords, API keys, or sensitive full URLs.
- Treat all source, scripts, HTML, CSS, JSON, Markdown, and config files as UTF-8.
- Prefer `apply_patch` for manual edits.
- Keep existing batch CSV submission behavior available and do not replace the batch core with the new detector in the first implementation.
- Clicked submit attempts are recorded even when the result is failed, pending, or manual required.
- Only successful backlink checks create or update verified backlink relationships.
- Batch task running means no manual assistant icon; show only a batch progress window.
- Manual assistant UI must stay compact, with clear sections and few operations.

---

## File Structure

- Create `autoComment/lib/link-assistant-form-detector.js`: pure detection helpers for page type, stable URL, field role scoring, resource modal payload, and detector result normalization.
- Create `autoComment/tests/link-assistant-form-detector.test.js`: unit tests for the new pure detector helpers.
- Modify `autoComment/api/link-assistant.js`: preserve manual assistant metadata in submission raw payload, add a direct resource-page save service and route for manual resource pool entries.
- Modify `autoComment/tests/link-assistant.test.js`: tests for manual submission metadata and direct resource-pool save without verified backlink.
- Modify `autoComment/content.js`: add the unified assistant runtime, silent scan, existing-backlink detection, compact UI, generation/fill flow, submission watcher, and batch-progress-only behavior.
- Modify `autoComment/batch.js` and `autoComment/lib/batch-results-logic.js`: keep history/manual review opening compatible with the new assistant and add source filters only if needed by current UI.
- Sync changed extension files to `autoComment/dist/auto-comment-plugin` and `load-this-extension`.

## Task 1: Pure Detector And Payload Helpers

**Files:**
- Create: `autoComment/lib/link-assistant-form-detector.js`
- Create: `autoComment/tests/link-assistant-form-detector.test.js`

**Interfaces:**
- Produces `normalizeStableSourceUrl(input, currentUrl)` returning `{ sourceUrl, sourceUrlKey, reason }`.
- Produces `detectPageTypeFromSignals(signals)` returning `{ pageType, confidence, reasons }`.
- Produces `scoreFieldRole(input)` returning `{ role, score, reasons }`.
- Produces `buildManualResourcePayload(input)` returning backend payload for a manual resource-pool save.

- [ ] **Step 1: Write detector tests**

Add tests for canonical URL priority, tracking parameter cleanup, directory/profile/media/blog type detection, role scoring from labels/placeholders, and manual resource payload shape.

- [ ] **Step 2: Run detector tests to verify failure**

Run: `node --test tests/link-assistant-form-detector.test.js`

Expected: FAIL with module not found or missing functions.

- [ ] **Step 3: Implement detector helpers**

Implement small pure functions with no DOM dependency. Keep all page text and URL logging out of this module.

- [ ] **Step 4: Run detector tests**

Run: `node --test tests/link-assistant-form-detector.test.js`

Expected: PASS.

## Task 2: Backend Manual Source And Resource Pool API

**Files:**
- Modify: `autoComment/api/link-assistant.js`
- Modify: `autoComment/tests/link-assistant.test.js`

**Interfaces:**
- Consumes `shapeResourcePage` and existing `upsertResourcePage`.
- Produces `service.saveResourcePage(input)` and route `POST /link-assistant/resources`.
- Preserves manual metadata in `link_submission_records.raw_payload`.

- [ ] **Step 1: Add backend tests**

Add tests that `saveSubmission` preserves `submitSource`, `submitMode`, `pageType`, `detectorVersion`, and `submissionSourceUrl` in `rawPayload`, and that `POST /link-assistant/resources` creates a `resource_pages` entry without `verified_backlinks`.

- [ ] **Step 2: Run backend tests to verify failure**

Run: `node --test tests/link-assistant.test.js`

Expected: FAIL for missing direct resource save behavior.

- [ ] **Step 3: Implement manual resource save**

Add service/store path using the existing resource shape and upsert logic. Route returns `{ success: true, resource }`.

- [ ] **Step 4: Keep verified boundary intact**

Confirm non-check resource save does not call `upsertVerifiedBacklink`.

- [ ] **Step 5: Run backend tests**

Run: `node --test tests/link-assistant.test.js`

Expected: PASS.

## Task 3: Assistant State Logic In Content Script

**Files:**
- Modify: `autoComment/content.js`

**Interfaces:**
- Consumes existing `linkAssistantApiRequest`, `loadCurrentPromotionProject`, `detectPromotionSourceHitLocal`, batch context state, and batch progress snapshot helpers.
- Produces assistant state functions inside `content.js`: silent scan, open assistant, batch progress-only mode, existing backlink state.

- [ ] **Step 1: Identify old panel entry points**

Review and mark the old `createOrToggleQwenPanel`, `showQwenPanelWithOptions`, `SHOW_PROMOTE_PANEL`, and outlink floating button behavior.

- [ ] **Step 2: Add assistant state constants**

Add stable IDs and state object for icon, panel, scan result, stable source URL, current project, existing backlink hit, and submission watcher.

- [ ] **Step 3: Implement silent scan**

On page load, schedule a low-impact scan that collects candidates and checks existing backlink without scrolling.

- [ ] **Step 4: Implement icon and progress-only split**

When `_batchCtx` exists or a batch runtime snapshot is active, hide the manual icon and show progress-only panel. Otherwise show the small manual assistant icon.

- [ ] **Step 5: Implement expand behavior**

Clicking the icon opens the compact assistant and scrolls to the best candidate once.

## Task 4: Manual Assistant UI And Actions

**Files:**
- Modify: `autoComment/content.js`

**Interfaces:**
- Consumes detector result from Task 3 and existing generation/fill functions.
- Produces UI actions: open settings, rescan, next candidate, detect current page, generate and fill, submit/record, save resource.

- [ ] **Step 1: Replace mixed tabs in normal mode**

Normal mode panel shows only manual assistant sections: current page, content, submit, resource.

- [ ] **Step 2: Keep batch panel progress-only**

Progress panel shows only compact batch metrics and AI warning text.

- [ ] **Step 3: Add current page controls**

Add page type dropdown, rescan, next candidate, detect current page, current promotion summary, and existing backlink warning.

- [ ] **Step 4: Add content controls**

Add generate-and-fill button, editable textarea, and copy button.

- [ ] **Step 5: Add submit controls**

Add submit/record button, override-existing checkbox, and fallback "I submitted manually" record button.

- [ ] **Step 6: Add resource modal**

Add compact modal with source URL, page type, Page ascore, traffic, quality label, notes, and hidden advanced area.

## Task 5: Fill, Submit Watcher, And Submission Records

**Files:**
- Modify: `autoComment/content.js`

**Interfaces:**
- Consumes existing `generatePromotionCopyWithRetry`, `ensureAllCommentFormFieldsFilled`, `clickCommentSubmitButton`, `classifyPostSubmitResult`-style local helpers, and `linkAssistantApiRequest`.
- Produces `recordManualAssistantSubmission(result)` payload to `/link-assistant/submissions`.

- [ ] **Step 1: Reuse AI generation**

Make generate-and-fill use existing generation logic and record diagnostic logs with page type, field count, content length, and project ID.

- [ ] **Step 2: Fill high-confidence fields**

For blog comments call the existing mature fill path. For directory/media/profile/generic fields fill only high-confidence URL, email, title/name, description/bio, and comment fields.

- [ ] **Step 3: Watch native submit events**

Capture form submit and submit-button click for the selected candidate and record attempts once.

- [ ] **Step 4: Submit from assistant button**

Clicking submit/record fills missing fields, attempts submit according to project submit mode, classifies result, and records attempt.

- [ ] **Step 5: Manual submitted fallback**

Fallback button records `submitted_unconfirmed` with `submitSource: manual_assistant`.

## Task 6: Current Page Detection And Resource Save

**Files:**
- Modify: `autoComment/content.js`
- Modify: `autoComment/api/link-assistant.js` if Task 2 reveals extra payload needs.

**Interfaces:**
- Consumes existing backlink verification helpers where available and `/link-assistant/submissions/:id/backlink-check-result`.
- Produces current-page detection that syncs successful checks to verified resources and save-resource modal that only saves resource pool.

- [ ] **Step 1: Detect current page backlink**

Use DOM/source matching for current promotion target and show matched/not matched state.

- [ ] **Step 2: Sync successful current-page check**

If a submission ID exists, post backlink check result. If none exists, create or recover a submission first with manual source metadata.

- [ ] **Step 3: Save resource pool entry**

Resource modal posts to `POST /link-assistant/resources` and does not mark verified success.

- [ ] **Step 4: Log resource boundaries**

Log resource pool save and verified backlink sync with distinct event names.

## Task 7: History Filters And Manual Batch Detection

**Files:**
- Modify: `autoComment/batch.js`
- Modify: `autoComment/lib/batch-results-logic.js` if current result normalization needs source awareness.
- Modify: `autoComment/tests/batch-results-logic.test.js` if helper changes are made.

**Interfaces:**
- Consumes submission `rawPayload.submitSource` or archive entry submit source.
- Produces filters for manual assistant source and ensures batch backlink detection respects visible/filtered records.

- [ ] **Step 1: Audit existing archive filters**

Confirm which filters already exist and whether manual source can be represented without new UI.

- [ ] **Step 2: Add source filter only if missing**

Add a compact source selector with All, Manual Assistant, Batch, Archive Manual.

- [ ] **Step 3: Ensure batch backlink detection uses filtered rows**

Verify detection count and record set match current filters and current promotion project behavior.

- [ ] **Step 4: Run affected tests**

Run: `node --test tests/batch-results-logic.test.js`

Expected: PASS.

## Task 8: Sync Extension Builds And Verification

**Files:**
- Modify/sync: `autoComment/dist/auto-comment-plugin/*`
- Modify/sync: `load-this-extension/*`

**Interfaces:**
- Consumes all changed source extension files.
- Produces loaded extension directory ready for Chrome reload.

- [ ] **Step 1: Sync source to dist and load directory**

Copy changed JS/HTML/lib files using safe PowerShell copy commands for UTF-8 files.

- [ ] **Step 2: Run syntax checks**

Run: `node --check content.js`, `node --check batch.js`, `node --check api/link-assistant.js`, and checks for synced copies.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Start backend**

Restart backend on port 3000 if needed.

- [ ] **Step 5: Browser smoke test**

Use Playwright or Chrome where practical to load a simple local page, confirm no-batch manual icon, expand scroll behavior, progress-only batch state where feasible, and no console syntax errors.

- [ ] **Step 6: Commit implementation**

Commit cohesive implementation changes after verification passes.

## Self-Review

- Spec coverage: all confirmed requirements map to Tasks 1-8.
- Placeholder scan: no TBD/TODO placeholders are used as requirements.
- Type consistency: metadata names are consistently `submitSource`, `submitMode`, `pageType`, `detectorVersion`, `submissionSourceUrl` in JS payloads and raw payload.
- Risk control: batch behavior is not replaced by the new detector in this plan.
