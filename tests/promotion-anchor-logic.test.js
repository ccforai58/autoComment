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

test('ensurePromotionAnchor removes a dangling trailing anchor before appending a complete one', () => {
  const result = ensurePromotionAnchor(
    'This article has helpful ideas for preserving memories, and it pairs well with <a href="https://nameintoflowers.com/',
    {
      promotionUrl: 'https://nameintoflowers.com/',
      promotionKeywords: ['name into flowers', 'flower name art'],
      promotionContent: 'Keywords: name into flowers, flower name art',
      usedAnchorTexts: []
    }
  );

  assert.equal(result.changed, true);
  assert.match(result.text, /preserving memories, and it pairs well with\s+<a href="https:\/\/nameintoflowers\.com\/\n">name into flowers<\/a>$/);
  assert.doesNotMatch(result.text, /<a href="https:\/\/nameintoflowers\.com\/<a href=/);
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

test('buildAnchorCandidates requires anchor roots from promotion keywords when provided', () => {
  const candidates = buildAnchorCandidates({
    promotionUrl: 'https://ainail.design/',
    promotionKeywords: ['AI nail design', 'nail art generator'],
    promotionContent: 'Title: AI Nail Design\nDescription: Create nail art ideas from prompts.',
    pageTitle: 'Beauty salon booking tips',
    pageDescription: 'Ideas for salon owners and beauty creators.',
    usedAnchorTexts: ['ai nail design']
  });

  assert.equal(candidates.includes('ai nail design'), false);
  assert.equal(candidates.some((candidate) => /^nail\b|\bnail\b/i.test(candidate)), true);
  assert.equal(candidates.some((candidate) => /salon booking tips/i.test(candidate)), false);
  assert.equal(candidates.every((candidate) => candidate.split(/\s+/).length <= 4), true);
});

test('ensurePromotionAnchor rewrites off-topic model anchor to keyword-rooted phrase', () => {
  const result = ensurePromotionAnchor(
    'This is relevant to <a href="https://ainail.design/">salon booking tips</a>.',
    {
      promotionUrl: 'https://ainail.design/',
      promotionKeywords: ['AI nail design', 'nail art generator'],
      promotionContent: 'Description: AI nail design ideas and nail art generator workflows.',
      usedAnchorTexts: ['ai nail design']
    }
  );

  assert.equal(result.changed, true);
  assert.match(result.anchorText, /nail/i);
  assert.doesNotMatch(result.anchorText, /salon booking tips/i);
});

test('normalizeAnchorText rejects URLs, domains, and generic anchors', () => {
  assert.equal(normalizeAnchorText('https://example.com'), '');
  assert.equal(normalizeAnchorText('example.com'), '');
  assert.equal(normalizeAnchorText('click here'), '');
  assert.equal(normalizeAnchorText(' practical SEO ideas '), 'practical SEO ideas');
});
