const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAnchorCandidates,
  normalizeAnchorText,
  ensurePromotionAnchor
} = require('../lib/promotion-anchor-logic');

test('ensurePromotionAnchor rewrites bare promotion URL to contextual anchor with href newline', () => {
  const result = ensurePromotionAnchor(
    'This template is useful. Learn more at https://example.com for practical ideas.',
    {
      promotionUrl: 'https://example.com',
      promotionContent: 'SEO-focused website support and practical optimization ideas',
      pageTitle: 'DIY Guess Who Template',
      usedAnchorTexts: ['helpful resource']
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.hrefNewlinePreserved, true);
  assert.match(result.text, /<a href="https:\/\/example\.com\/\n">[^<]+<\/a>/);
  assert.equal(result.anchorText.includes('example.com'), false);
  assert.equal(result.anchorWasDuplicate, false);
});

test('ensurePromotionAnchor replaces duplicate or URL-like anchor text', () => {
  const result = ensurePromotionAnchor(
    'I found <a href="https://example.com/">https://example.com</a> while reading this.',
    {
      promotionUrl: 'https://example.com/',
      promotionContent: 'custom flower name art and personalized floral name design',
      usedAnchorTexts: ['custom flower name art']
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.hrefNewlinePreserved, true);
  assert.equal(result.anchorText, 'personalized floral name design');
  assert.equal(result.anchorWasDuplicate, false);
  assert.match(result.text, /<a href="https:\/\/example\.com\/\n">personalized floral name design<\/a>/);
});

test('buildAnchorCandidates avoids generic and duplicate anchor text', () => {
  const candidates = buildAnchorCandidates({
    promotionUrl: 'https://nameintoflowers.com',
    promotionContent: 'Name Into Flowers creates custom flower name art and personalized floral name images.',
    pageTitle: 'Student nursing organization story',
    usedAnchorTexts: ['custom flower name art']
  });

  assert.equal(candidates.includes('custom flower name art'), false);
  assert.equal(candidates.some((candidate) => /flower|floral/i.test(candidate)), true);
  assert.equal(candidates.some((candidate) => /nameintoflowers\.com|https?:\/\//i.test(candidate)), false);
});

test('normalizeAnchorText rejects URLs, domains, and generic anchors', () => {
  assert.equal(normalizeAnchorText('https://example.com'), '');
  assert.equal(normalizeAnchorText('example.com'), '');
  assert.equal(normalizeAnchorText('click here'), '');
  assert.equal(normalizeAnchorText(' practical SEO ideas '), 'practical SEO ideas');
});
