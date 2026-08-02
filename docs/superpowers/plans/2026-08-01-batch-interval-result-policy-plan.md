# 批量任务随机间隔结果规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅在自动提交成功或已提交待确认时安排随机间隔；所有跳过、失败和需手动处理结果立即继续下一项。

**Architecture:** 在独立的 `batch-auto-submit-guard` 规则模块中提供结果分类函数，批量页在记录每项结果后仅依据该函数调度倒计时。随机等待开关关闭、任务暂停/停止或全部完成时维持现有的无等待行为。

**Tech Stack:** Chrome Extension MV3、JavaScript、Node.js 内置测试框架。

## Global Constraints

- 保留每日确认阈值的既有统计口径：仅成功或待确认提交计数。
- 不记录 URL、令牌或其他敏感信息。
- 所有新增中文内容使用 UTF-8。

---

### Task 1: 为结果等待策略建立纯函数测试

**Files:**
- Modify: `tests/batch-auto-submit-guard.test.js`
- Modify: `lib/batch-auto-submit-guard.js`

**Interfaces:**
- Produces: `shouldScheduleAutoSubmitInterval(result): boolean`
- Consumes: 批量任务结果字符串。

- [ ] **Step 1: Write the failing test**

```js
assert.equal(shouldScheduleAutoSubmitInterval('success'), true);
assert.equal(shouldScheduleAutoSubmitInterval('success_pending_moderation'), true);
assert.equal(shouldScheduleAutoSubmitInterval('submitted_unconfirmed'), true);
for (const result of ['skipped', 'source_hit', 'no_comment_box', 'manual_required', 'blocked_illegal', 'fail']) {
  assert.equal(shouldScheduleAutoSubmitInterval(result), false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/batch-auto-submit-guard.test.js`
Expected: FAIL because `shouldScheduleAutoSubmitInterval` is not exported.

- [ ] **Step 3: Write minimal implementation**

```js
function shouldScheduleAutoSubmitInterval(result) {
  return new Set(['success', 'success_pending_moderation', 'submitted_unconfirmed']).has(String(result || '').trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/batch-auto-submit-guard.test.js`
Expected: PASS.

### Task 2: 仅对需要等待的结果调度随机间隔

**Files:**
- Modify: `batch.js:2858-2861`
- Test: `tests/legacy-batch-ui.test.js`

**Interfaces:**
- Consumes: `shouldScheduleAutoSubmitInterval(result)`。
- Produces: 成功/待确认结果后的倒计时；其他结果直接调度下一项。

- [ ] **Step 1: Write the failing integration guard test**

```js
assert.match(handleTabResultBlock, /shouldScheduleAutoSubmitInterval\(result\)/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/legacy-batch-ui.test.js`
Expected: FAIL because the runtime still schedules from browser-tab presence only.

- [ ] **Step 3: Write minimal implementation**

```js
if (processedInBrowserTab && status === 'running' && !isTerminated && guard.shouldScheduleAutoSubmitInterval(result)) {
  scheduleNextAutoSubmit();
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/batch-auto-submit-guard.test.js tests/legacy-batch-ui.test.js`
Expected: PASS.

### Task 3: 全量回归验证

**Files:**
- Verify: `batch.js`
- Verify: `tests/*.test.js`

- [ ] **Step 1: Run syntax and full tests**

Run: `npm test; node --check batch.js; git diff --check`
Expected: all tests pass, syntax check exits 0, and no diff whitespace errors.
