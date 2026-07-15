const express = require('express');

const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');

const router = express.Router();
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 2000;
const MAX_RETRY_COUNT = 3;
const MAX_RETRY_DELAY_MS = 10000;
const MAX_RECORDS_PER_REQUEST = 500;

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function getSafeErrorMessage(error) {
  const message = error && error.message ? String(error.message) : String(error || 'unknown_error');
  return message.slice(0, 240);
}

function normalizeRetryCount(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_RETRY_COUNT;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return DEFAULT_RETRY_COUNT;
  return Math.min(MAX_RETRY_COUNT, Math.max(0, Math.round(number)));
}

function normalizeRetryDelayMs(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_RETRY_DELAY_MS;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.round(number)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getElapsedBucket(elapsedMs) {
  const value = Number(elapsedMs);
  if (!Number.isFinite(value)) return 'unknown';
  if (value > 20000) return 'over_20s';
  if (value > 10000) return 'over_10s';
  if (value > 5000) return 'over_5s';
  return 'under_5s';
}

function incrementCount(target, key) {
  const normalizedKey = String(key || 'unknown').slice(0, 120);
  target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

function getSafeHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().slice(0, 120);
  } catch (_) {
    return '';
  }
}

function getPreviousBacklinkStatus(record) {
  return String(record && (
    record.previousBacklinkStatus ||
    record.previousStatus ||
    record.latestBacklinkStatus ||
    ''
  ) || '').trim().slice(0, 80);
}

function buildRecordDiagnostics(records, results) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const items = Array.isArray(results) ? results : [];
  const recordById = new Map();
  for (const record of sourceRecords) {
    if (!record || record.id == null) continue;
    recordById.set(String(record.id), record);
  }

  return items.map((item, index) => {
    const id = item && item.id != null ? String(item.id) : '';
    const record = recordById.get(id) || sourceRecords[index] || {};
    const previousStatus = getPreviousBacklinkStatus(record);
    const status = String(item && item.latestBacklinkStatus || '').trim().slice(0, 80);
    return {
      id: id.slice(0, 120),
      sourceHost: getSafeHostname(record.sourceUrl || record.url),
      promotionHost: getSafeHostname(record.promotionWebsiteUrl),
      previousStatus,
      status,
      reason: String(item && item.latestBacklinkReason || '').slice(0, 160),
      changed: !!previousStatus && previousStatus !== status
    };
  });
}

function buildBacklinkCheckDiagnostics(input) {
  const source = input && typeof input === 'object' ? input : {};
  const results = Array.isArray(source.results) ? source.results : [];
  const elapsedMs = Number.isFinite(Number(source.elapsedMs)) ? Number(source.elapsedMs) : 0;
  const summary = {};
  const reasonSummary = {};

  for (const item of results) {
    incrementCount(summary, item && item.latestBacklinkStatus);
    incrementCount(reasonSummary, item && item.latestBacklinkReason);
  }

  return {
    requestedCount: Number.isFinite(Number(source.requestedCount)) ? Number(source.requestedCount) : results.length,
    checkedCount: Number.isFinite(Number(source.checkedCount)) ? Number(source.checkedCount) : results.length,
    retryCount: normalizeRetryCount(source.retryCount),
    retryDelayMs: normalizeRetryDelayMs(source.retryDelayMs),
    summary,
    reasonSummary,
    recordDiagnostics: buildRecordDiagnostics(source.records, results),
    elapsedMs,
    elapsedBucket: getElapsedBucket(elapsedMs),
    slowRequest: elapsedMs > 10000
  };
}

function createSkippedResult(record, checkedAt, reason) {
  return {
    id: record && record.id != null ? String(record.id) : '',
    latestBacklinkStatus: 'skipped',
    latestBacklinkCheckedAt: checkedAt,
    latestBacklinkMatchedHref: '',
    latestBacklinkReason: reason
  };
}

