const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePromotionWebsiteKey,
  buildCurrentBatchExportCsv,
  buildArchiveExportCsv,
  deletePromotionWebsiteRecords,
  deleteAllPromotionWebsiteRecords,
  removeCurrentBatchReportedState,
  buildCompactBatchProgress,
  chooseAssistantProgressTab,
  buildServiceStatusSummary,
  buildAssistantWarning
} = require('../lib/batch-results-logic');

test('buildCurrentBatchExportCsv keeps original CSV order and appends run result', () => {
  const csv = buildCurrentBatchExportCsv({
    batchId: 'batch-abc',
    results: [
      { originalIndex: 1, result: 'fail', originalRow: ['20', 'https://b.test/', 'b.test'] },
      { originalIndex: 0, result: 'success', originalRow: ['10', 'https://a.test/', 'a.test'] }
    ]
  });

  const lines = csv.content.split('\n');
  assert.equal(csv.filename, 'batch-results-current-batch-abc.csv');
  assert.match(lines[0], /^Page AS,Original URL,URL Domain,Run Result$/);
  assert.equal(lines[1], '10,https://a.test/,a.test,OK');
  assert.equal(lines[2], '20,https://b.test/,b.test,FAIL');
});

test('chooseAssistantProgressTab switches to progress only before user tab choice', () => {
  assert.equal(chooseAssistantProgressTab({
    hasBatchContext: true,
    userSelectedTab: false,
    currentTab: 'manual'
  }), 'progress');

  assert.equal(chooseAssistantProgressTab({
    hasBatchContext: true,
    userSelectedTab: true,
    currentTab: 'manual'
  }), 'manual');

  assert.equal(chooseAssistantProgressTab({
    hasBatchContext: false,
    userSelectedTab: false,
    currentTab: 'manual'
  }), 'manual');
});

test('buildArchiveExportCsv exports the selected promotion website only', () => {
  const websiteKey = normalizePromotionWebsiteKey('https://promo.test/');
  const csv = buildArchiveExportCsv({
    websiteKey,
    records: [
      { originalIndex: 1, promotionWebsiteUrl: 'https://promo.test/', sourceUrl: 'https://b.test/', result: 'fail', errorMessage: 'no form', timestamp: 10 },
      { originalIndex: 0, promotionWebsiteUrl: 'https://other.test/', sourceUrl: 'https://other-source.test/', result: 'success', timestamp: 20 },
      { originalIndex: 0, promotionWebsiteUrl: 'https://promo.test', sourceUrl: 'https://a.test/', result: 'success', aiContent: 'copy', timestamp: 30 }
    ]
  });

  const lines = csv.content.split('\n');
  assert.equal(csv.recordCount, 2);
  assert.equal(csv.filename.startsWith('batch-results-archive-promo.test-'), true);
  assert.equal(lines[1].includes('https://a.test/'), true);
  assert.equal(lines[2].includes('https://b.test/'), true);
  assert.equal(csv.content.includes('https://other-source.test/'), false);
});

test('deletePromotionWebsiteRecords removes archive and runtime records for one promotion website', () => {
  const websiteKey = normalizePromotionWebsiteKey('https://promo.test/');
  const result = deletePromotionWebsiteRecords({
    websiteKey,
    archiveRecords: [
      { promotionWebsiteUrl: 'https://promo.test/', sourceUrl: 'https://a.test/' },
      { promotionWebsiteUrl: 'https://other.test/', sourceUrl: 'https://b.test/' }
    ],
    batchResults: [
      { batchId: 'b1', urlIndex: 0, promotionWebsiteUrl: 'https://promo.test/' },
      { batchId: 'b1', urlIndex: 1, promotionWebsiteUrl: 'https://other.test/' }
    ],
    batchReportedUrls: ['b1:0', 'b1:1']
  });

  assert.equal(result.removedArchiveCount, 1);
  assert.equal(result.removedBatchResultCount, 1);
  assert.deepEqual(result.archiveRecords.map((r) => r.sourceUrl), ['https://b.test/']);
  assert.deepEqual(result.batchResults.map((r) => r.urlIndex), [1]);
  assert.deepEqual(result.batchReportedUrls, ['b1:1']);
});

