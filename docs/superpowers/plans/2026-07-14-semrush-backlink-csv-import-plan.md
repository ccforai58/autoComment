# Semrush Backlink CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Semrush backlink CSV import path that filters and ranks `Source url` records before feeding safe, submit-ready URLs into the existing batch workflow.

**Architecture:** Keep Semrush import rules in a new pure logic module so filtering, statistics, dedupe, domain grouping, and network-review orchestration can be tested without the browser UI. Add one local backend endpoint for network review of suspected domains, then wire the batch page to use the module and display concise import statistics. Preserve the existing normal CSV import path.

**Tech Stack:** Chrome extension page JavaScript, Express local backend, Node.js `node:test`, existing PapaParse browser dependency, existing `illegal-site-filter.js`.

## Global Constraints

- Treat all source, HTML, CSS, JSON, Markdown, and config files in this repository as UTF-8.
- Prefer `apply_patch` for manual edits.
- Do not hardcode credentials, API keys, tokens, passwords, cookies, private URLs with secrets, or other sensitive values.
- Do not use Semrush CSV `Target url` to validate the configured promotion website.
- `Lost link=TRUE` does not filter records.
- `External links` is not a hard filter.
- Default `Page ascore` threshold is `5`.
- Default same-domain keep limit is `3`.
- Offline suspected-network rules only trigger network review; they never directly filter URLs.
- The same suspected domain is reviewed online at most once per import.
- If network review fails or times out, all affected same-domain records become review-only and do not enter the submit queue.
- Logs must be diagnostic and must not include secrets, cookies, tokens, passwords, private URL query secrets, or raw credentials.

---

## File Structure

- Create `lib/semrush-import-logic.js`
  - Pure functions for header lookup, URL normalization, AScore parsing, Semrush row normalization, offline suspected-domain detection, dedupe, domain ranking, statistics, safe URL logging, and async import orchestration.
  - Browser-compatible IIFE export plus CommonJS export, matching existing `lib/*-logic.js` patterns.

- Create `tests/semrush-import-logic.test.js`
  - Node tests for all import rules and async network review caching.

- Create `api/semrush-domain-review.js`
  - Express router with `POST /semrush-domain-review`.
  - Fetches a representative URL for one domain with timeout and classifies obvious harmful/network patterns using existing illegal-site style signals and returned HTML metadata.

- Modify `server.js`
  - Mount the new router under `/api`.

- Modify `batch.html`
  - Replace the single upload zone with two side-by-side import zones.
  - Add Semrush import configuration fields and a compact import summary area.
  - Add script tag for `lib/semrush-import-logic.js`.

- Modify `batch.js`
  - Keep normal CSV path working.
  - Add Semrush file handlers, import status updates, diagnostic logging, local API calls for network review, preview rendering, and final `parsedUrls` assignment.

- Modify `manifest.json` and `load-this-extension/manifest.json` only if tests show the existing localhost host permissions are insufficient.
  - Expected: no change needed because local API host permissions already exist.

---

### Task 1: Pure Semrush Import Logic

**Files:**
- Create: `lib/semrush-import-logic.js`
- Create: `tests/semrush-import-logic.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_SEMRUSH_IMPORT_OPTIONS`
  - `normalizeCsvHeader(value: string): string`
  - `findSemrushColumns(header: string[]): { sourceUrl: number, pageAscore: number, sourceTitle: number, externalLinks: number, lastSeen: number }`
  - `normalizeSourceUrl(rawUrl: string): { ok: boolean, url: string, domain: string, key: string, error: string }`
  - `buildSemrushImportRows(input: { header: string[], rows: string[][], options?: object, illegalSiteFilter?: object }): { candidates: object[], stats: object, diagnostics: object[] }`
  - `finalizeSemrushCandidates(input: { candidates: object[], reviewResultsByDomain?: object, options?: object }): { submitItems: object[], reviewOnlyItems: object[], filteredItems: object[], stats: object, diagnostics: object[] }`
  - `buildSemrushImportSummary(stats: object): string`
  - `sanitizeUrlForLog(url: string): string`

- Consumes:
  - Existing `AutoCommentIllegalSiteFilter.evaluateUrl(url, { sourceDomain })` shape when available.

- [ ] **Step 1: Write failing tests for headers, URL normalization, AScore threshold, and non-filters**

