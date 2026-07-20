const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResourceExportPath,
  buildResourceListPath,
  getFilteredResources,
  getPagedResources,
  getSubmitSourceLabel,
  sortResources
} = require('../../load-this-extension/resource-library');

test('getPagedResources returns only the selected page rows', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: String(index + 1) }));
  const page = getPagedResources(rows, { page: 2, pageSize: 50 });

  assert.equal(page.offset, 50);
  assert.equal(page.rows.length, 10);
  assert.equal(page.rows[0].id, '51');
});

test('sortResources sorts page ascore numerically with blanks last', () => {
  const rows = [
    { id: 'blank', pageAscore: '' },
    { id: 'low', pageAscore: '7' },
    { id: 'high', pageAscore: 42 }
  ];

  assert.deepEqual(sortResources(rows, { sortBy: 'pageAscore', sortDir: 'desc' }).map((row) => row.id), ['high', 'low', 'blank']);
  assert.deepEqual(sortResources(rows, { sortBy: 'pageAscore', sortDir: 'asc' }).map((row) => row.id), ['low', 'high', 'blank']);
});

test('getFilteredResources filters by page ascore range', () => {
  const rows = [
    { id: 'blank', sourceUrl: 'https://blank.test/', pageAscore: '' },
    { id: 'low', sourceUrl: 'https://low.test/', pageAscore: 7 },
    { id: 'mid', sourceUrl: 'https://mid.test/', pageAscore: '18' },
    { id: 'high', sourceUrl: 'https://high.test/', pageAscore: 42 }
  ];

  assert.deepEqual(getFilteredResources(rows, { minPageAscore: 10, maxPageAscore: 40 }).map((row) => row.id), ['mid']);
  assert.deepEqual(getFilteredResources(rows, { minPageAscore: 40 }).map((row) => row.id), ['high']);
  assert.deepEqual(getFilteredResources(rows, { maxPageAscore: 10 }).map((row) => row.id), ['low']);
});

test('getFilteredResources filters by promotion project id', () => {
  const rows = [
    { id: 'a', promotionProjectId: 1, sourceUrl: 'https://a.test/' },
    { id: 'b', promotionProjectId: '2', sourceUrl: 'https://b.test/' },
    { id: 'missing', sourceUrl: 'https://missing.test/' }
  ];

  assert.deepEqual(getFilteredResources(rows, { promotionProjectId: '2' }).map((row) => row.id), ['b']);
  assert.deepEqual(getFilteredResources(rows, { promotionProjectId: '1' }).map((row) => row.id), ['a']);
});

test('getFilteredResources preserves submission source for visible resource rows', () => {
  const rows = [
    { id: 'manual', sourceUrl: 'https://manual.test/', submitSource: 'manual_assistant' },
    { id: 'batch', sourceUrl: 'https://batch.test/', submit_source: 'batch_auto' }
  ];

  const filtered = getFilteredResources(rows, {});

  assert.equal(filtered[0].submitSource, 'manual_assistant');
  assert.equal(filtered[1].submitSource, 'batch_auto');
});

test('getFilteredResources filters by submit source', () => {
  const rows = [
    { id: 'manual', sourceUrl: 'https://manual.test/', submitSource: 'manual_assistant' },
    { id: 'batch', sourceUrl: 'https://batch.test/', submit_source: 'batch_auto' },
    { id: 'empty', sourceUrl: 'https://empty.test/', submitSource: '' },
    { id: 'custom', sourceUrl: 'https://custom.test/', submitSource: 'imported' }
  ];

  assert.deepEqual(getFilteredResources(rows, { submitSource: 'manual_assistant' }).map((row) => row.id), ['manual']);
  assert.deepEqual(getFilteredResources(rows, { submitSource: 'batch_auto' }).map((row) => row.id), ['batch']);
  assert.deepEqual(getFilteredResources(rows, { submitSource: 'other' }).map((row) => row.id), ['empty', 'custom']);
});

test('resource library paths include submit source filter', () => {
  assert.match(buildResourceListPath({ submitSource: 'manual_assistant' }), /submitSource=manual_assistant/);
  assert.match(buildResourceExportPath({ submitSource: 'batch_auto' }), /submitSource=batch_auto/);
});

test('getSubmitSourceLabel renders compact Chinese labels', () => {
  assert.equal(getSubmitSourceLabel('manual_assistant'), '手动助手');
  assert.equal(getSubmitSourceLabel('batch_auto'), '批量自动');
  assert.equal(getSubmitSourceLabel(''), '批量自动');
});
