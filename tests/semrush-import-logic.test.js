const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemrushImportRows,
  findSemrushColumns
} = require('../lib/semrush-import-logic');

test('Semrush import recognizes Page AS and filters rows below min ascore', () => {
  const header = ['Target url', 'Source url', 'Page AS'];
  const result = buildSemrushImportRows({
    header,
    rows: [
      ['https://discover.test/', 'https://low.test/post', '7'],
      ['https://discover.test/', 'https://high.test/post', '18']
    ],
    options: { minPageAscore: 10, maxPerDomain: 10 }
  });

  assert.equal(findSemrushColumns(header).pageAscore, 2);
  assert.equal(result.stats.lowAscoreRows, 1);
  assert.deepEqual(result.candidates.map((item) => item.url), ['https://high.test/post']);
  assert.equal(result.candidates[0].pageAscore, 18);
});

test('Semrush import recognizes Chinese page AS header aliases', () => {
  const result = buildSemrushImportRows({
    header: ['Target url', 'Source url', '页面AS'],
    rows: [
      ['https://discover.test/', 'https://low.test/post', '3'],
      ['https://discover.test/', 'https://ok.test/post', '11']
    ],
    options: { minPageAscore: 10, maxPerDomain: 10 }
  });

  assert.equal(result.stats.lowAscoreRows, 1);
  assert.deepEqual(result.candidates.map((item) => item.url), ['https://ok.test/post']);
});

test('Semrush import filters blank page ascore values when a minimum is configured', () => {
  const result = buildSemrushImportRows({
    header: ['Target url', 'Source url', 'Page ascore'],
    rows: [
      ['https://discover.test/', 'https://blank.test/post', ''],
      ['https://discover.test/', 'https://ok.test/post', '12']
    ],
    options: { minPageAscore: 10, maxPerDomain: 10 }
  });

  assert.equal(result.stats.lowAscoreRows, 1);
  assert.deepEqual(result.candidates.map((item) => item.url), ['https://ok.test/post']);
});