Append these tests to `tests/semrush-import-logic.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findSemrushColumns,
  normalizeSourceUrl,
  buildSemrushImportRows,
  finalizeSemrushCandidates
} = require('../lib/semrush-import-logic');

test('findSemrushColumns recognizes Semrush backlink headers', () => {
  const columns = findSemrushColumns([
    'Page ascore',
    'Source title',
    'Source url',
    'Target url',
    'External links',
    'Last seen',
    'Lost link'
  ]);

  assert.equal(columns.sourceUrl, 2);
  assert.equal(columns.pageAscore, 0);
  assert.equal(columns.sourceTitle, 1);
  assert.equal(columns.externalLinks, 4);
  assert.equal(columns.lastSeen, 5);
});

test('normalizeSourceUrl canonicalizes source URL keys', () => {
  assert.deepEqual(normalizeSourceUrl('BLOG.example.com/post/#comments'), {
    ok: true,
    url: 'https://blog.example.com/post/#comments',
    domain: 'blog.example.com',
    key: 'https://blog.example.com/post',
    error: ''
  });
});

test('buildSemrushImportRows filters low AScore with default threshold 5', () => {
  const result = buildSemrushImportRows({
    header: ['Page ascore', 'Source url', 'Lost link', 'External links'],
    rows: [
      ['4', 'https://low.test/post', 'FALSE', '10'],
      ['5', 'https://ok.test/post', 'TRUE', '9999']
    ]
  });

  assert.equal(result.stats.totalRows, 2);
  assert.equal(result.stats.lowAscoreRows, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, 'https://ok.test/post');
});

test('Lost link and External links do not hard-filter Semrush rows', () => {
  const result = buildSemrushImportRows({
    header: ['Page ascore', 'Source url', 'Lost link', 'External links'],
    rows: [
      ['99', 'https://quality-blog.test/post', 'TRUE', '5000']
    ]
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.stats.lowAscoreRows, 0);
  assert.equal(result.stats.validUrlRows, 1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: FAIL because `../lib/semrush-import-logic` does not exist.

- [ ] **Step 3: Implement header lookup, URL normalization, row normalization, and basic filtering**

Create `lib/semrush-import-logic.js` with this public structure:

```js
(function initSemrushImportLogic(root) {
  'use strict';

  const DEFAULT_SEMRUSH_IMPORT_OPTIONS = {
    minPageAscore: 5,
    maxPerDomain: 3,
    suspectedDomainMinRows: 20,
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
    const accepted = new Set(names.map(normalizeCsvHeader));
    return (Array.isArray(header) ? header : []).findIndex((item) => accepted.has(normalizeCsvHeader(item)));
  }

  function findSemrushColumns(header) {
    return {
      sourceUrl: findHeaderIndex(header, ['Source url', 'source_url', 'URL', 'url']),
      pageAscore: findHeaderIndex(header, ['Page ascore', 'page_ascore', 'ascore']),
      sourceTitle: findHeaderIndex(header, ['Source title', 'source_title', 'title']),
      externalLinks: findHeaderIndex(header, ['External links', 'external_links']),
      lastSeen: findHeaderIndex(header, ['Last seen', 'last_seen'])
    };
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
        sourceUrlKey: normalized.key,
        pageAscore,
        sourceTitle: columns.sourceTitle >= 0 ? String(row[columns.sourceTitle] || '').trim() : '',
        externalLinks: columns.externalLinks >= 0 ? parseNumber(row[columns.externalLinks]) : null,
        lastSeen: columns.lastSeen >= 0 ? String(row[columns.lastSeen] || '').trim() : '',
        originalRow: row
      });
    }

    return { candidates, stats, diagnostics };
  }

  function finalizeSemrushCandidates(input) {
    const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];
    return {
      submitItems: candidates.map((item, index) => ({ ...item, originalIndex: index })),
      reviewOnlyItems: [],
      filteredItems: [],
      stats: { ...createEmptyStats(), submitReadyRows: candidates.length },
      diagnostics: []
    };
  }

  function buildSemrushImportSummary(stats) {
    const source = stats || {};
    return `解析 ${source.totalRows || 0} 行，可提交 ${source.submitReadyRows || 0} 条，待确认 ${source.networkReviewRows || 0} 条`;
  }

  function sanitizeUrlForLog(url) {
    try {
      const parsed = new URL(url);
      parsed.search = parsed.search ? '?[redacted]' : '';
      parsed.hash = '';
      return parsed.href;
    } catch (_) {
      return String(url || '').split('?')[0].slice(0, 200);
    }
  }

  const api = {
    DEFAULT_SEMRUSH_IMPORT_OPTIONS,
    normalizeCsvHeader,
    findSemrushColumns,
    normalizeSourceUrl,
    buildSemrushImportRows,
    finalizeSemrushCandidates,
    buildSemrushImportSummary,
    sanitizeUrlForLog
  };

  root.AutoCommentSemrushImportLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 4: Run tests and verify Task 1 passes**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: PASS for the tests added in Step 1.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/semrush-import-logic.js tests/semrush-import-logic.test.js