async function fetchHtml(url, options) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error('fetch_timeout')), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
      headers: {
        'user-agent': 'AutoCommentBacklinkChecker/1.0',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response || response.ok === false) {
      const status = response && response.status ? response.status : 'unknown';
      throw new Error(`http_status_${status}`);
    }
    return await response.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkOneBacklinkRecord(record, options) {
  const checkedAt = options.checkedAt;
  const id = record && record.id != null ? String(record.id) : '';
  const sourceUrl = String(record && (record.sourceUrl || record.url) || '').trim();
  const promotionWebsiteUrl = String(record && record.promotionWebsiteUrl || '').trim();

  if (!sourceUrl) return createSkippedResult({ id }, checkedAt, 'missing_source_url');
  if (!promotionWebsiteUrl) return createSkippedResult({ id }, checkedAt, 'missing_promotion_website');

  const retryCount = normalizeRetryCount(options.retryCount);
  const retryDelayMs = normalizeRetryDelayMs(options.retryDelayMs);
  const delayImpl = typeof options.delayImpl === 'function' ? options.delayImpl : delay;
  let lastResult = null;
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const html = await fetchHtml(sourceUrl, options);
      const verification = verifyBacklinkInHtml(html, promotionWebsiteUrl);
      lastResult = {
        id,
        latestBacklinkStatus: verification.linkVerified ? 'success' : 'missing',
        latestBacklinkCheckedAt: checkedAt,
        latestBacklinkMatchedHref: verification.matchedHref || '',
        latestBacklinkReason: verification.reason || (verification.linkVerified ? 'matching_anchor_href_found' : 'no_matching_anchor_href')
      };
      if (verification.linkVerified || attempt >= retryCount) return lastResult;
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) break;
    }
    if (retryDelayMs > 0) await delayImpl(retryDelayMs);
  }

  if (lastResult) return lastResult;
  return {
    id,
    latestBacklinkStatus: 'error',
    latestBacklinkCheckedAt: checkedAt,
    latestBacklinkMatchedHref: '',
    latestBacklinkReason: getSafeErrorMessage(lastError)
  };
}

async function checkBacklinkRecords(input) {
  const source = input && typeof input === 'object' ? input : {};
  const records = Array.isArray(source.records) ? source.records.slice(0, MAX_RECORDS_PER_REQUEST) : [];
  const now = typeof source.now === 'function' ? source.now : () => new Date();
  const checkedAt = toIsoString(now());
  const startedAt = Date.now();
  const options = {
    fetchImpl: source.fetchImpl,
    timeoutMs: source.timeoutMs,
    retryCount: source.retryCount,
    retryDelayMs: source.retryDelayMs,
    delayImpl: source.delayImpl,
    checkedAt
  };

  const results = [];
  for (const record of records) {
    results.push(await checkOneBacklinkRecord(record, options));
  }

  const elapsedMs = Date.now() - startedAt;
  const diagnostics = buildBacklinkCheckDiagnostics({
    requestedCount: Array.isArray(source.records) ? source.records.length : 0,
    checkedCount: records.length,
    retryCount: source.retryCount,
    retryDelayMs: source.retryDelayMs,
    elapsedMs,
    results,
    records
  });

  console.info('[backlink-check] batch complete', JSON.stringify({ diagnostics }));

  return { checkedAt, results, diagnostics };
}

router.post('/backlink-checks', async (req, res) => {
  try {
    const payload = await checkBacklinkRecords({
      records: req.body && req.body.records,
      timeoutMs: req.body && req.body.timeoutMs,
      retryCount: req.body && req.body.retryCount,
      retryDelayMs: req.body && req.body.retryDelayMs
    });
    res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.error('[backlink-check] batch failed:', {
      error: getSafeErrorMessage(error)
    });
    res.status(500).json({
      success: false,
      error: 'BACKLINK_CHECK_FAILED',
      message: getSafeErrorMessage(error)
    });
  }
});

router.checkBacklinkRecords = checkBacklinkRecords;
router.checkOneBacklinkRecord = checkOneBacklinkRecord;
router.buildBacklinkCheckDiagnostics = buildBacklinkCheckDiagnostics;
router.normalizeRetryCount = normalizeRetryCount;
router.normalizeRetryDelayMs = normalizeRetryDelayMs;

module.exports = router;
