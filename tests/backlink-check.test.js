const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBacklinkCheckDiagnostics,
  checkBacklinkRecords
} = require('../api/backlink-check');

function createFetchResponse(html, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    async text() {
      return html;
    }
  };
}

test('checkBacklinkRecords marks a source page successful when promotion anchor exists', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://source.test/post');
    return createFetchResponse('<html><a href="https://promo.test/">Promo</a></html>');
  };

  const result = await checkBacklinkRecords({
    records: [{
      id: 'r1',
      sourceUrl: 'https://source.test/post',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl,
    retryCount: 0,
    now: () => new Date('2026-07-13T08:00:00.000Z')
  });

  assert.equal(result.checkedAt, '2026-07-13T08:00:00.000Z');
  assert.deepEqual(result.results, [{
    id: 'r1',
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-13T08:00:00.000Z',
    latestBacklinkMatchedHref: 'https://promo.test/',
    latestBacklinkReason: 'matching_anchor_href_found'
  }]);
});

test('checkBacklinkRecords marks missing when page has no matching promotion anchor', async () => {
  const result = await checkBacklinkRecords({
    records: [{
      id: 'r2',
      sourceUrl: 'https://source.test/post',
      promotionWebsiteUrl: 'https://promo.test/path'
    }],
    fetchImpl: async () => createFetchResponse('<a href="https://promo.test/other">Other</a>'),
    retryCount: 0,
    now: () => new Date('2026-07-13T08:01:00.000Z')
  });

  assert.equal(result.results[0].latestBacklinkStatus, 'missing');
  assert.equal(result.results[0].latestBacklinkMatchedHref, '');
  assert.equal(result.results[0].latestBacklinkReason, 'host_matched_path_mismatched');
});