git commit -m "feat: add semrush import core logic"
```

---

### Task 2: Offline Suspected-Domain Detection and Domain Limiting

**Files:**
- Modify: `lib/semrush-import-logic.js`
- Modify: `tests/semrush-import-logic.test.js`

**Interfaces:**
- Consumes:
  - `buildSemrushImportRows(...)` from Task 1.
  - `finalizeSemrushCandidates(...)` from Task 1.
- Produces:
  - `detectSuspectedDomains(candidates: object[], options?: object, illegalSiteFilter?: object): { suspectedDomains: string[], reasonsByDomain: object, diagnostics: object[] }`
  - Enhanced `finalizeSemrushCandidates(...)` that applies network review results and same-domain keep limits.

- [ ] **Step 1: Write failing tests for loose offline suspicion, review failure, review cache, and same-domain limit**

Append these tests:

```js
test('offline suspected domain detection only marks review candidates', () => {
  const rows = Array.from({ length: 21 }, (_, index) => [
    '30',
    `https://network.test/post-${index}`,
    `Repeated title ${index % 2}`,
    '10',
    '2026/7/1'
  ]);

  const result = buildSemrushImportRows({
    header: ['Page ascore', 'Source url', 'Source title', 'External links', 'Last seen'],
    rows
  });

  assert.equal(result.candidates.length, 21);
  assert.equal(result.stats.suspectedNetworkDomains, 1);
  assert.equal(result.diagnostics.some((entry) => entry.code === 'suspected_domain_candidate'), true);
});

test('network review failure marks same-domain records as review-only', () => {
  const built = buildSemrushImportRows({
    header: ['Page ascore', 'Source url'],
    rows: [
      ['40', 'https://network.test/a'],
      ['40', 'https://network.test/b']
    ]
  });

  const finalized = finalizeSemrushCandidates({
    candidates: built.candidates,
    reviewResultsByDomain: {
      'network.test': { status: 'review_failed', reason: 'timeout' }
    }
  });

  assert.equal(finalized.submitItems.length, 0);
  assert.equal(finalized.reviewOnlyItems.length, 2);
  assert.equal(finalized.stats.networkReviewRows, 2);
});

test('confirmed harmful domain filters every same-domain record', () => {
  const built = buildSemrushImportRows({
    header: ['Page ascore', 'Source url'],
    rows: [
      ['40', 'https://network.test/a'],
      ['40', 'https://network.test/b']
    ]
  });

  const finalized = finalizeSemrushCandidates({
    candidates: built.candidates,
    reviewResultsByDomain: {
      'network.test': { status: 'blocked', category: 'network', reason: 'confirmed link network' }
    }
  });

  assert.equal(finalized.submitItems.length, 0);
  assert.equal(finalized.filteredItems.length, 2);
  assert.equal(finalized.stats.networkFilteredRows, 2);
});

