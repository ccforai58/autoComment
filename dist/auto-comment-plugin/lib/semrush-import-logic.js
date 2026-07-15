(function initSemrushImportLogic(root) {
  'use strict';

  const DEFAULT_SEMRUSH_IMPORT_OPTIONS = {
    minPageAscore: 5,
    maxPerDomain: 3,
    suspectedDomainMinRows: 20,
    repeatedSignalMinRows: 5,
    repeatedTitleRatio: 0.8,
    repeatedPathRatio: 0.8
  };

  function normalizeCsvHeader(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .replace(/^["']|["']$/g, '')
      .replace(/\s+/g, '')
      .replace(/[_-]+/g, '')
      .toLowerCase();
  }

  function findHeaderIndex(header, names) {
    const accepted = new Set((Array.isArray(names) ? names : []).map(normalizeCsvHeader));
    return (Array.isArray(header) ? header : []).findIndex((item) => accepted.has(normalizeCsvHeader(item)));
  }

  function findSemrushColumns(header) {
    return {
      sourceUrl: findHeaderIndex(header, ['Source url', 'source_url', 'URL', 'url']),
      targetUrl: findHeaderIndex(header, ['Target url', 'target_url']),
      pageAscore: findHeaderIndex(header, ['Page ascore', 'page_ascore', 'ascore']),
      sourceTitle: findHeaderIndex(header, ['Source title', 'source_title', 'title']),
      externalLinks: findHeaderIndex(header, ['External links', 'external_links']),
      lastSeen: findHeaderIndex(header, ['Last seen', 'last_seen'])
    };
  }

  function getDomainFamilyKey(domain) {
    const text = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
    if (!text) return '';
    const parts = text.split('.').filter(Boolean);
    if (parts.length <= 2) return text;
    return parts.slice(1).join('.');
  }

  function normalizeSourceUrl(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!text) return { ok: false, url: '', domain: '', key: '', error: 'empty_url' };

    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, url: '', domain: '', key: '', error: 'unsupported_protocol' };
      }

      const keyUrl = new URL(parsed.href);
      keyUrl.hash = '';
      keyUrl.hostname = keyUrl.hostname.toLowerCase();
      keyUrl.pathname = keyUrl.pathname.replace(/\/+$/, '') || '/';

      return {
        ok: true,
        url: parsed.href,
        domain: keyUrl.hostname.replace(/^www\./, ''),
        key: keyUrl.href.replace(/\/+$/, '').toLowerCase(),
        error: ''
      };
    } catch (_) {
      return { ok: false, url: '', domain: '', key: '', error: 'invalid_url' };
    }
  }

  function parseNumber(value) {
    const number = Number(String(value || '').replace(/,/g, '').trim());
    return Number.isFinite(number) ? number : null;
  }

  function getPathShape(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname
        .replace(/\d+/g, '{n}')
        .replace(/[a-f0-9]{8,}/gi, '{hex}')
        .replace(/\/+$/, '') || '/';
    } catch (_) {
      return '';
    }
  }

  function getRatioOfMostCommon(values) {
    const filtered = Array.isArray(values) ? values.filter(Boolean) : [];
    if (filtered.length === 0) return 0;

    const counts = new Map();
    for (const value of filtered) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    return Math.max(...counts.values()) / filtered.length;
  }

  function createEmptyStats() {
    return {
      totalRows: 0,
      parsedRows: 0,
      validUrlRows: 0,
      invalidUrlRows: 0,
      duplicateUrlRows: 0,
      lowAscoreRows: 0,
      suspectedNetworkDomains: 0,
      confirmedNetworkDomains: 0,
      networkFilteredRows: 0,
      networkReviewRows: 0,
      domainLimitFilteredRows: 0,
      submitReadyRows: 0
    };
  }

  function getSemrushImportErrorCode(result) {
    const diagnostics = Array.isArray(result && result.diagnostics) ? result.diagnostics : [];
    const fatalEntry = diagnostics.find((entry) => entry && entry.level === 'error' && entry.code);
    return fatalEntry ? fatalEntry.code : '';
  }

  function detectSuspectedDomains(candidates, options = {}, illegalSiteFilter = null) {
    const config = { ...DEFAULT_SEMRUSH_IMPORT_OPTIONS, ...options };
    const groups = new Map();

    for (const item of Array.isArray(candidates) ? candidates : []) {
      const key = item && item.reviewKey ? item.reviewKey : (item && item.sourceDomain ? item.sourceDomain : '');
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const suspectedDomains = [];
    const reasonsByDomain = {};
    const diagnostics = [];

    for (const [reviewKey, items] of groups.entries()) {
      const reasons = [];
      const sampleSourceDomain = items[0] && items[0].sourceDomain ? items[0].sourceDomain : reviewKey;

      if (items.length >= config.suspectedDomainMinRows) {
        reasons.push('many_same_domain_rows');
      }
      if (
        items.length >= config.repeatedSignalMinRows &&
        getRatioOfMostCommon(items.map((item) => item.sourceTitle)) >= config.repeatedTitleRatio
      ) {
        reasons.push('repeated_titles');
      }
      if (
        items.length >= config.repeatedSignalMinRows &&
        getRatioOfMostCommon(items.map((item) => getPathShape(item.url))) >= config.repeatedPathRatio
      ) {
        reasons.push('repeated_path_shapes');
      }

      if (illegalSiteFilter && typeof illegalSiteFilter.evaluateUrl === 'function') {
        const check = illegalSiteFilter.evaluateUrl(items[0].url, { sourceDomain: sampleSourceDomain, reviewKey });
        if (check && check.blocked) {
          reasons.push(`illegal_filter:${check.category || 'unknown'}`);
        }
      }

      if (reasons.length === 0) continue;

      suspectedDomains.push(reviewKey);
      reasonsByDomain[reviewKey] = reasons;
      diagnostics.push({
        stage: 'offline_suspect',
        code: 'suspected_domain_candidate',
        domain: sampleSourceDomain,
        reviewKey,
        reasons,
        affectedRows: items.length,
        sampleUrls: items.slice(0, 3).map((item) => sanitizeUrlForLog(item.url))
      });
    }

    return { suspectedDomains, reasonsByDomain, diagnostics };
  }

  function buildSemrushImportRows(input) {
    const header = Array.isArray(input && input.header) ? input.header : [];
    const rows = Array.isArray(input && input.rows) ? input.rows : [];
    const options = { ...DEFAULT_SEMRUSH_IMPORT_OPTIONS, ...((input && input.options) || {}) };
    const columns = findSemrushColumns(header);
    const stats = createEmptyStats();
    const candidates = [];
    const diagnostics = [];
    const seen = new Set();

    stats.totalRows = rows.length;
    if (columns.sourceUrl < 0) {
      return {
        candidates,
        stats,
        diagnostics: [{ stage: 'columns', level: 'error', code: 'missing_source_url' }]
      };
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || [];
      stats.parsedRows++;

      const normalized = normalizeSourceUrl(row[columns.sourceUrl]);
      if (!normalized.ok) {
        stats.invalidUrlRows++;
        diagnostics.push({ stage: 'url', code: normalized.error, rowIndex: index });
        continue;
      }

      if (seen.has(normalized.key)) {
        stats.duplicateUrlRows++;
        continue;
      }
      seen.add(normalized.key);
      stats.validUrlRows++;

      const targetNormalized = columns.targetUrl >= 0 ? normalizeSourceUrl(row[columns.targetUrl]) : { ok: false, domain: '', url: '', key: '' };
      const reviewKey = getDomainFamilyKey(normalized.domain);

      const pageAscore = columns.pageAscore >= 0 ? parseNumber(row[columns.pageAscore]) : null;
      if (pageAscore !== null && pageAscore < options.minPageAscore) {
        stats.lowAscoreRows++;
        continue;
      }

      candidates.push({
        originalIndex: candidates.length,
        csvRowIndex: index,
        url: normalized.url,
        sourceDomain: normalized.domain,
        reviewKey,
        sourceUrlKey: normalized.key,
        targetUrl: targetNormalized.ok ? targetNormalized.url : '',
        targetDomain: targetNormalized.ok ? targetNormalized.domain : '',
        pageAscore,
        sourceTitle: columns.sourceTitle >= 0 ? String(row[columns.sourceTitle] || '').trim() : '',
        externalLinks: columns.externalLinks >= 0 ? parseNumber(row[columns.externalLinks]) : null,
        lastSeen: columns.lastSeen >= 0 ? String(row[columns.lastSeen] || '').trim() : '',
        originalRow: row
      });
    }

    const suspected = detectSuspectedDomains(candidates, options, input && input.illegalSiteFilter);
    stats.suspectedNetworkDomains = suspected.suspectedDomains.length;
    diagnostics.push(...suspected.diagnostics);

    return {
      candidates,
      stats,
      diagnostics,
      suspectedDomains: suspected.suspectedDomains,
      suspectedReasonsByDomain: suspected.reasonsByDomain
    };
  }

  function compareSemrushCandidateQuality(a, b) {
    const aScore = a.pageAscore == null ? -1 : a.pageAscore;
    const bScore = b.pageAscore == null ? -1 : b.pageAscore;
    if (aScore !== bScore) return bScore - aScore;

    const aExternal = a.externalLinks == null ? Number.MAX_SAFE_INTEGER : a.externalLinks;
    const bExternal = b.externalLinks == null ? Number.MAX_SAFE_INTEGER : b.externalLinks;
    if (aExternal !== bExternal) return aExternal - bExternal;

    const aTime = Date.parse(String(a.lastSeen || '').replace(/\//g, '-')) || 0;
    const bTime = Date.parse(String(b.lastSeen || '').replace(/\//g, '-')) || 0;
    if (aTime !== bTime) return bTime - aTime;

    return a.csvRowIndex - b.csvRowIndex;
  }

  function finalizeSemrushCandidates(input) {
    const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];
    const reviewResultsByDomain = (input && input.reviewResultsByDomain) || {};
    const options = { ...DEFAULT_SEMRUSH_IMPORT_OPTIONS, ...((input && input.options) || {}) };
    const stats = createEmptyStats();
    const reviewOnlyItems = [];
    const filteredItems = [];
    const domainCandidates = new Map();
    const failedReviewCandidates = new Map();
    const diagnostics = [];

    for (const item of candidates) {
      const reviewKey = item.reviewKey || item.sourceDomain;
      const review = reviewResultsByDomain[reviewKey];
      if (review && review.status === 'blocked') {
        filteredItems.push({ ...item, filteredReason: review.reason || 'network_review_blocked' });
        stats.networkFilteredRows++;
        continue;
      }

      if (review && review.status === 'review_failed') {
        if (!failedReviewCandidates.has(reviewKey)) failedReviewCandidates.set(reviewKey, []);
        failedReviewCandidates.get(reviewKey).push({ ...item, reviewReason: review.reason || 'network_review_failed' });
        continue;
      }

      if (!domainCandidates.has(reviewKey)) domainCandidates.set(reviewKey, []);
      domainCandidates.get(reviewKey).push(item);
    }

    const submitItems = [];
    for (const [domain, items] of domainCandidates.entries()) {
      const sorted = [...items].sort(compareSemrushCandidateQuality);
      const kept = sorted.slice(0, options.maxPerDomain);
      const dropped = sorted.slice(options.maxPerDomain);

      submitItems.push(...kept);
      filteredItems.push(...dropped.map((item) => ({ ...item, filteredReason: 'domain_limit_exceeded' })));
      stats.domainLimitFilteredRows += dropped.length;

      if (dropped.length > 0) {
        diagnostics.push({
          stage: 'domain_limit',
          code: 'domain_limit_exceeded',
          domain,
          candidateRows: items.length,
          keptRows: kept.length,
          filteredRows: dropped.length
        });
      }
    }

    for (const [domain, items] of failedReviewCandidates.entries()) {
      const sorted = [...items].sort(compareSemrushCandidateQuality);
      const kept = sorted.slice(0, options.maxPerDomain);
      const dropped = sorted.slice(options.maxPerDomain);

      reviewOnlyItems.push(...kept);
      filteredItems.push(...dropped.map((item) => ({ ...item, filteredReason: 'network_review_failed_limit_exceeded' })));
      stats.networkReviewRows += kept.length;
      stats.domainLimitFilteredRows += dropped.length;

      if (dropped.length > 0) {
        diagnostics.push({
          stage: 'network_review_limit',
          code: 'network_review_failed_limit_exceeded',
          domain,
          candidateRows: items.length,
          keptRows: kept.length,
          filteredRows: dropped.length
        });
      }
    }

    submitItems.sort(compareSemrushCandidateQuality);
    stats.submitReadyRows = submitItems.length;

    return {
      submitItems: submitItems.map((item, index) => ({ ...item, originalIndex: index })),
      reviewOnlyItems,
      filteredItems,
      stats,
      diagnostics
    };
  }

  async function runSemrushImport(input) {
    const built = buildSemrushImportRows(input);
    const errorCode = getSemrushImportErrorCode(built);
    const suspected = {
      suspectedDomains: Array.isArray(built.suspectedDomains) ? built.suspectedDomains : [],
      reasonsByDomain: built.suspectedReasonsByDomain || {}
    };

    const reviewResultsByDomain = {};
    const reviewDiagnostics = [];
    const reviewDomain = input && input.reviewDomain;

    for (const domain of suspected.suspectedDomains) {
      const sample = built.candidates.find((item) => (item.reviewKey || item.sourceDomain) === domain);
      const sampleUrl = sample ? sample.url : '';
      if (typeof reviewDomain !== 'function') {
        reviewResultsByDomain[domain] = { status: 'review_failed', reason: 'review_unavailable' };
        reviewDiagnostics.push({
          stage: 'network_review',
          code: 'review_unavailable',
          domain,
          sampleUrl: sanitizeUrlForLog(sampleUrl)
        });
        continue;
      }

      try {
        const reviewResult = await reviewDomain({ domain: sample ? sample.sourceDomain : domain, sampleUrl, reviewKey: domain });
        const sanitizedReviewResult = sanitizeReviewResult(reviewResult);
        reviewResultsByDomain[domain] = sanitizedReviewResult;
        reviewDiagnostics.push({
          stage: 'network_review',
          code: 'review_completed',
          domain,
          status: sanitizedReviewResult && sanitizedReviewResult.status ? sanitizedReviewResult.status : 'unknown',
          reason: sanitizedReviewResult && sanitizedReviewResult.reason ? sanitizedReviewResult.reason : '',
          sampleUrl: sanitizeUrlForLog(sampleUrl)
        });
      } catch (error) {
        const reason = sanitizeReviewReason(error && error.message ? error.message : 'review_error');
        reviewResultsByDomain[domain] = { status: 'review_failed', reason };
        reviewDiagnostics.push({
          stage: 'network_review',
          code: 'review_failed',
          domain,
          reason,
          sampleUrl: sanitizeUrlForLog(sampleUrl)
        });
      }
    }

    const finalized = finalizeSemrushCandidates({
      candidates: built.candidates,
      reviewResultsByDomain,
      options: (input && input.options) || {}
    });

    return {
      ...finalized,
      errorCode,
      stats: {
        ...built.stats,
        suspectedNetworkDomains: suspected.suspectedDomains.length,
        confirmedNetworkDomains: Object.values(reviewResultsByDomain).filter((result) => result && result.status === 'blocked').length,
        networkFilteredRows: finalized.stats.networkFilteredRows,
        networkReviewRows: finalized.stats.networkReviewRows,
        domainLimitFilteredRows: finalized.stats.domainLimitFilteredRows,
        submitReadyRows: finalized.stats.submitReadyRows
      },
      diagnostics: [
        ...built.diagnostics,
        ...reviewDiagnostics,
        ...finalized.diagnostics
      ]
    };
  }

  function buildSemrushImportSummary(stats) {
    const source = stats || {};
    return `\u89e3\u6790 ${source.totalRows || 0} \u884c\uff0c\u53ef\u63d0\u4ea4 ${source.submitReadyRows || 0} \u6761\uff0c\u91cd\u590d ${source.duplicateUrlRows || 0} \u6761\uff0c\u4f4e AScore ${source.lowAscoreRows || 0} \u6761\uff0c\u5f85\u786e\u8ba4 ${source.networkReviewRows || 0} \u6761\uff0c\u540c\u57df\u8d85\u9650 ${source.domainLimitFilteredRows || 0} \u6761`;
  }
  function sanitizeUrlForLog(url) {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      parsed.search = parsed.search ? '?[redacted]' : '';
      parsed.hash = '';
      return parsed.href;
    } catch (_) {
      return String(url || '').split(/[?#]/)[0].slice(0, 200);
    }
  }

  function sanitizeTextForLog(value) {
    const text = String(value == null ? '' : value);
    return text.replace(/https?:\/\/[^\s"'<>`]+/gi, (match) => sanitizeUrlForLog(match));
  }

  function sanitizeReviewReason(value) {
    return sanitizeTextForLog(value).slice(0, 120);
  }

  function sanitizeReviewResult(reviewResult) {
    const source = reviewResult && typeof reviewResult === 'object' ? reviewResult : {};
    const sanitized = { ...source };
    if ('reason' in sanitized) sanitized.reason = sanitizeReviewReason(sanitized.reason);
    if ('message' in sanitized) sanitized.message = sanitizeReviewReason(sanitized.message);
    if ('error' in sanitized) sanitized.error = sanitizeReviewReason(sanitized.error);
    return sanitized;
  }

  const api = {
    DEFAULT_SEMRUSH_IMPORT_OPTIONS,
    normalizeCsvHeader,
    findSemrushColumns,
    normalizeSourceUrl,
    buildSemrushImportRows,
    detectSuspectedDomains,
    finalizeSemrushCandidates,
    runSemrushImport,
    buildSemrushImportSummary,
    sanitizeUrlForLog,
    sanitizeTextForLog,
    getSemrushImportErrorCode
  };

  root.AutoCommentSemrushImportLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
