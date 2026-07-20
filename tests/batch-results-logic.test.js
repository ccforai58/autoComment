const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePromotionWebsiteKey,
  buildCurrentBatchExportCsv,
  buildArchiveExportCsv,
  deletePromotionWebsiteRecords,
  deleteAllPromotionWebsiteRecords,
  removeCurrentBatchReportedState,
  selectCurrentBatchStorageKeysForRemoval,
  selectAssistantProgressSnapshot,
  buildCompactBatchProgress,
  chooseAssistantProgressTab,
  buildServiceStatusSummary,
  buildAssistantWarning,
  buildResultSummary,
  filterBatchResultRecords,
  filterArchiveResultRecords,
  getResultDisplay,
  mergeBacklinkCheckResults,
  selectBacklinkProgressRecords,
  getLatestBacklinkStatusDisplay,
  buildBacklinkCheckProgress,
  buildBacklinkCheckControlState,
  buildBacklinkCheckProgressText,
  selectBacklinkCheckTargets,
  normalizeBacklinkCheckConcurrency,
  normalizeBacklinkRetryDelayMs,
  buildManualReviewTarget,
  buildManualReviewOpenMessage,
  dedupeCsvSourceUrlItems,
  formatDateTimeForDisplay,
  findDuplicatePromotionSubmissionRecord,
  compactBatchRuntimeSnapshotForStorage,
  buildBatchRuntimeStorageUpdate,
  shouldRestoreRuntimeAfterPromotionKeyRefresh
} = require('../lib/batch-results-logic');

test('formatDateTimeForDisplay includes date and time in local display format', () => {
  assert.equal(formatDateTimeForDisplay(new Date(2026, 6, 17, 9, 8, 7)), '2026-07-17 09:08:07');
  assert.equal(formatDateTimeForDisplay(null), '--');
});

test('compactBatchRuntimeSnapshotForStorage removes duplicate semrush rows from pending urls but preserves original row', () => {
  const headers = ['Target url', 'Source url', 'Page ascore', 'Extra'];
  const row = ['https://discover.test/', 'https://source.test/post', '42', 'value'];
  const snapshot = compactBatchRuntimeSnapshotForStorage({
    batchId: 'batch-a',
    parsedUrls: [{
      originalIndex: 0,
      url: 'https://source.test/post',
      sourceDomain: 'source.test',
      originalRow: row,
      semrushHeaders: headers,
      semrushRow: row,
      semrushMeta: {
        targetUrl: 'https://discover.test/',
        sourceUrl: 'https://source.test/post',
        sourceDomain: 'source.test',
        pageAscore: 42,
        semrushHeaders: headers,
        semrushRow: row
      }
    }],
    localResults: [{
      originalIndex: 0,
      url: 'https://source.test/post',
      aiContent: 'copy',
      originalRow: row,
      semrushHeaders: headers,
      semrushRow: row,
      semrushMeta: {
        pageAscore: 42,
        semrushHeaders: headers,
        semrushRow: row
      }
    }]
  });

  assert.deepEqual(snapshot.parsedUrls[0].originalRow, row);
  assert.equal(snapshot.parsedUrls[0].semrushHeaders, undefined);
  assert.equal(snapshot.parsedUrls[0].semrushRow, undefined);
  assert.equal(snapshot.parsedUrls[0].semrushMeta.targetUrl, 'https://discover.test/');
  assert.equal(snapshot.parsedUrls[0].semrushMeta.pageAscore, 42);
  assert.equal(snapshot.parsedUrls[0].semrushMeta.semrushHeaders, undefined);
  assert.equal(snapshot.parsedUrls[0].semrushMeta.semrushRow, undefined);
  assert.deepEqual(snapshot.localResults[0].semrushHeaders, headers);
  assert.deepEqual(snapshot.localResults[0].semrushRow, row);
  assert.equal(snapshot.localResults[0].semrushMeta.semrushRow, undefined);
});

test('compactBatchRuntimeSnapshotForStorage removes ordinary CSV original rows from pending urls', () => {
  const snapshot = compactBatchRuntimeSnapshotForStorage({
    batchId: 'batch-csv',
    parsedUrls: [{
      originalIndex: 0,
      url: 'https://source.test/post',
      sourceDomain: 'source.test',
      originalRow: ['https://source.test/post', 'large note']
    }],
    localResults: []
  });

  assert.equal(snapshot.parsedUrls[0].originalRow, undefined);
});

