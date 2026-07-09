function normalizePromotionWebsiteKey(url) {
  const text = String(url || '').trim();
  if (!text) return '__unconfigured__';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    parsed.hash = '';
    return parsed.href.replace(/\/+$/, '').toLowerCase();
  } catch (_) {
    return text.replace(/\/+$/, '').toLowerCase();
  }
}

function getRecordPromotionKey(record) {
  const source = record && typeof record === 'object' ? record : {};
  return source.promotionWebsiteKey || source.copyPromotionWebsiteKey || normalizePromotionWebsiteKey(source.promotionWebsiteUrl);
}

function normalizeSubmissionSourceUrlKey(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.href.toLowerCase();
  } catch (_) {
    return text.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function dedupeCsvSourceUrlItems(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  const seen = new Set();
  const uniqueItems = [];
  let duplicateCount = 0;

  for (const item of sourceItems) {
    const key = normalizeSubmissionSourceUrlKey(item && item.url);
    if (!key) {
      uniqueItems.push(item);
      continue;
    }

    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }

    seen.add(key);
    uniqueItems.push(item);
  }

  return {
    items: uniqueItems,
    duplicateCount
  };
}

const RESULT_DISPLAY = {
  success: {
    value: 'success',
    category: 'success',
    subcategory: 'success',
    text: '成功',
    categoryText: '成功/审核中',
    cssClass: 'success'
  },
  success_pending_moderation: {
    value: 'success_pending_moderation',
    category: 'success',
    subcategory: 'success_pending_moderation',
    text: '提交成功，审核中',
    categoryText: '成功/审核中',
    cssClass: 'success_pending_moderation'
  },
  skipped: {
    value: 'skipped',
    category: 'skipped',
    subcategory: 'skipped',
    text: '已存在',
    categoryText: '已存在',
    cssClass: 'skipped'
  },
  manual_required: {
    value: 'manual_required',
    category: 'action_required',
    subcategory: 'manual_required',
    text: '需手动处理',
    categoryText: '待确认/需手动',
    cssClass: 'manual_required'
  },
  submitted_unconfirmed: {
    value: 'submitted_unconfirmed',
    category: 'action_required',
    subcategory: 'submitted_unconfirmed',
    text: '待确认',
    categoryText: '待确认/需手动',
    cssClass: 'submitted_unconfirmed'
  },
  no_comment_box: {
    value: 'no_comment_box',
    category: 'no_comment_box',
    subcategory: 'no_comment_box',
    text: '无评论框',
    categoryText: '无评论框',
    cssClass: 'no_comment_box'
  },
  blocked_illegal: {
    value: 'blocked_illegal',
    category: 'fail',
    subcategory: 'blocked_illegal',
    text: '已拦截',
    categoryText: '失败/已拦截',
    cssClass: 'blocked_illegal'
  },
  fail: {
    value: 'fail',
    category: 'fail',
    subcategory: 'fail',
    text: '失败',
    categoryText: '失败/已拦截',
    cssClass: 'fail'
  }
};

function normalizeResultValue(result) {
  const raw = String(result || '').trim();
  const normalized = raw.toLowerCase();
  if (normalized === 'ok') return 'success';
  if (normalized === 'manual_required') return 'manual_required';
  if (normalized === 'fail') return 'fail';
  if (normalized === 'blocked' || normalized === 'blocked_illegal') return 'blocked_illegal';
  if (normalized === 'pending' || normalized === 'submitted_unconfirmed') return 'submitted_unconfirmed';
  return RESULT_DISPLAY[raw] ? raw : normalized;
}

function getSubmittedUnconfirmedDisplay(record) {
  const source = record && typeof record === 'object' ? record : {};
  const message = String(source.errorMessage || source.reason || '').toLowerCase();
  const base = { ...RESULT_DISPLAY.submitted_unconfirmed };
  if (/without[_ -]?backlink|backlink verification|未检测到反链|反链/.test(message)) {
    return {
      ...base,
      subcategory: 'unconfirmed_backlink',
      text: '已提交，反链未确认'
    };
  }
  if (/grace timeout|after grace period|confirmation returned|timed out|timeout|超时/.test(message)) {
    return {
      ...base,
      subcategory: 'unconfirmed_timeout',
      text: '已提交，确认超时'
    };
  }
  if (/acceptance signal|no acceptance|page did not show|without acceptance|未确认|未显示/.test(message)) {
    return {
      ...base,
      subcategory: 'unconfirmed_acceptance',
      text: '已提交，页面未确认'
    };
  }
  if (/submit triggered|submit observed|submit started|submitted|已提交/.test(message)) {
    return {
      ...base,
      subcategory: 'unconfirmed_submitted',
      text: '已提交，待确认'
    };
  }
  return base;
}

