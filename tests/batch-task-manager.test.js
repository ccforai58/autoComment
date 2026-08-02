const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTaskSummary,
  selectTaskForRestore,
  getTaskStartEligibility,
  canDeleteTask,
  selectBacklinkCheckableRecords
} = require('../lib/batch-task-manager');

function createSnapshot(overrides = {}) {
  return {
    batchId: 'task-a',
    status: 'terminated',
    totalCount: 3,
    currentIndex: 1,
    localResultCount: 1,
    successCount: 1,
    currentPromotionProjectId: 'project-a',
    currentPromotionWebsiteKey: 'promo-a.test',
    currentPromotionWebsiteUrl: 'https://promo-a.test',
    createdAt: 100,
    updatedAt: 200,
    ...overrides
  };
}

test('buildTaskSummary keeps task identity and compact progress', () => {
  const summary = buildTaskSummary(createSnapshot());

  assert.equal(summary.batchId, 'task-a');
  assert.equal(summary.status, 'terminated');
  assert.equal(summary.processedCount, 1);
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.currentPromotionProjectId, 'project-a');
});

test('selectTaskForRestore prefers the newest task for current promotion project', () => {
  const selected = selectTaskForRestore({
    tasks: [
      buildTaskSummary(createSnapshot({ batchId: 'old', updatedAt: 100 })),
      buildTaskSummary(createSnapshot({ batchId: 'new', updatedAt: 300 })),
      buildTaskSummary(createSnapshot({ batchId: 'other', currentPromotionProjectId: 'project-b', updatedAt: 999 }))
    ],
    currentPromotionProjectId: 'project-a',
    currentPromotionKey: 'promo-a.test'
  });

  assert.equal(selected.batchId, 'new');
});

test('getTaskStartEligibility blocks starting another task while one runs', () => {
  const eligibility = getTaskStartEligibility([
    buildTaskSummary(createSnapshot({ status: 'running' }))
  ]);

  assert.equal(eligibility.allowed, false);
  assert.equal(eligibility.runningTaskId, 'task-a');
});

test('canDeleteTask allows a paused task even when another runtime state exists', () => {
  assert.equal(canDeleteTask(buildTaskSummary(createSnapshot({ status: 'terminated' }))), true);
  assert.equal(canDeleteTask(buildTaskSummary(createSnapshot({ status: 'completed' }))), true);
  assert.equal(canDeleteTask(buildTaskSummary(createSnapshot({ status: 'running' }))), false);
});

test('selectBacklinkCheckableRecords excludes URLs that were never submitted', () => {
  const records = selectBacklinkCheckableRecords([
    { originalIndex: 0, result: 'success' },
    { originalIndex: 1, result: 'submitted_unconfirmed' },
    { originalIndex: 2, result: 'fail' },
    { originalIndex: 3, result: 'unexecuted' }
  ]);

  assert.deepEqual(records.map((record) => record.originalIndex), [0, 1]);
});