test('buildBatchRuntimeStorageUpdate stores full runtime once and keeps legacy key lightweight', () => {
  const fullSnapshot = {
    batchId: 'batch-large',
    status: 'terminated',
    totalCount: 4627,
    currentIndex: 21,
    parsedUrls: Array.from({ length: 3 }, (_, index) => ({
      originalIndex: index,
      url: `https://source.test/${index}`
    })),
    localResults: [{ originalIndex: 0, url: 'https://source.test/0', result: 'fail' }],
    currentPromotionWebsiteKey: 'https://promo.test',
    updatedAt: Date.now()
  };
  const activeTask = {
    batchId: 'batch-large',
    status: 'terminated',
    totalCount: 4627,
    currentIndex: 21,
    localResultCount: 21,
    currentPromotionWebsiteKey: 'https://promo.test'
  };

  const update = buildBatchRuntimeStorageUpdate({
    runtimeStateKey: 'batch_runtime_state_v1',
    promotionStorageKey: 'batch_runtime_state_promotion_v1:https%3A%2F%2Fpromo.test',
    storageSnapshot: fullSnapshot,
    activeTask
  });

  assert.deepEqual(update['batch_runtime_state_v1'], activeTask);
  assert.equal(update['batch_runtime_state_promotion_v1:https%3A%2F%2Fpromo.test'], fullSnapshot);
});

test('buildCurrentBatchExportCsv exports a stable current batch result report', () => {
  const csv = buildCurrentBatchExportCsv({
    batchId: 'batch-abc',
    results: [
      {
        originalIndex: 1,
        promotionWebsiteUrl: 'https://promo.test/',
        promotionProjectId: 7,
        url: 'https://b.test/',
        sourceDomain: 'b.test',
        discoveryTargetUrl: 'https://discover.test/page',
        result: 'fail',
        errorMessage: 'content timeout',
        aiContent: 'copy, with comma',
        timestamp: new Date(2026, 6, 17, 9, 8, 7).getTime(),
        elapsed: 12,
        linkVerified: false,
        matchedHref: '',
        submitSource: 'manual_assistant',
        semrushMeta: { pageAscore: 20 }
      },
      {
        originalIndex: 0,
        targetUrl: 'https://promo.test/',
        url: 'https://a.test/',
        sourceDomain: 'a.test',
        result: 'success',
        errorMessage: '',
        aiContent: 'good copy',
        timestamp: new Date(2026, 6, 17, 9, 0, 0).getTime(),
        elapsed: 8,
        linkVerified: true,
        matchedHref: 'https://promo.test/'
      }
    ]
  });

  const lines = csv.content.split('\n');
  assert.equal(csv.filename, 'batch-results-current-batch-abc.csv');
  assert.equal(
    lines[0],
    '#,Promotion website,Promotion project ID,Source url,Source domain,Discovery target url,Page ascore,Result,Result label,Error info,AI content,Submitted at,Elapsed seconds,Backlink verified,Matched href,Submit source,Batch ID'
  );
  assert.match(lines[1], /,batch_auto,batch-abc$/);
  assert.match(lines[2], /,manual_assistant,batch-abc$/);
  assert.equal(csv.recordCount, 2);
});

test('selectCurrentBatchStorageKeysForRemoval only removes storage owned by current batch', () => {
  const keys = selectCurrentBatchStorageKeysForRemoval({
    batchId: 'batch-a',
    promotionKey: normalizePromotionWebsiteKey('https://promo-a.test/'),
    storageData: {
      batchLocalResults: { batchId: 'batch-a', results: [] },
      batch_runtime_state_v1: {
        batchId: 'batch-b',
        currentPromotionWebsiteKey: normalizePromotionWebsiteKey('https://promo-b.test/')
      },
      batch_pending_task: { batchId: 'batch-b', urlIndex: 3 },
      batchCtx: { batchId: 'batch-a', urlIndex: 1 },
      batch_active_task_v1: { batchId: 'batch-a' },
      batchSubmitCtx: {
        batchId: 'batch-b',
        promotionWebsiteKey: normalizePromotionWebsiteKey('https://promo-b.test/')
      }
    }
  });

  assert.deepEqual(keys.sort(), ['batchCtx', 'batchLocalResults', 'batch_active_task_v1'].sort());
});

test('selectCurrentBatchStorageKeysForRemoval can remove current promotion legacy snapshot by owner', () => {
  const keys = selectCurrentBatchStorageKeysForRemoval({
    batchId: 'batch-a',
    promotionKey: normalizePromotionWebsiteKey('https://promo-a.test/'),
    storageData: {
      batch_runtime_state_v1: {
        batchId: 'batch-a',
        currentPromotionWebsiteKey: normalizePromotionWebsiteKey('https://promo-a.test/')
      },
      batch_pending_task: { batchId: 'batch-a', urlIndex: 2 },
      batchSubmitCtx: {
        batchId: 'batch-a',
        promotionWebsiteKey: normalizePromotionWebsiteKey('https://promo-a.test/')
      }
    }
  });

  assert.deepEqual(keys.sort(), ['batchSubmitCtx', 'batch_pending_task', 'batch_runtime_state_v1'].sort());
});

