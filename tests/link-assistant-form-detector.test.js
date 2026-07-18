const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildManualResourcePayload,
  detectPageTypeFromSignals,
  normalizeStableSourceUrl,
  scoreFieldRole
} = require('../lib/link-assistant-form-detector');

test('normalizeStableSourceUrl prefers canonical URL and strips tracking params', () => {
  const result = normalizeStableSourceUrl({
    canonicalUrl: 'https://Example.com/submit/?utm_source=newsletter&ref=abc&keep=1#form',
    currentUrl: 'https://example.com/temporary/thank-you'
  });

  assert.equal(result.sourceUrl, 'https://example.com/submit/?keep=1');
  assert.equal(result.sourceUrlKey, 'https://example.com/submit?keep=1');
  assert.equal(result.reason, 'canonical');
});

test('normalizeStableSourceUrl falls back to current URL and removes obvious transient params', () => {
  const result = normalizeStableSourceUrl({}, 'https://www.Example.com/post/?fbclid=abc&preview=true&page=2#comments');

  assert.equal(result.sourceUrl, 'https://www.example.com/post/?page=2');
  assert.equal(result.sourceUrlKey, 'https://www.example.com/post?page=2');
  assert.equal(result.reason, 'current');
});

test('detectPageTypeFromSignals recognizes major manual assistant page types', () => {
  assert.equal(detectPageTypeFromSignals({
    formText: 'Leave a comment. Name Email Website Comment Post Comment',
    textareaCount: 1,
    commentSignals: 4
  }).pageType, 'blog_comment');

  assert.equal(detectPageTypeFromSignals({
    formText: 'Submit listing Add site Website URL Category Description Contact email',
    urlInputCount: 1,
    directorySignals: 5
  }).pageType, 'directory_submission');

  assert.equal(detectPageTypeFromSignals({
    formText: 'Submit article Title Abstract Author Bio Body Tags',
    mediaSignals: 5
  }).pageType, 'media_submission');

  assert.equal(detectPageTypeFromSignals({
    formText: 'Edit profile Website Company Bio Social links',
    profileSignals: 4
  }).pageType, 'profile_link');
});

test('scoreFieldRole maps labels and placeholders to stable field roles', () => {
  assert.deepEqual(scoreFieldRole({
    label: 'Website URL',
    name: 'site_url',
    type: 'url'
  }).role, 'websiteUrl');

  assert.deepEqual(scoreFieldRole({
    label: 'Contact Email',
    placeholder: 'you@example.com',
    type: 'email'
  }).role, 'email');

  assert.deepEqual(scoreFieldRole({
    label: 'Short Description',
    placeholder: 'Describe your product'
  }).role, 'description');

  assert.deepEqual(scoreFieldRole({
    label: 'Comment',
    tagName: 'textarea'
  }).role, 'comment');
});

test('buildManualResourcePayload shapes compact resource pool data', () => {
  const payload = buildManualResourcePayload({
    sourceUrl: 'https://Example.com/submit?utm_campaign=x',
    pageType: 'directory_submission',
    pageAscore: '42',
    traffic: '1200',
    qualityLabel: 'high',
    notes: 'Good niche directory',
    sourceTitle: 'Submit your AI site'
  });

  assert.equal(payload.sourceUrl, 'https://example.com/submit');
  assert.equal(payload.resourceType, 'directory_submission');
  assert.equal(payload.pageAscore, 42);
  assert.equal(payload.externalLinks, 1200);
  assert.equal(payload.qualityLabel, 'high');
  assert.equal(payload.notes, 'Good niche directory');
  assert.equal(payload.sourceTitle, 'Submit your AI site');
  assert.equal(payload.submitSource, 'manual_assistant');
});