test('deleteAllPromotionWebsiteRecords clears archive and runtime promotion records', () => {
  const result = deleteAllPromotionWebsiteRecords({
    archiveRecords: [{ id: 'a' }],
    batchResults: [{ batchId: 'b1', urlIndex: 0 }],
    batchReportedUrls: ['b1:0']
  });

  assert.deepEqual(result.archiveRecords, []);
  assert.deepEqual(result.batchResults, []);
  assert.deepEqual(result.batchReportedUrls, []);
  assert.equal(result.removedArchiveCount, 1);
  assert.equal(result.removedBatchResultCount, 1);
});

test('removeCurrentBatchReportedState clears only the current batch runtime records', () => {
  const result = removeCurrentBatchReportedState({
    batchId: 'current',
    batchResults: [
      { batchId: 'current', urlIndex: 0 },
      { batchId: 'old', urlIndex: 0 }
    ],
    batchReportedUrls: ['current:0', 'old:0']
  });

  assert.deepEqual(result.batchResults.map((r) => r.batchId), ['old']);
  assert.deepEqual(result.batchReportedUrls, ['old:0']);
  assert.equal(result.removedBatchResultCount, 1);
});

test('buildCompactBatchProgress summarizes running batch and estimates finish time', () => {
  const result = buildCompactBatchProgress({
    snapshot: {
      status: 'running',
      totalCount: 10,
      currentIndex: 5,
      successCount: 3,
      localResults: [{}, {}, {}, {}],
      batchStartedAt: 1000
    },
    now: 61000
  });

  assert.deepEqual(result, {
    isBatch: true,
    status: 'running',
    total: 10,
    completed: 4,
    success: 3,
    current: 5,
    percent: 40,
    etaMs: 90000,
    etaText: '约 2 分钟后',
    stageText: '正在处理当前页面'
  });
});

test('buildCompactBatchProgress keeps empty and completed states simple', () => {
  assert.equal(buildCompactBatchProgress({ snapshot: null }).isBatch, false);

  const completed = buildCompactBatchProgress({
    snapshot: {
      status: 'completed',
      totalCount: 2,
      currentIndex: 2,
      successCount: 1,
      localResults: [{}, {}],
      batchStartedAt: 1000
    },
    now: 3000
  });

  assert.equal(completed.completed, 2);
  assert.equal(completed.percent, 100);
  assert.equal(completed.etaText, '已完成');
});
test('buildServiceStatusSummary keeps service checks compact', () => {
  const result = buildServiceStatusSummary({
    backend: { ok: true },
    database: { ok: false, error: 'connect ECONNREFUSED' },
    model: { ok: true, configured: true }
  });

  assert.equal(result.okCount, 2);
  assert.equal(result.totalCount, 3);
  assert.equal(result.allOk, false);
  assert.deepEqual(result.items.map((item) => item.key), ['backend', 'database', 'model']);
  assert.equal(result.items[1].status, 'bad');
});

test('buildAssistantWarning shows first generation failure in red', () => {
  const result = buildAssistantWarning({
    firstGenerationFailed: true
  });

  assert.equal(result.visible, true);
  assert.equal(result.level, 'error');
  assert.match(result.text, /AI generation failed/);
});

test('buildAssistantWarning shows repeated AI copy reuse warning', () => {
  const result = buildAssistantWarning({
    sameCopyReuseCount: 3
  });

  assert.equal(result.visible, true);
  assert.equal(result.level, 'error');
  assert.match(result.text, /same AI copy has been reused 3 times/);
});

test('buildAssistantWarning hides warning after AI generation recovers', () => {
  const result = buildAssistantWarning({
    firstGenerationFailed: false,
    sameCopyReuseCount: 0
  });

  assert.equal(result.visible, false);
  assert.equal(result.text, '');
});