test('shouldRestoreRuntimeAfterPromotionKeyRefresh restores only when idle promotion key changes', () => {
  const shouldRestore = shouldRestoreRuntimeAfterPromotionKeyRefresh;
  assert.equal(typeof shouldRestore, 'function');

  assert.equal(shouldRestore({
    previousPromotionKey: normalizePromotionWebsiteKey('https://promo-a.test/'),
    nextPromotionKey: normalizePromotionWebsiteKey('https://promo-b.test/'),
    status: 'idle'
  }), true);

  assert.equal(shouldRestore({
    previousPromotionKey: normalizePromotionWebsiteKey('https://promo-a.test/'),
    nextPromotionKey: normalizePromotionWebsiteKey('https://promo-b.test/'),
    status: 'running'
  }), false);

  assert.equal(shouldRestore({
    previousPromotionKey: normalizePromotionWebsiteKey('https://promo-a.test/'),
    nextPromotionKey: normalizePromotionWebsiteKey('https://promo-a.test'),
    status: 'terminated'
  }), false);
});

test('selectAssistantProgressSnapshot prefers the current task batch id over legacy snapshot', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: { batchId: 'old-batch', totalCount: 10 },
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'batch-a', totalCount: 20 },
      'https://b.test': { batchId: 'batch-b', totalCount: 30 }
    },
    currentBatchId: 'batch-b'
  });

  assert.equal(snapshot.batchId, 'batch-b');
  assert.equal(snapshot.totalCount, 30);
});

test('selectAssistantProgressSnapshot can infer current batch id from pending task context', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: null,
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'batch-a', totalCount: 20 }
    },
    pendingTask: { batchId: 'batch-a', urlIndex: 1 }
  });

  assert.equal(snapshot.batchId, 'batch-a');
});

test('selectAssistantProgressSnapshot can infer current batch id from active task context', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: { batchId: 'old-batch', totalCount: 10 },
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'batch-a', totalCount: 20, status: 'running' }
    },
    activeTask: { batchId: 'batch-a', promotionWebsiteKey: 'https://a.test' },
    requireCurrentContext: true
  });

  assert.equal(snapshot.batchId, 'batch-a');
  assert.equal(snapshot.totalCount, 20);
});

test('selectAssistantProgressSnapshot can use active task as lightweight progress snapshot', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: null,
    snapshotsByPromotion: {},
    activeTask: {
      batchId: 'batch-a',
      status: 'running',
      totalCount: 20,
      currentIndex: 3,
      localResultCount: 2,
      successCount: 1
    },
    requireCurrentContext: true
  });

  assert.equal(snapshot.batchId, 'batch-a');
  assert.equal(snapshot.totalCount, 20);
  assert.equal(snapshot.currentIndex, 3);
  assert.equal(snapshot.localResultCount, 2);
});

test('selectAssistantProgressSnapshot does not fall back when active task id is unmatched', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: { batchId: 'old-batch', totalCount: 10 },
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'older-batch', totalCount: 20 }
    },
    activeTask: { batchId: 'new-batch', promotionWebsiteKey: 'https://a.test' },
    requireCurrentContext: true
  });

  assert.equal(snapshot, null);
});

test('selectAssistantProgressSnapshot does not fall back to stale history when current batch id is unmatched', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: { batchId: 'old-batch', totalCount: 10 },
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'older-batch', totalCount: 20 }
    },
    currentBatchId: 'new-batch'
  });

  assert.equal(snapshot, null);
});

