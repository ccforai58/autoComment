const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeLogic = require('../../load-this-extension/lib/link-assistant-runtime-logic');

test('loaded extension can create backlink submissions without a stored promotion project id', () => {
  const batchScript = fs.readFileSync(
    path.join(__dirname, '..', '..', 'load-this-extension', 'batch.js'),
    'utf8'
  );

  assert.equal(
    batchScript.includes('!payload.promotionProjectId'),
    false,
    'archive backlink sync must allow backend recovery from targetUrl and sourceUrl'
  );
});

test('archive backlink check payload carries Semrush page ascore from stored metadata', () => {
  const payload = runtimeLogic.buildBacklinkCheckResultPayload({
    record: {
      backendSubmissionId: 123,
      promotionProjectId: 7,
      targetUrl: 'https://ainail.design/',
      sourceUrl: 'https://example.com/post',
      semrushMeta: {
        pageAscore: 42,
        externalLinks: 88,
        lastSeen: '2026-07-14'
      }
    },
    result: {
      latestBacklinkStatus: 'success',
      latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z'
    }
  });

  assert.equal(payload.pageAscore, 42);
  assert.equal(payload.externalLinks, 88);
  assert.equal(payload.lastSeen, '2026-07-14');
});

test('loaded extension emits batch performance timing logs for submission diagnosis', () => {
  const batchScript = fs.readFileSync(
    path.join(__dirname, '..', '..', 'load-this-extension', 'batch.js'),
    'utf8'
  );

  assert.match(batchScript, /function markBatchPerformanceStage/);
  assert.match(batchScript, /batch\.perf\.stage/);
  assert.match(batchScript, /batch\.perf\.summary/);
});