function getResultDisplay(input) {
  const isRecord = input && typeof input === 'object' && !Array.isArray(input);
  const result = isRecord ? input.result : input;
  const value = normalizeResultValue(result);
  if (value === 'submitted_unconfirmed') return getSubmittedUnconfirmedDisplay(isRecord ? input : { result });
  if (RESULT_DISPLAY[value]) return { ...RESULT_DISPLAY[value] };
  const text = String(result || '').trim() || '未知';
  return {
    value,
    category: value || 'unknown',
    subcategory: value || 'unknown',
    text,
    categoryText: text,
    cssClass: value || 'unknown'
  };
}

function getRecordResultDisplay(record) {
  const source = record && typeof record === 'object' ? record : {};
  return getResultDisplay(source);
}

function resultMatchesFilter(result, filter) {
  const selected = String(filter || 'all').trim();
  if (!selected || selected === 'all') return true;
  const display = getResultDisplay(result);
  if (selected === display.category || selected === display.value) return true;
  if (selected === display.subcategory) return true;
  return false;
}

function buildResultSummary(records) {
  const rows = Array.isArray(records) ? records : [];
  const summary = {
    total: rows.length,
    success: 0,
    skipped: 0,
    manual: 0,
    manualRequired: 0,
    unconfirmedAcceptance: 0,
    unconfirmedBacklink: 0,
    unconfirmedTimeout: 0,
    unconfirmedSubmitted: 0,
    noCommentBox: 0,
    fail: 0,
    successRate: 0
  };
  for (const record of rows) {
    const display = getRecordResultDisplay(record);
    const category = display.category;
    if (category === 'success') summary.success++;
    else if (category === 'skipped') summary.skipped++;
    else if (category === 'action_required') {
      summary.manual++;
      if (display.subcategory === 'manual_required') summary.manualRequired++;
      else if (display.subcategory === 'unconfirmed_acceptance') summary.unconfirmedAcceptance++;
      else if (display.subcategory === 'unconfirmed_backlink') summary.unconfirmedBacklink++;
      else if (display.subcategory === 'unconfirmed_timeout') summary.unconfirmedTimeout++;
      else summary.unconfirmedSubmitted++;
    }
    else if (category === 'no_comment_box') summary.noCommentBox++;
    else if (category === 'fail') summary.fail++;
  }
  summary.successRate = summary.total > 0
    ? Math.round(((summary.success + summary.skipped) / summary.total) * 100)
    : 0;
  return summary;
}

function buildBatchResultSearchText(record) {
  const source = record && typeof record === 'object' ? record : {};
  const display = getRecordResultDisplay(source);
  const domain = source.url ? getHostForFilename(source.url) : '';
  return [
    source.originalIndex != null ? Number(source.originalIndex) + 1 : '',
    source.url,
    domain,
    display.value,
    display.subcategory,
    display.text,
    display.categoryText,
    source.aiContent,
    source.errorMessage,
    source.elapsed != null ? `${source.elapsed}s` : '',
    source.timestamp ? new Date(source.timestamp).toISOString() : ''
  ].join(' ').toLowerCase();
}

function buildArchiveResultSearchText(record) {
  const source = record && typeof record === 'object' ? record : {};
  const display = getRecordResultDisplay(source);
  return [
    source.originalIndex != null ? Number(source.originalIndex) + 1 : '',
    source.promotionWebsiteUrl,
    source.sourceUrl,
    source.url,
    source.sourceDomain,
    display.value,
    display.subcategory,
    display.text,
    display.categoryText,
    source.aiContent,
    source.errorMessage,
    source.batchId,
    source.matchedHref
  ].join(' ').toLowerCase();
}