test('selectAssistantProgressSnapshot can require a current task context', () => {
  const snapshot = selectAssistantProgressSnapshot({
    legacySnapshot: { batchId: 'old-batch', totalCount: 10 },
    snapshotsByPromotion: {
      'https://a.test': { batchId: 'older-batch', totalCount: 20 }
    },
    requireCurrentContext: true
  });

  assert.equal(snapshot, null);
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

test('archive backlink checks target only the selected promotion website and filters', () => {
  const websiteKey = normalizePromotionWebsiteKey('https://promo.test/');
  const filtered = filterArchiveResultRecords([
    {
      id: 'target-success',
      promotionWebsiteUrl: 'https://promo.test/',
      sourceUrl: 'https://source-a.test/post',
      result: 'success',
      latestBacklinkStatus: ''
    },
    {
      id: 'target-fail',
      promotionWebsiteUrl: 'https://promo.test/',
      sourceUrl: 'https://source-b.test/post',
      result: 'fail',
      latestBacklinkStatus: ''
    },
    {
      id: 'other-success',
      promotionWebsiteUrl: 'https://other.test/',
      sourceUrl: 'https://source-c.test/post',
      result: 'success',
      latestBacklinkStatus: ''
    }
  ], {
    websiteKey,
    result: 'success',
    backlinkStatus: 'unchecked',
    keyword: ''
  });

  assert.deepEqual(filtered.map((record) => record.id), ['target-success']);
  assert.deepEqual(selectBacklinkCheckTargets(filtered).map((record) => record.id), ['target-success']);
});

test('historical hard-stop skips across promotion websites are still archived for the current promotion', () => {
  const result = findDuplicatePromotionSubmissionRecord({
    promotionWebsiteUrl: 'https://current-promo.test/',
    url: 'https://source.test/post',
    records: [
      {
        promotionWebsiteUrl: 'https://other-promo.test/',
        sourceUrl: 'https://source.test/post',
        result: 'no_comment_box',
        errorMessage: 'No comment form found'
      }
    ]
  });

  assert.equal(result.shouldSkip, true);
  assert.equal(result.reason, 'historical_no_comment_box');
  assert.equal(result.result, 'skipped');
  assert.equal(result.suppressArchive, false);
});

test('selectBacklinkProgressRecords keeps progress scoped to checked record ids', () => {
  const records = [
    { id: 'a', latestBacklinkStatus: 'success' },
    { id: 'b', latestBacklinkStatus: 'missing' },
    { id: 'c', latestBacklinkStatus: 'error' }
  ];

  const scoped = selectBacklinkProgressRecords(records, ['a', 'c']);

  assert.deepEqual(scoped.map((record) => record.id), ['a', 'c']);
  assert.equal(buildBacklinkCheckProgress(scoped).total, 2);
  assert.equal(buildBacklinkCheckProgress(scoped).success, 1);
  assert.equal(buildBacklinkCheckProgress(scoped).error, 1);
});

test('mergeBacklinkCheckResults stores latest backlink fields without changing original result', () => {
  const records = [{
    id: 'r1',
    result: 'submitted_unconfirmed',
    linkVerified: false,
    matchedHref: '',
    sourceUrl: 'https://source.test/post'
  }];

  const merged = mergeBacklinkCheckResults(records, [{
    id: 'r1',
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-13T08:00:00.000Z',
    latestBacklinkMatchedHref: 'https://promo.test/',
    latestBacklinkReason: 'matching_anchor_href_found'
  }]);

  assert.equal(merged[0].result, 'submitted_unconfirmed');
  assert.equal(merged[0].linkVerified, false);
  assert.equal(merged[0].matchedHref, '');
  assert.equal(merged[0].latestBacklinkStatus, 'success');
  assert.equal(merged[0].latestBacklinkCheckedAt, '2026-07-13T08:00:00.000Z');
  assert.equal(merged[0].latestBacklinkMatchedHref, 'https://promo.test/');
  assert.equal(getLatestBacklinkStatusDisplay(merged[0]).text, '成功');
});

test('buildArchiveExportCsv includes latest backlink check columns', () => {
  const csv = buildArchiveExportCsv({
    websiteKey: 'all',
    records: [{
      originalIndex: 0,
      batchId: 'batch-1',
      promotionWebsiteUrl: 'https://promo.test/',
      sourceUrl: 'https://source.test/post',
      result: 'submitted_unconfirmed',
      latestBacklinkStatus: 'missing',
      latestBacklinkCheckedAt: '2026-07-13T08:05:00.000Z',
      latestBacklinkMatchedHref: '',
      latestBacklinkReason: 'no_matching_anchor_href',
      timestamp: 10
    }]
  });

  const lines = csv.content.split('\n');
  assert.match(lines[0], /Latest Backlink Status,Latest Backlink Checked At,Latest Backlink Matched Href,Latest Backlink Reason/);
  assert.match(lines[1], /missing,2026-07-13T08:05:00.000Z,,no_matching_anchor_href/);
});

test('result exports include submission source for manual and batch records', () => {
  const current = buildCurrentBatchExportCsv({
    batchId: 'batch-source',
    results: [{
      originalIndex: 0,
      promotionWebsiteUrl: 'https://promo.test/',
      url: 'https://source.test/post',
      sourceDomain: 'source.test',
      result: 'submitted_unconfirmed',
      submitSource: 'manual_assistant',
      timestamp: new Date(2026, 6, 17, 9, 8, 7).getTime()
    }]
  });
  const archive = buildArchiveExportCsv({
    websiteKey: 'all',
    records: [{
      originalIndex: 0,
      batchId: 'manual-assistant:1',
      promotionWebsiteUrl: 'https://promo.test/',
      sourceUrl: 'https://source.test/post',
      result: 'submitted_unconfirmed',
      submitSource: 'manual_assistant',
      timestamp: 10
    }]
  });

  assert.match(current.content.split('\n')[0], /Submit source/);
  assert.match(current.content, /manual_assistant/);
  assert.match(archive.content.split('\n')[0], /Submit source/);
  assert.match(archive.content, /manual_assistant/);
});

test('buildBacklinkCheckProgress counts live backlink check statuses', () => {
  const progress = buildBacklinkCheckProgress([
    { id: 'pending' },
    { id: 'checking', latestBacklinkStatus: 'checking' },
    { id: 'success', latestBacklinkStatus: 'success' },
    { id: 'missing', latestBacklinkStatus: 'missing' },
    { id: 'error', latestBacklinkStatus: 'error' },
    { id: 'skipped', latestBacklinkStatus: 'skipped' }
  ]);

  assert.deepEqual(progress, {
    total: 6,
    pending: 1,
    checking: 1,
    completed: 4,
    success: 1,
    missing: 1,
    error: 1,
    skipped: 1,
    percent: 67
  });
  assert.equal(getLatestBacklinkStatusDisplay({ latestBacklinkStatus: 'checking' }).text, '检测中');
});

test('buildBacklinkCheckControlState maps archive backlink task states to button states', () => {
  assert.deepEqual(buildBacklinkCheckControlState({
    hasRecords: true,
    active: false,
    paused: false,
    stopped: false
  }), {
    startDisabled: false,
    startLabel: '开始检测',
    pauseDisabled: true,
    pauseLabel: '暂停',
    stopDisabled: true,
    retryDisabled: false,
    controlsDisabled: false,
    exportDisabled: false
  });

  assert.deepEqual(buildBacklinkCheckControlState({
    hasRecords: true,
    active: true,
    paused: false,
    stopped: false
  }), {
    startDisabled: true,
    startLabel: '检测中...',
    pauseDisabled: false,
    pauseLabel: '暂停',
    stopDisabled: false,
    retryDisabled: true,
    controlsDisabled: true,
    exportDisabled: true
  });

  assert.deepEqual(buildBacklinkCheckControlState({
    hasRecords: true,
    active: true,
    paused: true,
    stopped: false
  }), {
    startDisabled: true,
    startLabel: '已暂停',
    pauseDisabled: false,
    pauseLabel: '继续检测',
    stopDisabled: false,
    retryDisabled: true,
    controlsDisabled: true,
    exportDisabled: true
  });

  assert.deepEqual(buildBacklinkCheckControlState({
    hasRecords: false,
    active: false,
    paused: false,
    stopped: true
  }), {
    startDisabled: true,
    startLabel: '开始检测',
    pauseDisabled: true,
    pauseLabel: '暂停',
    stopDisabled: true,
    retryDisabled: true,
    controlsDisabled: false,
    exportDisabled: true
  });
});

test('buildBacklinkCheckProgressText labels idle, running, paused, stopped, and completed states', () => {
  const progress = {
    total: 10,
    completed: 4,
    percent: 40,
    success: 1,
    missing: 2,
    error: 1,
    skipped: 0,
    checking: 3
  };

  assert.equal(buildBacklinkCheckProgressText({ total: 0 }, { active: false, stopped: false }), '外链检测：未开始');
  assert.equal(buildBacklinkCheckProgressText(progress, { active: true, paused: false, stopped: false }), '外链检测中：4/10（40%） 成功 1，未发现 2，失败 1，跳过 0，检测中 3');
  assert.equal(buildBacklinkCheckProgressText(progress, { active: true, paused: true, stopped: false }), '外链检测已暂停：4/10（40%） 成功 1，未发现 2，失败 1，跳过 0，检测中 3');
  assert.equal(buildBacklinkCheckProgressText(progress, { active: false, paused: false, stopped: true }), '外链检测已停止：4/10（40%） 成功 1，未发现 2，失败 1，跳过 0，检测中 3');
  assert.equal(buildBacklinkCheckProgressText({ ...progress, completed: 10, percent: 100, checking: 0 }, { active: false, stopped: false }), '外链检测已完成：10/10（100%） 成功 1，未发现 2，失败 1，跳过 0，检测中 0');
});

test('selectBacklinkCheckTargets starts a new run from all filtered rows including stale checking rows', () => {
  const targets = selectBacklinkCheckTargets([
    { id: 'old-success', latestBacklinkStatus: 'success' },
    { id: 'stale-checking', latestBacklinkStatus: 'checking' },
    { id: 'old-missing', latestBacklinkStatus: 'missing' }
  ], { limit: 2 });

  assert.deepEqual(targets.map((record) => record.id), ['old-success', 'stale-checking']);
});

test('selectBacklinkCheckTargets includes all filtered rows by default', () => {
  const records = Array.from({ length: 667 }, (_, index) => ({ id: `record-${index + 1}` }));
  const targets = selectBacklinkCheckTargets(records);

  assert.equal(targets.length, 667);
  assert.equal(targets[0].id, 'record-1');
  assert.equal(targets[666].id, 'record-667');
});

test('normalizeBacklinkCheckConcurrency keeps archive check concurrency bounded', () => {
  assert.equal(normalizeBacklinkCheckConcurrency(''), 3);
  assert.equal(normalizeBacklinkCheckConcurrency('0'), 1);
  assert.equal(normalizeBacklinkCheckConcurrency('5'), 5);
  assert.equal(normalizeBacklinkCheckConcurrency('999'), 8);
});

test('normalizeBacklinkRetryDelayMs keeps archive backlink retry delay bounded', () => {
  assert.equal(normalizeBacklinkRetryDelayMs(''), 2000);
  assert.equal(normalizeBacklinkRetryDelayMs('0'), 0);
  assert.equal(normalizeBacklinkRetryDelayMs('5'), 5000);
  assert.equal(normalizeBacklinkRetryDelayMs('999'), 10000);
});

test('dedupeCsvSourceUrlItems keeps the first row for duplicate CSV source URLs', () => {
  const result = dedupeCsvSourceUrlItems([
    { url: 'blog.test/post', originalRow: ['first'] },
    { url: 'https://blog.test/post/', originalRow: ['duplicate trailing slash'] },
    { url: 'https://other.test/post', originalRow: ['other'] },
    { url: 'https://BLOG.test/post#comments', originalRow: ['duplicate hash'] }
  ]);

  assert.equal(result.duplicateCount, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].url, 'blog.test/post');
  assert.deepEqual(result.items[0].originalRow, ['first']);
  assert.equal(result.items[1].url, 'https://other.test/post');
});

test('buildResultSummary uses the same visible result groups as the page filters', () => {
  const summary = buildResultSummary([
    { result: 'success' },
    { result: 'success_pending_moderation' },
    { result: 'skipped' },
    { result: 'manual_required' },
    { result: 'submitted_unconfirmed', errorMessage: 'restored page did not show acceptance signal' },
    { result: 'submitted_unconfirmed', errorMessage: 'submit observed as success/submit_evidence_without_backlink but backlink verification did not finish before grace timeout' },
    { result: 'submitted_unconfirmed', errorMessage: 'submit started but no confirmation returned after grace period' },
    { result: 'no_comment_box' },
    { result: 'blocked_illegal' },
    { result: 'fail' }
  ]);

  assert.deepEqual(summary, {
    total: 10,
    success: 2,
    skipped: 1,
    manual: 4,
    manualRequired: 1,
    unconfirmedAcceptance: 1,
    unconfirmedBacklink: 1,
    unconfirmedTimeout: 1,
    unconfirmedSubmitted: 0,
    noCommentBox: 1,
    fail: 2,
    successRate: 30
  });
});

test('filterBatchResultRecords matches result groups and visible Chinese labels', () => {
  const records = [
    { originalIndex: 0, url: 'https://a.test/post', result: 'success_pending_moderation', aiContent: 'copy', errorMessage: '' },
    { originalIndex: 1, url: 'https://b.test/post', result: 'submitted_unconfirmed', aiContent: '', errorMessage: 'restored page did not show acceptance signal' },
    { originalIndex: 2, url: 'https://c.test/post', result: 'no_comment_box', aiContent: '', errorMessage: 'no comment form found' },
    { originalIndex: 3, url: 'https://d.test/post', result: 'submitted_unconfirmed', aiContent: '', errorMessage: 'submit observed as success/submit_evidence_without_backlink but backlink verification did not finish before grace timeout' }
  ];

  assert.deepEqual(
    filterBatchResultRecords(records, { result: 'success' }).map((record) => record.originalIndex),
    [0]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { result: 'action_required' }).map((record) => record.originalIndex),
    [1, 3]
  );
  assert.deepEqual(
    filterBatchResultRecords([
      ...records,
      { originalIndex: 4, url: 'https://e.test/post', result: 'manual_required', aiContent: '', errorMessage: 'captcha required' }
    ], { result: 'manual_required' }).map((record) => record.originalIndex),
    [4]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { result: 'unconfirmed_acceptance' }).map((record) => record.originalIndex),
    [1]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { result: 'unconfirmed_backlink' }).map((record) => record.originalIndex),
    [3]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { keyword: '提交成功' }).map((record) => record.originalIndex),
    [0]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { keyword: '反链未确认' }).map((record) => record.originalIndex),
    [3]
  );
  assert.deepEqual(
    filterBatchResultRecords(records, { keyword: '无评论框' }).map((record) => record.originalIndex),
    [2]
  );
});

