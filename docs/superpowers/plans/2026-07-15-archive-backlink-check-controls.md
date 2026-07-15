# Archive Backlink Check Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archive backlink checking support clear start, pause, stop, restart, and resume behavior.

**Architecture:** Keep the browser task queue in `batch.js`, but move button/progress state decisions into testable pure helpers in `lib/batch-results-logic.js`. The UI uses those helpers so labels and disabled states stay consistent with the queue state.

**Tech Stack:** Chrome extension JavaScript, Node `node:test`, existing `batch-results-logic.js` helpers.

## Global Constraints

- Preserve original submission result fields; only update latest backlink status fields.
- Do not log secrets or full sensitive URLs.
- Preserve UTF-8 and avoid propagating mojibake.
- Add diagnostic logs around state transitions.

---

### Task 1: Pure Control State Helpers

**Files:**
- Modify: `lib/batch-results-logic.js`
- Modify: `tests/batch-results-logic.test.js`

**Interfaces:**
- Produces: `buildBacklinkCheckControlState({ hasRecords, active, paused, stopped })`
- Produces: `buildBacklinkCheckProgressText(progress, state)`

- [ ] Write failing tests for idle, running, paused, stopped, and completed states.
- [ ] Implement the helpers with no DOM dependencies.
- [ ] Export the helpers.
- [ ] Run `npm test`.

### Task 2: Wire UI Buttons To State Helpers

**Files:**
- Modify: `batch.js`
- Modify: `dist/auto-comment-plugin/batch.js`

**Interfaces:**
- Consumes: `buildBacklinkCheckControlState`
- Consumes: `buildBacklinkCheckProgressText`

- [ ] Use the helper in `setArchiveBacklinkCheckRunning`.
- [ ] Rename the main button label to `开始检测` when idle.
- [ ] Keep `暂停` and `继续检测` as one toggle button.
- [ ] Keep `重新检测` disabled while active, enabled when idle.
- [ ] Add safe logs for `pause`, `resume`, and `stop`.
- [ ] Run `npm test`.

### Task 3: Prepare Browser Test Build

**Files:**
- Modify: `load-this-extension/*` by syncing from `dist/auto-comment-plugin`

- [ ] Copy latest dist extension files to `load-this-extension`.
- [ ] Restart the local backend from `master`.
- [ ] Verify `/api/local-status` and `/api/backlink-checks`.
