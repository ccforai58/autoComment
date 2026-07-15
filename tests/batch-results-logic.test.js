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
  buildAssistantWarning,
  buildResultSummary,
  filterBatchResultRecords,
  filterArchiveResultRecords,
  getResultDisplay,
  mergeBacklinkCheckResults,
  getLatestBacklinkStatusDisplay,
  buildBacklinkCheckProgress,
  buildBacklinkCheckControlState,
  buildBacklinkCheckProgressText,
  normalizeBacklinkCheckConcurrency,
  normalizeBacklinkRetryDelayMs,
  buildManualReviewTarget,
  buildManualReviewOpenMessage,
  dedupeCsvSourceUrlItems,
  findDuplicatePromotionSubmissionRecord
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