test('filterArchiveResultRecords filters by latest backlink status', () => {
  const records = [
    { originalIndex: 0, result: 'success', latestBacklinkStatus: 'success' },
    { originalIndex: 1, result: 'success', latestBacklinkStatus: 'missing' },
    { originalIndex: 2, result: 'success', latestBacklinkStatus: 'error' },
    { originalIndex: 3, result: 'success', latestBacklinkStatus: 'skipped' },
    { originalIndex: 4, result: 'success', latestBacklinkStatus: 'checking' },
    { originalIndex: 5, result: 'success' }
  ];

  assert.deepEqual(
    filterArchiveResultRecords(records, { backlinkStatus: 'success' }).map((record) => record.originalIndex),
    [0]
  );
  assert.deepEqual(
    filterArchiveResultRecords(records, { backlinkStatus: 'checking' }).map((record) => record.originalIndex),
    [4]
  );
  assert.deepEqual(
    filterArchiveResultRecords(records, { backlinkStatus: 'unchecked' }).map((record) => record.originalIndex),
    [5]
  );
  assert.deepEqual(
    filterArchiveResultRecords(records, { backlinkStatus: 'all' }).map((record) => record.originalIndex),
    [0, 1, 2, 3, 4, 5]
  );
});

test('getResultDisplay maps legacy and raw result values to stable UI labels', () => {
  assert.deepEqual(getResultDisplay('success_pending_moderation'), {
    value: 'success_pending_moderation',
    category: 'success',
    subcategory: 'success_pending_moderation',
    text: '提交成功，审核中',
    categoryText: '成功/审核中',
    cssClass: 'success_pending_moderation'
  });
  assert.equal(getResultDisplay('MANUAL_REQUIRED').category, 'action_required');
  assert.equal(getResultDisplay('blocked').category, 'fail');
});