function filterBatchResultRecords(records, filters) {
  const source = Array.isArray(records) ? records : [];
  const options = filters || {};
  const result = options.result || 'all';
  const domain = options.domain || 'all';
  const keyword = String(options.keyword || '').trim().toLowerCase();
  return source.filter((record) => {
    if (!resultMatchesFilter(record, result)) return false;
    if (domain !== 'all' && getHostForFilename(record && record.url) !== domain) return false;
    if (typeof options.timeBucket === 'function' && !options.timeBucket(record && record.elapsed)) return false;
    if (keyword && !buildBatchResultSearchText(record).includes(keyword)) return false;
    return true;
  });
}

function filterArchiveResultRecords(records, filters) {
  const source = Array.isArray(records) ? records : [];
  const options = filters || {};
  const websiteKey = options.websiteKey || 'all';
  const result = options.result || 'all';
  const keyword = String(options.keyword || '').trim().toLowerCase();
  return source.filter((record) => {
    const recordWebsiteKey = getRecordPromotionKey(record);
    if (websiteKey !== 'all' && recordWebsiteKey !== websiteKey) return false;
    if (!resultMatchesFilter(record, result)) return false;
    if (keyword && !buildArchiveResultSearchText(record).includes(keyword)) return false;
    return true;
  });
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function sortByOriginalIndex(records) {
  return (Array.isArray(records) ? records : []).slice().sort((a, b) => {
    const ai = Number.isFinite(Number(a && a.originalIndex)) ? Number(a.originalIndex) : Number.MAX_SAFE_INTEGER;
    const bi = Number.isFinite(Number(b && b.originalIndex)) ? Number(b.originalIndex) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return Number(a && a.timestamp || 0) - Number(b && b.timestamp || 0);
  });
}

function getExportSourceColumnCount(originalRow) {
  const row = Array.isArray(originalRow) ? originalRow : [];
  const len = row.length;
  if (len <= 0) return 0;
  const lastValue = String(row[len - 1] || '').trim();
  const knownResultValues = new Set(['OK', 'FAIL', 'MANUAL_REQUIRED', 'manual_required', 'success', 'success_pending_moderation', 'fail', 'blocked']);
  return knownResultValues.has(lastValue) ? len - 1 : len;
}

function getExportRunResult(result) {
  const display = getResultDisplay(result);
  if (display.category === 'success' || display.category === 'skipped') return 'OK';
  if (display.category === 'action_required') return 'MANUAL_REQUIRED';
  if (display.value === 'blocked_illegal') return 'BLOCKED';
  return 'FAIL';
}

function buildCurrentBatchExportCsv(input) {
  const source = input && typeof input === 'object' ? input : {};
  const records = sortByOriginalIndex(source.results);
  const sample = records.find((record) => Array.isArray(record.originalRow) && record.originalRow.length > 0);
  if (!sample) {
    return { content: '', filename: '', recordCount: 0, error: 'missing_original_rows' };
  }

  const originalRowLen = getExportSourceColumnCount(sample.originalRow);
  const headers = [];
  for (let i = 0; i < originalRowLen; i++) {
    if (i === 0) headers.push('Page AS');
    else if (i === 1) headers.push('Original URL');
    else if (i === 2) headers.push('URL Domain');
    else if (i === 3) headers.push('Target Domain');
    else if (i === 4) headers.push('Type');
    else if (i === 5) headers.push('External Link Count');
    else headers.push(`Column ${i + 1}`);
  }
  headers.push('Run Result');

  const rows = records.map((record) => {
    const originalRow = Array.isArray(record.originalRow) ? record.originalRow : [];
    const cols = [];
    for (let i = 0; i < originalRowLen; i++) {
      cols.push(csvEscape(originalRow[i] || ''));
    }
    cols.push(csvEscape(getExportRunResult(record.result)));
    return cols.join(',');
  });

  const batchPart = String(source.batchId || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return {
    content: [headers.map(csvEscape).join(','), ...rows].join('\n'),
    filename: `batch-results-current-${batchPart}.csv`,
    recordCount: records.length,
    error: ''
  };
}

function getHostForFilename(urlOrKey) {
  const text = String(urlOrKey || '').trim();
  if (!text || text === 'all') return 'all';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return parsed.hostname || 'site';
  } catch (_) {
    return text.replace(/^https?:\/\//i, '').split('/')[0] || 'site';
  }
}

function filterArchiveRecordsForExport(records, websiteKey) {
  const key = String(websiteKey || 'all');
  return sortByOriginalIndex((Array.isArray(records) ? records : []).filter((record) => {
    if (key === 'all') return true;
    return getRecordPromotionKey(record) === key;
  }));
}

function buildArchiveExportCsv(input) {
  const source = input && typeof input === 'object' ? input : {};
  const websiteKey = source.websiteKey || 'all';
  const records = filterArchiveRecordsForExport(source.records, websiteKey);
  const headers = [
    '#',
    'Batch ID',
    'Source URL',
    'Source Domain',
    'Promotion Website',
    'Result',
    'Error Message',
    'Matched Href',
    'Link Verified',
    'AI Content',
    'Timestamp'
  ];
  const rows = records.map((record) => [
    Number.isFinite(Number(record.originalIndex)) ? Number(record.originalIndex) + 1 : '',
    record.batchId || '',
    record.sourceUrl || record.url || '',
    record.sourceDomain || '',
    record.promotionWebsiteUrl || '',
    record.result || '',
    record.errorMessage || '',
    record.matchedHref || '',
    record.linkVerified === true ? 'TRUE' : (record.linkVerified === false ? 'FALSE' : ''),
    record.aiContent || '',
    record.timestamp ? new Date(record.timestamp).toISOString() : ''
  ].map(csvEscape).join(','));

  const datePart = new Date().toISOString().slice(0, 10);
  const sitePart = getHostForFilename(websiteKey).replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'site';
  return {
    content: [headers.map(csvEscape).join(','), ...rows].join('\n'),
    filename: `batch-results-archive-${sitePart}-${datePart}.csv`,
    recordCount: records.length,
    error: ''
  };
}

function getReportedKeyForResult(record) {
  if (!record || record.batchId == null || record.urlIndex == null) return '';
  return `${record.batchId}:${record.urlIndex}`;
}

function deletePromotionWebsiteRecords(input) {
  const source = input && typeof input === 'object' ? input : {};
  const websiteKey = String(source.websiteKey || '');
  const archiveRecords = Array.isArray(source.archiveRecords) ? source.archiveRecords : [];
  const batchResults = Array.isArray(source.batchResults) ? source.batchResults : [];
  const batchReportedUrls = Array.isArray(source.batchReportedUrls) ? source.batchReportedUrls : [];
  if (!websiteKey || websiteKey === 'all') {
    return {
      archiveRecords,
      batchResults,
      batchReportedUrls,
      removedArchiveCount: 0,
      removedBatchResultCount: 0,
      removedReportedCount: 0
    };
  }

  const removedRuntimeKeys = new Set();
  const nextArchiveRecords = archiveRecords.filter((record) => getRecordPromotionKey(record) !== websiteKey);
  const nextBatchResults = batchResults.filter((record) => {
    if (getRecordPromotionKey(record) !== websiteKey) return true;
    const reportedKey = getReportedKeyForResult(record);
    if (reportedKey) removedRuntimeKeys.add(reportedKey);
    return false;
  });
  const nextReportedUrls = batchReportedUrls.filter((key) => !removedRuntimeKeys.has(String(key)));

  return {
    archiveRecords: nextArchiveRecords,
    batchResults: nextBatchResults,
    batchReportedUrls: nextReportedUrls,
    removedArchiveCount: archiveRecords.length - nextArchiveRecords.length,
    removedBatchResultCount: batchResults.length - nextBatchResults.length,
    removedReportedCount: batchReportedUrls.length - nextReportedUrls.length
  };
}

function deleteAllPromotionWebsiteRecords(input) {
  const source = input && typeof input === 'object' ? input : {};
  const archiveRecords = Array.isArray(source.archiveRecords) ? source.archiveRecords : [];
  const batchResults = Array.isArray(source.batchResults) ? source.batchResults : [];
  const batchReportedUrls = Array.isArray(source.batchReportedUrls) ? source.batchReportedUrls : [];
  return {
    archiveRecords: [],
    batchResults: [],
    batchReportedUrls: [],
    removedArchiveCount: archiveRecords.length,
    removedBatchResultCount: batchResults.length,
    removedReportedCount: batchReportedUrls.length
  };
}

function removeCurrentBatchReportedState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const currentBatchId = String(source.batchId || '');
  const batchResults = Array.isArray(source.batchResults) ? source.batchResults : [];
  const batchReportedUrls = Array.isArray(source.batchReportedUrls) ? source.batchReportedUrls : [];
  if (!currentBatchId) {
    return {
      batchResults,
      batchReportedUrls,
      removedBatchResultCount: 0,
      removedReportedCount: 0
    };
  }

  const prefix = `${currentBatchId}:`;
  const nextBatchResults = batchResults.filter((record) => String(record && record.batchId || '') !== currentBatchId);
  const nextReportedUrls = batchReportedUrls.filter((key) => !String(key).startsWith(prefix));
  return {
    batchResults: nextBatchResults,
    batchReportedUrls: nextReportedUrls,
    removedBatchResultCount: batchResults.length - nextBatchResults.length,
    removedReportedCount: batchReportedUrls.length - nextReportedUrls.length
  };
}

function formatCompactEta(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '估算中';
  const minutes = Math.max(1, Math.ceil(value / 60000));
  if (minutes < 60) return `约 ${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `约 ${hours} 小时 ${rest} 分钟后` : `约 ${hours} 小时后`;
}

function buildCompactBatchProgress(input) {
  const source = input && typeof input === 'object' ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : null;
  if (!snapshot || !snapshot.batchId && !snapshot.totalCount) {
    return { isBatch: false };
  }

  const total = Math.max(0, Number(snapshot.totalCount || 0));
  const completed = Math.min(total, Math.max(0, Array.isArray(snapshot.localResults)
    ? snapshot.localResults.length
    : Number(snapshot.completedCount || 0)));
  const success = Math.max(0, Number(snapshot.successCount || 0));
  const currentRaw = Number(snapshot.currentIndex || 0);
  const current = total > 0 ? Math.min(total, Math.max(1, currentRaw)) : 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const status = String(snapshot.status || 'idle');
  const now = Number.isFinite(Number(source.now)) ? Number(source.now) : Date.now();
  const startedAt = Number(snapshot.batchStartedAt || snapshot.startedAt || 0);

  let etaMs = null;
  let etaText = '估算中';
  if (status === 'completed' || (total > 0 && completed >= total)) {
    etaMs = 0;
    etaText = '已完成';
  } else if (startedAt > 0 && completed > 0 && total > completed) {
    const elapsedMs = Math.max(0, now - startedAt);
    const avgMs = elapsedMs / completed;
    etaMs = Math.max(0, Math.round(avgMs * (total - completed)));
    etaText = formatCompactEta(etaMs);
  }

  const stageText = status === 'running'
    ? '正在处理当前页面'
    : (status === 'terminated' ? '任务已暂停' : (status === 'completed' ? '任务已完成' : '等待开始'));

  return {
    isBatch: true,
    status,
    total,
    completed,
    success,
    current,
    percent,
    etaMs,
    etaText,
    stageText
  };
}

function chooseAssistantProgressTab(input) {
  const source = input && typeof input === 'object' ? input : {};
  const currentTab = source.currentTab === 'progress' ? 'progress' : 'manual';
  if (source.hasBatchContext === true && source.userSelectedTab !== true) {
    return 'progress';
  }
  return currentTab;
}

function buildServiceStatusSummary(input) {
  const source = input && typeof input === 'object' ? input : {};
  const defs = [
    ['backend', 'Backend'],
    ['database', 'Database'],
    ['model', 'AI']
  ];
  const items = defs.map(([key, label]) => {
    const value = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const ok = value.ok === true;
    return {
      key,
      label,
      ok,
      status: ok ? 'ok' : 'bad',
      message: value.message || value.error || (ok ? 'OK' : 'Unavailable')
    };
  });
  const okCount = items.filter((item) => item.ok).length;
  return {
    items,
    okCount,
    totalCount: items.length,
    allOk: okCount === items.length
  };
}

function buildAssistantWarning(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (source.firstGenerationFailed === true || source.warning === 'first_generation_failed') {
    return {
      visible: true,
      level: 'error',
      text: 'AI generation failed and no reusable copy is available. Check the local backend or model service.'
    };
  }

  const reuseCount = Number(source.sameCopyReuseCount || source.reuseCount || 0);
  if (source.warning === 'same_copy_reused_3_times' || reuseCount >= 3) {
    return {
      visible: true,
      level: 'error',
      text: `The same AI copy has been reused ${Math.max(3, reuseCount)} times. Check the local backend or model service.`
    };
  }

  return {
    visible: false,
    level: '',
    text: ''
  };
}

function buildManualReviewTarget(input) {
  const source = input && typeof input === 'object' ? input : {};
  const record = source.record && typeof source.record === 'object' ? source.record : {};
  const resultSource = source.source === 'archive' ? 'archive' : 'current';
  const rawUrl = resultSource === 'archive'
    ? (record.sourceUrl || record.url || '')
    : (record.url || record.sourceUrl || '');
  const text = String(rawUrl || '').trim();
  if (!text) {
    return { ok: false, url: '', source: resultSource, error: 'missing_url' };
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, url: text, source: resultSource, error: 'unsupported_protocol' };
    }
    return { ok: true, url: parsed.href, source: resultSource };
  } catch (_) {
    return { ok: false, url: text, source: resultSource, error: 'invalid_url' };
  }
}

function buildManualReviewOpenMessage(input) {
  const source = input && typeof input === 'object' ? input : {};
  const record = source.record && typeof source.record === 'object' ? source.record : {};
  return {
    type: 'SHOW_PROMOTE_PANEL',
    tab: source.tab === 'progress' ? 'progress' : 'manual',
    presetAiContent: String(record.aiContent || ''),
    presetAiContentSource: 'manual_review'
  };
}

function isDuplicatePromotionSubmissionResult(record) {
  const display = getRecordResultDisplay(record);
  return display.value === 'success' ||
    display.value === 'success_pending_moderation' ||
    display.value === 'submitted_unconfirmed';
}

function findDuplicatePromotionSubmissionRecord(input) {
  const source = input && typeof input === 'object' ? input : {};
  const targetSourceKey = normalizeSubmissionSourceUrlKey(source.url || source.sourceUrl);
  const targetPromotionKey = normalizePromotionWebsiteKey(source.promotionWebsiteUrl);
  if (!targetSourceKey || !targetPromotionKey || targetPromotionKey === '__unconfigured__') {
    return { shouldSkip: false, record: null, reason: '' };
  }

  const records = Array.isArray(source.records) ? source.records : [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (!isDuplicatePromotionSubmissionResult(record)) continue;
    const recordSourceKey = normalizeSubmissionSourceUrlKey(record.sourceUrl || record.url);
    if (recordSourceKey !== targetSourceKey) continue;
    if (getRecordPromotionKey(record) !== targetPromotionKey) continue;
    return {
      shouldSkip: true,
      record,
      reason: 'duplicate_promotion_submission'
    };
  }

  return { shouldSkip: false, record: null, reason: '' };
}

const BatchResultsLogic = {
  normalizePromotionWebsiteKey,
  normalizeSubmissionSourceUrlKey,
  dedupeCsvSourceUrlItems,
  getRecordPromotionKey,
  normalizeResultValue,
  getResultDisplay,
  resultMatchesFilter,
  buildResultSummary,
  buildBatchResultSearchText,
  buildArchiveResultSearchText,
  filterBatchResultRecords,
  filterArchiveResultRecords,
  buildCurrentBatchExportCsv,
  buildArchiveExportCsv,
  deletePromotionWebsiteRecords,
  deleteAllPromotionWebsiteRecords,
  removeCurrentBatchReportedState,
  buildCompactBatchProgress,
  chooseAssistantProgressTab,
  buildServiceStatusSummary,
  buildAssistantWarning,
  buildManualReviewTarget,
  buildManualReviewOpenMessage,
  isDuplicatePromotionSubmissionResult,
  findDuplicatePromotionSubmissionRecord,
  getExportSourceColumnCount,
  getExportRunResult
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BatchResultsLogic;
}

if (typeof window !== 'undefined') {
  window.BatchResultsLogic = BatchResultsLogic;
}