test('same-domain limit keeps best three by AScore, External links, then Last seen', () => {
  const built = buildSemrushImportRows({
    header: ['Page ascore', 'Source url', 'External links', 'Last seen'],
    rows: [
      ['20', 'https://blog.test/a', '500', '2026/7/1'],
      ['50', 'https://blog.test/b', '900', '2026/7/1'],
      ['50', 'https://blog.test/c', '100', '2026/7/1'],
      ['50', 'https://blog.test/d', '100', '2026/7/9']
    ]
  });

  const finalized = finalizeSemrushCandidates({
    candidates: built.candidates,
    options: { maxPerDomain: 3 }
  });

  assert.deepEqual(finalized.submitItems.map((item) => item.url), [
    'https://blog.test/d',
    'https://blog.test/c',
    'https://blog.test/b'
  ]);
  assert.equal(finalized.stats.domainLimitFilteredRows, 1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: FAIL because suspected-domain detection and finalization are still minimal.

- [ ] **Step 3: Implement suspected-domain detection**

Add `detectSuspectedDomains` to `lib/semrush-import-logic.js`:

```js
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
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) return 0;
  const counts = new Map();
  for (const value of filtered) counts.set(value, (counts.get(value) || 0) + 1);
  return Math.max(...counts.values()) / filtered.length;
}

function detectSuspectedDomains(candidates, options = {}, illegalSiteFilter = null) {
  const config = { ...DEFAULT_SEMRUSH_IMPORT_OPTIONS, ...options };
  const groups = new Map();
  for (const item of candidates) {
    const domain = item.sourceDomain || '';
    if (!domain) continue;
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(item);
  }

  const suspectedDomains = [];
  const reasonsByDomain = {};
  const diagnostics = [];

  for (const [domain, items] of groups.entries()) {
    const reasons = [];
    if (items.length >= config.suspectedDomainMinRows) reasons.push('many_same_domain_rows');
    if (getRatioOfMostCommon(items.map((item) => item.sourceTitle)) >= config.repeatedTitleRatio) reasons.push('repeated_titles');
    if (getRatioOfMostCommon(items.map((item) => getPathShape(item.url))) >= config.repeatedPathRatio) reasons.push('repeated_path_shapes');

    if (illegalSiteFilter && typeof illegalSiteFilter.evaluateUrl === 'function') {
      const check = illegalSiteFilter.evaluateUrl(items[0].url, { sourceDomain: domain });
      if (check && check.blocked) reasons.push(`illegal_filter:${check.category || 'unknown'}`);
    }

    if (reasons.length > 0) {
      suspectedDomains.push(domain);
      reasonsByDomain[domain] = reasons;
      diagnostics.push({
        stage: 'offline_suspect',
        code: 'suspected_domain_candidate',
        domain,
        reasons,
        affectedRows: items.length,
        sampleUrls: items.slice(0, 3).map((item) => sanitizeUrlForLog(item.url))
      });
    }
  }

  return { suspectedDomains, reasonsByDomain, diagnostics };
}
```

In `buildSemrushImportRows`, call `detectSuspectedDomains` after candidate creation, set `stats.suspectedNetworkDomains`, and append diagnostics. Do not remove candidates at this stage.

- [ ] **Step 4: Implement finalization with network review results and domain limiting**

Replace the minimal `finalizeSemrushCandidates` with:

```js
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
  const diagnostics = [];

  for (const item of candidates) {
    const review = reviewResultsByDomain[item.sourceDomain];
    if (review && review.status === 'blocked') {
      filteredItems.push({ ...item, filteredReason: review.reason || 'network_review_blocked' });
      stats.networkFilteredRows++;
      continue;
    }
    if (review && review.status === 'review_failed') {
      reviewOnlyItems.push({ ...item, reviewReason: review.reason || 'network_review_failed' });
      stats.networkReviewRows++;
      continue;
    }
    if (!domainCandidates.has(item.sourceDomain)) domainCandidates.set(item.sourceDomain, []);
    domainCandidates.get(item.sourceDomain).push(item);
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
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: PASS.

```bash
git add lib/semrush-import-logic.js tests/semrush-import-logic.test.js
git commit -m "feat: rank and finalize semrush import candidates"
```

---

### Task 3: Local Domain Review API

**Files:**
- Create: `api/semrush-domain-review.js`
- Modify: `server.js`
- Create: `tests/semrush-domain-review.test.js`

**Interfaces:**
- Produces:
  - Express route `POST /api/semrush-domain-review`
  - Request body: `{ domain: string, sampleUrl: string }`
  - Success response: `{ success: true, domain: string, status: 'passed' | 'blocked' | 'review_failed', reason: string, statusCode?: number, durationMs: number }`
- Consumes:
  - Built-in Node `fetch`, `AbortController`, and Express JSON middleware.

- [ ] **Step 1: Write domain review unit tests**

Create `tests/semrush-domain-review.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeReviewDomain,
  classifyDomainReviewHtml,
  buildReviewUrl
} = require('../api/semrush-domain-review');

test('normalizeReviewDomain accepts valid http hostnames only', () => {
  assert.equal(normalizeReviewDomain('https://www.Example.com/path'), 'example.com');
  assert.equal(normalizeReviewDomain('example.com'), 'example.com');
  assert.equal(normalizeReviewDomain('javascript:alert(1)'), '');
});

test('buildReviewUrl prefers sample URL from the same domain', () => {
  assert.equal(
    buildReviewUrl({ domain: 'example.com', sampleUrl: 'https://example.com/post?secret=1' }),
    'https://example.com/post?secret=1'
  );
  assert.equal(
    buildReviewUrl({ domain: 'example.com', sampleUrl: 'https://other.test/post' }),
    'https://example.com/'
  );
});

test('classifyDomainReviewHtml blocks obvious link network pages', () => {
  const result = classifyDomainReviewHtml({
    domain: 'network.test',
    html: '<title>Links Directory</title><body>casino payday loan porn backlinks link exchange</body>',
    statusCode: 200
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /harmful_terms|link_network_terms/);
});

test('classifyDomainReviewHtml passes ordinary blog pages', () => {
  const result = classifyDomainReviewHtml({
    domain: 'blog.test',
    html: '<title>Recipe notes</title><article>A normal personal blog post about cooking.</article>',
    statusCode: 200
  });

  assert.equal(result.status, 'passed');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/semrush-domain-review.test.js`

Expected: FAIL because `api/semrush-domain-review.js` does not exist.

- [ ] **Step 3: Implement the router and exported helpers**

Create `api/semrush-domain-review.js`:

```js
const express = require('express');

const router = express.Router();

const REVIEW_TIMEOUT_MS = Number(process.env.SEMRUSH_DOMAIN_REVIEW_TIMEOUT_MS || 8000);
const MAX_HTML_CHARS = 120000;
const HARMFUL_TERMS = ['porn', 'casino', 'gambling', 'betting', 'sex', 'xxx', 'loan', 'payday loan'];
const LINK_NETWORK_TERMS = ['link exchange', 'backlinks', 'submit url', 'directory links', 'seo links'];

function normalizeReviewDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function buildReviewUrl({ domain, sampleUrl }) {
  const normalizedDomain = normalizeReviewDomain(domain);
  if (!normalizedDomain) return '';
  try {
    const parsedSample = new URL(sampleUrl);
    const sampleDomain = parsedSample.hostname.toLowerCase().replace(/^www\./, '');
    if ((parsedSample.protocol === 'http:' || parsedSample.protocol === 'https:') && sampleDomain === normalizedDomain) {
      return parsedSample.href;
    }
  } catch (_) {}
  return `https://${normalizedDomain}/`;
}

function countTermMatches(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

function classifyDomainReviewHtml({ domain, html, statusCode }) {
  const body = String(html || '').slice(0, MAX_HTML_CHARS);
  if (statusCode >= 400) {
    return { status: 'review_failed', reason: `http_${statusCode}` };
  }
  const harmfulMatches = countTermMatches(body, HARMFUL_TERMS);
  const networkMatches = countTermMatches(body, LINK_NETWORK_TERMS);
  if (harmfulMatches >= 2) return { status: 'blocked', reason: 'harmful_terms' };
  if (networkMatches >= 2) return { status: 'blocked', reason: 'link_network_terms' };
  return { status: 'passed', reason: 'no_blocking_signal' };
}

function sanitizeUrlForServerLog(value) {
  try {
    const parsed = new URL(value);
    parsed.search = parsed.search ? '?[redacted]' : '';
    parsed.hash = '';
    return parsed.href;
  } catch (_) {
    return String(value || '').split('?')[0].slice(0, 200);
  }
}

router.post('/semrush-domain-review', async (req, res) => {
  const startedAt = Date.now();
  const body = req.body || {};
  const domain = normalizeReviewDomain(body.domain);
  const reviewUrl = buildReviewUrl({ domain, sampleUrl: body.sampleUrl });

  if (!domain || !reviewUrl) {
    return res.status(400).json({ success: false, error: 'INVALID_DOMAIN' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
  console.info('[semrush-domain-review] start', { domain, reviewUrl: sanitizeUrlForServerLog(reviewUrl) });

  try {
    const response = await fetch(reviewUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 AutoCommentDomainReview/1.0' }
    });
    const html = await response.text();
    const result = classifyDomainReviewHtml({ domain, html, statusCode: response.status });
    const payload = {
      success: true,
      domain,
      status: result.status,
      reason: result.reason,
      statusCode: response.status,
      durationMs: Date.now() - startedAt
    };
    console.info('[semrush-domain-review] done', payload);
    return res.json(payload);
  } catch (error) {
    const payload = {
      success: true,
      domain,
      status: 'review_failed',
      reason: error.name === 'AbortError' ? 'timeout' : (error.message || 'network_error'),
      durationMs: Date.now() - startedAt
    };
    console.warn('[semrush-domain-review] failed', payload);
    return res.json(payload);
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
module.exports.normalizeReviewDomain = normalizeReviewDomain;
module.exports.buildReviewUrl = buildReviewUrl;
module.exports.classifyDomainReviewHtml = classifyDomainReviewHtml;
```

- [ ] **Step 4: Mount the router**

In `server.js`, add this line after the existing local status/debug routes:

```js
app.use('/api', require('./api/semrush-domain-review'));
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/semrush-domain-review.test.js`

Expected: PASS.

```bash
git add api/semrush-domain-review.js server.js tests/semrush-domain-review.test.js
git commit -m "feat: add semrush domain review api"
```

---

### Task 4: Async Import Orchestration and UI Wiring

**Files:**
- Modify: `lib/semrush-import-logic.js`
- Modify: `tests/semrush-import-logic.test.js`
- Modify: `batch.html`
- Modify: `batch.js`

**Interfaces:**
- Consumes:
  - `buildSemrushImportRows(...)`
  - `detectSuspectedDomains(...)`
  - `finalizeSemrushCandidates(...)`
  - `POST ${API_BASE}/semrush-domain-review`
- Produces:
  - `runSemrushImport(input: { header, rows, options, illegalSiteFilter, reviewDomain }): Promise<{ submitItems, reviewOnlyItems, filteredItems, stats, diagnostics }>`
  - Browser function `processSemrushFile(file: File): Promise<void>`

- [ ] **Step 1: Write async orchestration tests**

Append:

```js
test('runSemrushImport reviews each suspected domain once', async () => {
  const { runSemrushImport } = require('../lib/semrush-import-logic');
  const reviewed = [];
  const rows = Array.from({ length: 25 }, (_, index) => ['40', `https://network.test/post-${index}`, 'Same title']);

  const result = await runSemrushImport({
    header: ['Page ascore', 'Source url', 'Source title'],
    rows,
    reviewDomain: async ({ domain }) => {
      reviewed.push(domain);
      return { status: 'passed', reason: 'test_passed' };
    }
  });

  assert.deepEqual(reviewed, ['network.test']);
  assert.equal(result.submitItems.length, 3);
});

test('runSemrushImport turns review errors into review-only rows', async () => {
  const { runSemrushImport } = require('../lib/semrush-import-logic');
  const rows = Array.from({ length: 25 }, (_, index) => ['40', `https://network.test/post-${index}`, 'Same title']);

  const result = await runSemrushImport({
    header: ['Page ascore', 'Source url', 'Source title'],
    rows,
    reviewDomain: async () => {
      throw new Error('socket closed');
    }
  });

  assert.equal(result.submitItems.length, 0);
  assert.equal(result.reviewOnlyItems.length, 25);
  assert.equal(result.stats.networkReviewRows, 25);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: FAIL because `runSemrushImport` is not implemented.

- [ ] **Step 3: Implement `runSemrushImport`**

Add this function and export it:

```js
async function runSemrushImport(input) {
  const built = buildSemrushImportRows(input);
  const suspected = detectSuspectedDomains(
    built.candidates,
    (input && input.options) || {},
    (input && input.illegalSiteFilter) || null
  );

  const reviewResultsByDomain = {};
  const reviewDomain = input && input.reviewDomain;
  for (const domain of suspected.suspectedDomains) {
    const sample = built.candidates.find((item) => item.sourceDomain === domain);
    if (typeof reviewDomain !== 'function') {
      reviewResultsByDomain[domain] = { status: 'review_failed', reason: 'review_unavailable' };
      continue;
    }
    try {
      reviewResultsByDomain[domain] = await reviewDomain({ domain, sampleUrl: sample ? sample.url : '' });
    } catch (error) {
      reviewResultsByDomain[domain] = { status: 'review_failed', reason: error.message || 'review_error' };
    }
  }

  const finalized = finalizeSemrushCandidates({
    candidates: built.candidates,
    reviewResultsByDomain,
    options: (input && input.options) || {}
  });

  return {
    ...finalized,
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
      ...suspected.diagnostics,
      ...finalized.diagnostics
    ]
  };
}
```

- [ ] **Step 4: Update `batch.html` for side-by-side upload zones**

Modify the upload card to include:

```html
<div class="upload-grid">
  <div class="upload-zone" id="uploadZone">
    <div class="upload-icon" aria-hidden="true">CSV</div>
    <div class="upload-text">普通 CSV</div>
    <div class="upload-hint">包含原 URL 的标准任务文件</div>
    <input type="file" id="fileInput" accept=".csv" />
  </div>
  <div class="upload-zone semrush-upload-zone" id="semrushUploadZone">
    <div class="upload-icon" aria-hidden="true">SEMrush</div>
    <div class="upload-text">Semrush 外链 CSV</div>
    <div class="upload-hint">读取 Source url 并过滤低质量来源</div>
    <input type="file" id="semrushFileInput" accept=".csv" />
  </div>
</div>
<div class="semrush-config" id="semrushConfig">
  <label>Page ascore 最低值
    <input type="number" id="semrushMinAscore" min="0" max="100" value="5" />
  </label>
  <label>同域最多保留
    <input type="number" id="semrushMaxPerDomain" min="1" max="20" value="3" />
  </label>
</div>
<div class="import-status" id="semrushImportStatus" aria-live="polite"></div>
```

Add responsive CSS:

```css
.upload-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.semrush-config {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.semrush-config label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #4b5563;
}

.semrush-config input {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 13px;
}

.import-status {
  margin-top: 10px;
  font-size: 12px;
  color: #4b5563;
}

@media (max-width: 640px) {
  .upload-grid,
  .semrush-config {
    grid-template-columns: 1fr;
  }
}
```

Add script before `batch.js`:

```html
<script src="lib/semrush-import-logic.js"></script>
```

- [ ] **Step 5: Wire Semrush import in `batch.js`**

Add DOM references near existing upload refs:

```js
const semrushUploadZone = document.getElementById('semrushUploadZone');
const semrushFileInput = document.getElementById('semrushFileInput');
const semrushMinAscore = document.getElementById('semrushMinAscore');
const semrushMaxPerDomain = document.getElementById('semrushMaxPerDomain');
const semrushImportStatus = document.getElementById('semrushImportStatus');
```

Add event listeners in the existing initialization section:

```js
semrushUploadZone.addEventListener('click', () => semrushFileInput.click());
semrushFileInput.addEventListener('change', handleSemrushFileSelect);
semrushUploadZone.addEventListener('dragover', handleDragOver);
semrushUploadZone.addEventListener('dragleave', handleDragLeave);
semrushUploadZone.addEventListener('drop', handleSemrushFileDrop);
```

Add these functions:

```js
function handleSemrushFileSelect(e) {
  const file = e.target.files[0];
  if (file) processSemrushFile(file);
}

function handleSemrushFileDrop(e) {
  e.preventDefault();
  semrushUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processSemrushFile(file);
}

function logSemrushImport(stage, details = {}) {
  const entry = { stage, ...details };
  console.info('[batch][semrush-import]', entry);
  sendLocalDebugLog('semrush-import', entry);
}

function setSemrushImportStatus(text) {
  if (semrushImportStatus) semrushImportStatus.textContent = text;
  logSemrushImport('status', { text });
}

async function reviewSemrushDomain({ domain, sampleUrl }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/semrush-domain-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, sampleUrl })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    return { status: 'review_failed', reason: payload.error || `http_${response.status}`, durationMs: Date.now() - startedAt };
  }
  return payload;
}
```

Implement `processSemrushFile`:

```js
async function processSemrushFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('请上传 CSV 文件');
    return;
  }

  try {
    setSemrushImportStatus('正在解析 CSV...');
    const raw = await file.arrayBuffer();
    const text = normalizeEncoding(raw);
    const parsed = Papa.parse(text, { skipEmptyLines: true });
    const rows = parsed.data || [];
    if (rows.length < 2) {
      alert('Semrush CSV 文件为空或格式无效');
      return;
    }

    const logic = window.AutoCommentSemrushImportLogic;
    if (!logic || typeof logic.runSemrushImport !== 'function') {
      alert('Semrush 导入模块未加载');
      return;
    }

    const options = {
      minPageAscore: Number(semrushMinAscore.value || 5),
      maxPerDomain: Number(semrushMaxPerDomain.value || 3)
    };

    logSemrushImport('start', { fileName: file.name, fileSize: file.size, options });
    setSemrushImportStatus('正在去重和离线筛选...');
    const result = await logic.runSemrushImport({
      header: rows[0],
      rows: rows.slice(1),
      options,
      illegalSiteFilter: window.AutoCommentIllegalSiteFilter,
      reviewDomain: async (input) => {
        setSemrushImportStatus(`正在联网复查疑似站群：${input.domain}`);
        return reviewSemrushDomain(input);
      }
    });

    parsedUrls = result.submitItems.map((item, index) => ({
      originalIndex: index,
      url: item.url,
      sourceDomain: item.sourceDomain,
      illegalCheck: null,
      originalRow: item.originalRow,
      semrushMeta: {
        pageAscore: item.pageAscore,
        externalLinks: item.externalLinks,
        lastSeen: item.lastSeen
      }
    }));

    renderSemrushPreview(result);
    fileName.textContent = file.name;
    fileInfo.classList.add('visible');
    uploadZone.classList.remove('has-file');
    semrushUploadZone.classList.add('has-file');
    fileCount.textContent = logic.buildSemrushImportSummary(result.stats);
    updateCostHint(parsedUrls.length);
    resetRuntimeForNewUpload(parsedUrls.length);
    clearRuntimeStorageForNewUpload();
    updateStatsUI();
    updateUI();
    setSemrushImportStatus('导入完成');
    logSemrushImport('complete', { stats: result.stats, diagnostics: result.diagnostics.slice(0, 50) });
  } catch (error) {
    console.error('[batch][semrush-import] failed', error);
    logSemrushImport('failed', { message: error.message || String(error) });
    alert(`Semrush CSV 导入失败：${error.message || error}`);
    setSemrushImportStatus('导入失败');
  }
}
```

Add preview helper:

```js
function renderSemrushPreview(result) {
  urlPreviewBody.innerHTML = '';
  result.submitItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.dataset.url = item.url;
    tr.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(item.sourceDomain || '')}</td><td>${escapeHtml(item.url)}</td>`;
    urlPreviewBody.appendChild(tr);
  });
  duplicateCount.textContent = result.stats.networkReviewRows > 0
    ? `联网复查失败待确认 ${result.stats.networkReviewRows} 条，未提交`
    : '';
  urlPreview.classList.add('visible');
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/semrush-import-logic.test.js`

Expected: PASS.

```bash
git add lib/semrush-import-logic.js tests/semrush-import-logic.test.js batch.html batch.js
git commit -m "feat: wire semrush csv import UI"
```

---

### Task 5: Verification, Diagnostics, and Distribution Copy

**Files:**
- Modify: `batch.js`
- Modify: `batch.html`
- Modify: `dist/auto-comment-plugin/batch.js`
- Modify: `dist/auto-comment-plugin/batch.html`
- Copy/Create: `dist/auto-comment-plugin/lib/semrush-import-logic.js`

**Interfaces:**
- Consumes:
  - Completed UI and logic from Tasks 1-4.
- Produces:
  - Built/extension-loadable copy under `dist/auto-comment-plugin`.

- [ ] **Step 1: Run all Node tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Run mojibake scan**

Run: `node scripts/scan-mojibake.js`

Expected: no new mojibake introduced in modified files. If the script reports pre-existing unrelated files, record them in the task notes and do not rewrite unrelated content.

- [ ] **Step 3: Verify Semrush sample import manually in the browser extension page**

Start backend:

```powershell
npm run dev
```

Open the extension workbench page from the already loaded extension, choose the Semrush CSV sample, and verify:

- The Semrush upload zone accepts the file.
- `Page ascore 最低值` defaults to `5`.
- `同域最多保留` defaults to `3`.
- Import status moves through parsing, offline screening, network review when suspected domains exist, and completion.
- Summary includes parsed rows, submit-ready rows, duplicate rows, low AScore rows, network-review failed rows, and domain-limit filtered rows.
- Review-only rows do not appear in `parsedUrls` and do not affect the cost hint.
- Console logs use `[batch][semrush-import]` and redact URL query strings in diagnostic samples.

- [ ] **Step 4: Copy changed extension files to `dist/auto-comment-plugin`**

Because this repository keeps a loadable extension copy in `dist/auto-comment-plugin`, copy the implemented files after verification:

```powershell
Copy-Item -LiteralPath batch.html -Destination dist/auto-comment-plugin/batch.html
Copy-Item -LiteralPath batch.js -Destination dist/auto-comment-plugin/batch.js
Copy-Item -LiteralPath lib/semrush-import-logic.js -Destination dist/auto-comment-plugin/lib/semrush-import-logic.js
```

Then verify the copied files exist:

```powershell
Test-Path dist/auto-comment-plugin/lib/semrush-import-logic.js
```

Expected: `True`.

- [ ] **Step 5: Check git diff for unrelated edits**

Run: `git status --short`

Expected: only files intentionally changed by this feature plus any pre-existing user changes. Do not revert pre-existing user changes.

- [ ] **Step 6: Commit final integration**

```bash
git add batch.js batch.html lib/semrush-import-logic.js tests/semrush-import-logic.test.js api/semrush-domain-review.js tests/semrush-domain-review.test.js server.js dist/auto-comment-plugin/batch.js dist/auto-comment-plugin/batch.html dist/auto-comment-plugin/lib/semrush-import-logic.js
git commit -m "feat: import semrush backlink csv files"
```