test('getResultDisplay splits submitted_unconfirmed into understandable sub statuses', () => {
  assert.deepEqual(getResultDisplay({
    result: 'submitted_unconfirmed',
    errorMessage: 'restored page did not show acceptance signal'
  }), {
    value: 'submitted_unconfirmed',
    category: 'action_required',
    subcategory: 'unconfirmed_acceptance',
    text: '已提交，页面未确认',
    categoryText: '待确认/需手动',
    cssClass: 'submitted_unconfirmed'
  });

  assert.equal(getResultDisplay({
    result: 'submitted_unconfirmed',
    errorMessage: 'submit observed as success/submit_evidence_without_backlink but backlink verification did not finish before grace timeout'
  }).text, '已提交，反链未确认');

  assert.equal(getResultDisplay({
    result: 'submitted_unconfirmed',
    errorMessage: 'submit started but no confirmation returned after grace period'
  }).subcategory, 'unconfirmed_timeout');
});

test('getResultDisplay labels historical hard-stop skipped records by reason', () => {
  assert.deepEqual(getResultDisplay({
    result: 'skipped',
    errorMessage: 'historical_no_comment_box'
  }), {
    value: 'skipped',
    category: 'skipped',
    subcategory: 'historical_no_comment_box',
    text: '\u65e0\u8bc4\u8bba\u6846\uff0c\u8df3\u8fc7',
    categoryText: '\u5df2\u8df3\u8fc7',
    cssClass: 'skipped'
  });

  assert.equal(getResultDisplay({
    result: 'skipped',
    errorMessage: 'historical_page_unavailable'
  }).text, '\u8bbf\u95ee\u4e0d\u5230\uff0c\u8df3\u8fc7');
});

