const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildManualFieldId,
  chooseManualFieldValue,
  collectManualFinalFieldSnapshot,
  getManualAssistantStatusTone,
  normalizeManualPageType,
  selectBestManualChoiceOption,
  shouldBlockManualAssistantAction,
  shouldAttemptManualFieldFill
} = require('../lib/manual-assistant-field-logic');

test('normalizeManualPageType accepts detected aliases and returns canonical resource types', () => {
  assert.equal(normalizeManualPageType('blog_comment'), 'blog_comment');
  assert.equal(normalizeManualPageType('directory'), 'directory_submission');
  assert.equal(normalizeManualPageType('media'), 'media_submission');
  assert.equal(normalizeManualPageType('profile'), 'profile_link');
  assert.equal(normalizeManualPageType('generic'), 'generic_form');
  assert.equal(normalizeManualPageType('unknown'), 'generic_form');
});

test('buildManualFieldId is deterministic from role and field attributes', () => {
  const field = {
    role: 'websiteUrl',
    label: 'Website URL',
    tagName: 'input',
    type: 'url',
    name: 'website',
    id: 'site-url',
    placeholder: 'https://example.com'
  };

  assert.equal(
    buildManualFieldId(field, 3),
    buildManualFieldId({ ...field }, 3)
  );
  assert.match(buildManualFieldId(field, 3), /^mf_websiteUrl_/);
});

test('chooseManualFieldValue prefers AI values keyed by stable fieldId before role fallback', () => {
  const profile = { website: 'https://fallback.example/', email: 'me@example.com' };
  const fieldValues = {
    websiteUrl: 'https://role.example/',
    fieldValuesById: {
      mf_title_abcd: 'Name Into Flowers'
    }
  };

  assert.equal(
    chooseManualFieldValue({ fieldId: 'mf_title_abcd', role: 'websiteUrl' }, fieldValues, profile, 'comment'),
    'Name Into Flowers'
  );
  assert.equal(
    chooseManualFieldValue({ fieldId: 'missing', role: 'websiteUrl' }, fieldValues, profile, 'comment'),
    'https://role.example/'
  );
});

test('chooseManualFieldValue maps directory-specific roles to generated field values', () => {
  const fieldValues = {
    siteTitle: 'Name Into Flowers',
    tagline: 'Custom floral name art',
    shortDescription: 'Turn names into polished floral artwork.',
    pricingModel: 'Free',
    categorySuggestion: 'Design'
  };

  assert.equal(chooseManualFieldValue({ role: 'title' }, fieldValues, {}, ''), 'Name Into Flowers');
  assert.equal(chooseManualFieldValue({ role: 'tagline' }, fieldValues, {}, ''), 'Custom floral name art');
  assert.equal(chooseManualFieldValue({ role: 'pricingModel' }, fieldValues, {}, ''), 'Free');
  assert.equal(chooseManualFieldValue({ role: 'category' }, fieldValues, {}, ''), 'Design');
});

test('selectBestManualChoiceOption matches custom dropdown choices conservatively', () => {
  const pricingOptions = [
    { value: 'paid', text: 'Paid' },
    { value: 'free', text: 'Free' },
    { value: 'freemium', text: 'Freemium' }
  ];
  const categoryOptions = [
    { value: 'marketing', text: 'Marketing' },
    { value: 'design-tools', text: 'Design Tools' },
    { value: 'productivity', text: 'Productivity' }
  ];

  assert.deepEqual(
    selectBestManualChoiceOption('Free Trial', pricingOptions),
    { index: 1, value: 'free', text: 'Free', score: 80 }
  );
  assert.equal(selectBestManualChoiceOption('Design', categoryOptions).text, 'Design Tools');
  assert.equal(selectBestManualChoiceOption('Unrelated Medical', categoryOptions), null);
});

test('shouldAttemptManualFieldFill does not block low-score manual fields', () => {
  assert.equal(shouldAttemptManualFieldFill({ role: 'title', score: 2, type: 'text' }), true);
  assert.equal(shouldAttemptManualFieldFill({ role: 'unknown', score: 0, type: 'text' }), true);
  assert.equal(shouldAttemptManualFieldFill({ role: 'password', score: 80, type: 'password' }), false);
  assert.equal(shouldAttemptManualFieldFill({ role: 'captcha', score: 80, type: 'text' }), false);
});

test('getManualAssistantStatusTone maps status colors to compact pill styles', () => {
  assert.equal(getManualAssistantStatusTone('#f97373').intent, 'error');
  assert.equal(getManualAssistantStatusTone('#f59e0b').intent, 'warning');
  assert.equal(getManualAssistantStatusTone('#22c55e').intent, 'success');
  assert.equal(getManualAssistantStatusTone('#94a3b8').intent, 'neutral');
});

test('shouldBlockManualAssistantAction blocks a second manual task while busy', () => {
  assert.equal(shouldBlockManualAssistantAction('', 'generate_fill'), false);
  assert.equal(shouldBlockManualAssistantAction('generate_fill', 'submit'), true);
  assert.equal(shouldBlockManualAssistantAction('submit', 'generate_fill'), true);
});

test('collectManualFinalFieldSnapshot captures final DOM values without logging hidden fields', () => {
  const fields = [
    { value: 'edited title', type: 'text' },
    { value: 'secret', type: 'password' },
    { value: 'final comment', type: '', tagName: 'TEXTAREA' }
  ];
  const specs = [
    { fieldId: 'mf_title_1', role: 'title', label: 'Title' },
    { fieldId: 'mf_password_1', role: 'password', label: 'Password' },
    { fieldId: 'mf_comment_1', role: 'comment', label: 'Comment' }
  ];

  const snapshot = collectManualFinalFieldSnapshot(fields, specs);

  assert.equal(snapshot.fields.length, 2);
  assert.equal(snapshot.fields[0].value, 'edited title');
  assert.equal(snapshot.fieldValuesByRole.title, 'edited title');
  assert.equal(snapshot.commentText, 'final comment');
  assert.equal(snapshot.fieldValuesById.mf_comment_1, 'final comment');
});
