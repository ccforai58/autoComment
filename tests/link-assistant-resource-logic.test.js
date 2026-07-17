const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemrushCompatibleResourceCsv
} = require('../lib/link-assistant-resource-logic');

test('Semrush export preserves original headers and fills known columns for rows without original data', () => {
  const exported = buildSemrushCompatibleResourceCsv({
    rows: [
      {
        sourceUrl: 'https://source.example/post',
        discoveryTargetUrls: ['https://discover.example/page'],
        pageAscore: 42,
        sourceTitle: 'Original title',
        externalLinks: 88,
        lastSeen: '2026-07-14',
        semrushHeaders: ['Target url', 'Source url', 'Page ascore', 'Source title', 'External links', 'Last seen', 'Anchor', 'Extra metric'],
        semrushRow: ['https://old-target.example/', 'https://old-source.example/post', '1', 'Old title', '2', '2025-01-01', 'old anchor', '99']
      },
      {
        sourceUrl: 'https://fallback.example/post',
        discoveryTargetUrls: ['https://fallback-discover.example/page'],
        pageAscore: 7,
        sourceTitle: 'Fallback title',
        externalLinks: 3,
        lastSeen: '2026-07-15'
      }
    ]
  });

  const lines = exported.content.split('\n');
  assert.equal(lines[0], 'Target url,Source url,Page ascore,Source title,External links,Last seen,Anchor,Extra metric');
  assert.equal(lines[1], 'https://discover.example/page,https://source.example/post,42,Original title,88,2026-07-14,old anchor,99');
  assert.equal(lines[2], 'https://fallback-discover.example/page,https://fallback.example/post,7,Fallback title,3,2026-07-15,,');
});