test('buildManualReviewTarget extracts a browser-openable target page URL', () => {
  assert.deepEqual(buildManualReviewTarget({
    record: { url: 'https://target.test/post' },
    source: 'current'
  }), {
    ok: true,
    url: 'https://target.test/post',
    source: 'current'
  });

  assert.deepEqual(buildManualReviewTarget({
    record: { sourceUrl: 'https://archive-source.test/post' },
    source: 'archive'
  }), {
    ok: true,
    url: 'https://archive-source.test/post',
    source: 'archive'
  });

  assert.equal(buildManualReviewTarget({
    record: { url: 'javascript:alert(1)' },
    source: 'current'
  }).ok, false);
});

test('buildManualReviewOpenMessage carries existing AI content for manual review', () => {
  assert.deepEqual(buildManualReviewOpenMessage({
    record: { aiContent: 'Existing copy' },
    tab: 'manual'
  }), {
    type: 'SHOW_PROMOTE_PANEL',
    tab: 'manual',
    presetAiContent: 'Existing copy',
    presetAiContentSource: 'manual_review'
  });

  assert.deepEqual(buildManualReviewOpenMessage({
    record: { aiContent: '' },
    tab: 'progress'
  }), {
    type: 'SHOW_PROMOTE_PANEL',
    tab: 'progress',
    presetAiContent: '',
    presetAiContentSource: 'manual_review'
  });
});

