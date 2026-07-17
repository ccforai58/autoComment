const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getFilteredResources,
  getPagedResources,
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
