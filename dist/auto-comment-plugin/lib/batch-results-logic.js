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
  if (result === 'success' || result === 'success_pending_moderation' || result === 'skipped') return 'OK';
  if (result === 'manual_required' || result === 'submitted_unconfirmed') return 'MANUAL_REQUIRED';
  if (result === 'blocked_illegal') return 'BLOCKED';
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

const BatchResultsLogic = {
  normalizePromotionWebsiteKey,
  getRecordPromotionKey,
  buildCurrentBatchExportCsv,
  buildArchiveExportCsv,
  deletePromotionWebsiteRecords,
  deleteAllPromotionWebsiteRecords,
  removeCurrentBatchReportedState,
  buildCompactBatchProgress,
  chooseAssistantProgressTab,
  buildServiceStatusSummary,
  buildAssistantWarning,
  getExportSourceColumnCount,
  getExportRunResult
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BatchResultsLogic;
}

if (typeof window !== 'undefined') {
  window.BatchResultsLogic = BatchResultsLogic;
}