test('findDuplicatePromotionSubmissionRecord skips submitted or probably submitted promotion records only', () => {
  const records = [
    { sourceUrl: 'https://target.test/post#comment-1', promotionWebsiteUrl: 'https://promo.test/', result: 'fail' },
    { sourceUrl: 'https://target.test/post/', promotionWebsiteUrl: 'https://other.test/', result: 'success' },
    { sourceUrl: 'https://target.test/post', promotionWebsiteUrl: 'https://promo.test/', result: 'manual_required' },
    { sourceUrl: 'https://target.test/post', promotionWebsiteUrl: 'https://promo.test/', result: 'submitted_unconfirmed', errorMessage: 'submit observed as success/submit_evidence_without_backlink but backlink verification did not finish before grace timeout' }
  ];

  const match = findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/post/',
    promotionWebsiteUrl: 'promo.test'
  });

  assert.equal(match.shouldSkip, true);
  assert.equal(match.record.result, 'submitted_unconfirmed');
  assert.equal(match.reason, 'duplicate_promotion_submission');

  assert.equal(findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/post/',
    promotionWebsiteUrl: 'https://other-promo.test/'
  }).shouldSkip, false);
});

test('findDuplicatePromotionSubmissionRecord treats success and moderation success as duplicate submissions', () => {
  for (const result of ['success', 'success_pending_moderation', 'pending']) {
    const match = findDuplicatePromotionSubmissionRecord({
      records: [{ url: 'https://target.test/post', promotionWebsiteUrl: 'https://promo.test', result }],
      url: 'https://target.test/post#reply',
      promotionWebsiteUrl: 'https://promo.test/'
    });
    assert.equal(match.shouldSkip, true);
    assert.equal(match.record.result, result);
  }
});

test('findDuplicatePromotionSubmissionRecord skips historical hard-stop source records for the same promotion website', () => {
  const records = [
    { sourceUrl: 'https://target.test/no-comments', promotionWebsiteUrl: 'https://promo.test/', result: 'no_comment_box' },
    { sourceUrl: 'https://target.test/unavailable', promotionWebsiteUrl: 'https://promo.test/', result: 'fail', errorMessage: 'net::ERR_NAME_NOT_RESOLVED' },
    { sourceUrl: 'https://target.test/illegal', promotionWebsiteUrl: 'https://promo.test/', result: 'blocked_illegal' },
    { sourceUrl: 'https://target.test/manual', promotionWebsiteUrl: 'https://other.test/', result: 'manual_required' }
  ];

  assert.equal(findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/no-comments',
    promotionWebsiteUrl: 'https://promo.test/'
  }).reason, 'historical_no_comment_box');

  assert.equal(findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/unavailable/',
    promotionWebsiteUrl: 'https://promo.test/'
  }).reason, 'historical_page_unavailable');

  assert.equal(findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/illegal',
    promotionWebsiteUrl: 'https://promo.test/'
  }).reason, 'historical_blocked_illegal');

  assert.equal(findDuplicatePromotionSubmissionRecord({
    records,
    url: 'https://target.test/manual',
    promotionWebsiteUrl: 'https://promo.test/'
  }).shouldSkip, false);
});

test('getResultDisplay supports source hit skip state', () => {
  const display = getResultDisplay('source_hit');
  assert.equal(display.value, 'source_hit');
  assert.equal(display.category, 'skipped');
  assert.equal(display.text, '\u6e90\u7801\u5df2\u547d\u4e2d');
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

test('buildCompactBatchProgress uses total local result count when recent results are truncated', () => {
  const result = buildCompactBatchProgress({
    snapshot: {
      status: 'running',
      totalCount: 500,
      currentIndex: 121,
      successCount: 80,
      localResultCount: 120,
      localResults: Array.from({ length: 100 }, () => ({})),
      batchStartedAt: 1000
    },
    now: 121000
  });

  assert.equal(result.completed, 120);
  assert.equal(result.percent, 24);
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