test('checkBacklinkRecords retries missing backlink after delay before marking final status', async () => {
  const fetchBodies = [
    '<a href="https://other.test/">Other</a>',
    '<a href="https://promo.test/">Promo</a>'
  ];
  const delays = [];

  const result = await checkBacklinkRecords({
    records: [{
      id: 'retry-missing',
      sourceUrl: 'https://source.test/post',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl: async () => createFetchResponse(fetchBodies.shift() || ''),
    retryCount: 1,
    retryDelayMs: 25,
    delayImpl: async (ms) => {
      delays.push(ms);
    },
    now: () => new Date('2026-07-13T08:01:30.000Z')
  });

  assert.deepEqual(delays, [25]);
  assert.equal(result.results[0].latestBacklinkStatus, 'success');
  assert.equal(result.results[0].latestBacklinkMatchedHref, 'https://promo.test/');
  assert.equal(result.results[0].latestBacklinkReason, 'matching_anchor_href_found');
});

test('checkBacklinkRecords retries transient fetch errors before returning error', async () => {
  let attempts = 0;
  const result = await checkBacklinkRecords({
    records: [{
      id: 'retry-error',
      sourceUrl: 'https://source.test/post',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl: async () => {
      attempts++;
      throw new Error(`temporary_${attempts}`);
    },
    retryCount: 2,
    retryDelayMs: 10,
    delayImpl: async () => {},
    now: () => new Date('2026-07-13T08:01:45.000Z')
  });

  assert.equal(attempts, 3);
  assert.equal(result.results[0].latestBacklinkStatus, 'error');
  assert.equal(result.results[0].latestBacklinkReason, 'temporary_3');
});

test('checkBacklinkRecords honors retryCount zero without delay', async () => {
  let attempts = 0;
  let delays = 0;
  const result = await checkBacklinkRecords({
    records: [{
      id: 'no-retry',
      sourceUrl: 'https://source.test/post',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl: async () => {
      attempts++;
      return createFetchResponse('<a href="https://other.test/">Other</a>');
    },
    retryCount: 0,
    retryDelayMs: 10,
    delayImpl: async () => {
      delays++;
    },
    now: () => new Date('2026-07-13T08:01:50.000Z')
  });

  assert.equal(attempts, 1);
  assert.equal(delays, 0);
  assert.equal(result.results[0].latestBacklinkStatus, 'missing');
});

test('checkBacklinkRecords skips records missing source url or promotion website', async () => {
  let fetchCalled = false;
  const result = await checkBacklinkRecords({
    records: [
      { id: 'missing-source', sourceUrl: '', promotionWebsiteUrl: 'https://promo.test/' },
      { id: 'missing-promo', sourceUrl: 'https://source.test/post', promotionWebsiteUrl: '' }
    ],
    fetchImpl: async () => {
      fetchCalled = true;
      return createFetchResponse('');
    },
    retryCount: 0,
    now: () => new Date('2026-07-13T08:02:00.000Z')
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.results[0].latestBacklinkStatus, 'skipped');
  assert.equal(result.results[0].latestBacklinkReason, 'missing_source_url');
  assert.equal(result.results[1].latestBacklinkStatus, 'skipped');
  assert.equal(result.results[1].latestBacklinkReason, 'missing_promotion_website');
});

test('checkBacklinkRecords marks fetch failures as error without leaking sensitive urls', async () => {
  const result = await checkBacklinkRecords({
    records: [{
      id: 'r3',
      sourceUrl: 'https://source.test/post?token=secret',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl: async () => {
      throw new Error('connect ECONNRESET');
    },
    retryCount: 0,
    now: () => new Date('2026-07-13T08:03:00.000Z')
  });

  assert.equal(result.results[0].latestBacklinkStatus, 'error');
  assert.equal(result.results[0].latestBacklinkMatchedHref, '');
  assert.equal(result.results[0].latestBacklinkReason, 'connect ECONNRESET');
});

test('checkBacklinkRecords marks non-2xx responses as error', async () => {
  const result = await checkBacklinkRecords({
    records: [{
      id: 'r4',
      sourceUrl: 'https://source.test/not-found',
      promotionWebsiteUrl: 'https://promo.test/'
    }],
    fetchImpl: async () => createFetchResponse('not found', { ok: false, status: 404 }),
    retryCount: 0,
    now: () => new Date('2026-07-13T08:04:00.000Z')
  });

  assert.equal(result.results[0].latestBacklinkStatus, 'error');
  assert.equal(result.results[0].latestBacklinkReason, 'http_status_404');
});

test('buildBacklinkCheckDiagnostics summarizes statuses, reasons, and elapsed buckets', () => {
  const diagnostics = buildBacklinkCheckDiagnostics({
    requestedCount: 5,
    checkedCount: 4,
    retryCount: 1,
    retryDelayMs: 2000,
    elapsedMs: 26032,
    results: [
      { latestBacklinkStatus: 'success', latestBacklinkReason: 'matching_anchor_href_found' },
      { latestBacklinkStatus: 'missing', latestBacklinkReason: 'host_matched_path_mismatched' },
      { latestBacklinkStatus: 'error', latestBacklinkReason: 'fetch_timeout' },
      { latestBacklinkStatus: 'skipped', latestBacklinkReason: 'missing_source_url' }
    ]
  });

  assert.deepEqual(diagnostics.summary, {
    success: 1,
    missing: 1,
    error: 1,
    skipped: 1
  });
  assert.deepEqual(diagnostics.reasonSummary, {
    matching_anchor_href_found: 1,
    host_matched_path_mismatched: 1,
    fetch_timeout: 1,
    missing_source_url: 1
  });
  assert.equal(diagnostics.slowRequest, true);
  assert.equal(diagnostics.elapsedBucket, 'over_20s');
  assert.equal(diagnostics.requestedCount, 5);
  assert.equal(diagnostics.checkedCount, 4);
});

test('checkBacklinkRecords emits safe per-record diagnostics without full urls', async () => {
  const result = await checkBacklinkRecords({
    records: [{
      id: 'sensitive-record',
      sourceUrl: 'https://source.test/post?token=secret',
      promotionWebsiteUrl: 'https://promo.test/private?api_key=secret',
      previousBacklinkStatus: 'success'
    }],
    fetchImpl: async () => createFetchResponse('<a href="https://other.test/">Other</a>'),
    retryCount: 0,
    now: () => new Date('2026-07-13T08:05:00.000Z')
  });

  assert.deepEqual(result.diagnostics.recordDiagnostics, [{
    id: 'sensitive-record',
    sourceHost: 'source.test',
    promotionHost: 'promo.test',
    previousStatus: 'success',
    status: 'missing',
    reason: 'no_matching_anchor_href',
    changed: true
  }]);
  assert.equal(JSON.stringify(result.diagnostics).includes('token=secret'), false);
  assert.equal(JSON.stringify(result.diagnostics).includes('api_key=secret'), false);
});
