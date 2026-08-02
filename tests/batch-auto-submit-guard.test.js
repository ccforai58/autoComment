const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCountedAutoSubmitResult,
  countTodayAutoSubmissions,
  getConfirmationCheckpoint,
  validateAutoSubmitGuardSettings,
  createRandomWaitMs,
  shouldScheduleAutoSubmitInterval
} = require('../lib/batch-auto-submit-guard');

test('counts only automated successful or pending submission outcomes', () => {
  assert.equal(isCountedAutoSubmitResult({ submitSource: 'batch_auto', result: 'success' }), true);
  assert.equal(isCountedAutoSubmitResult({ submitSource: 'batch_auto', result: 'success_pending_moderation' }), true);
  assert.equal(isCountedAutoSubmitResult({ submitSource: 'batch_auto', result: 'submitted_unconfirmed' }), true);
  assert.equal(isCountedAutoSubmitResult({ submitSource: 'manual_assistant', result: 'success' }), false);
  assert.equal(isCountedAutoSubmitResult({ submitSource: 'batch_auto', result: 'fail' }), false);
});

test('counts today per promotion website in local calendar time', () => {
  const now = new Date(2026, 7, 1, 12, 0, 0).getTime();
  const total = countTodayAutoSubmissions([
    { promotionWebsiteKey: 'https://promo.test', submitSource: 'batch_auto', result: 'success', timestamp: now },
    { promotionWebsiteKey: 'https://promo.test', submitSource: 'batch_auto', result: 'submitted_unconfirmed', timestamp: now - 1_000 },
    { promotionWebsiteKey: 'https://other.test', submitSource: 'batch_auto', result: 'success', timestamp: now },
    { promotionWebsiteKey: 'https://promo.test', submitSource: 'manual_assistant', result: 'success', timestamp: now },
    { promotionWebsiteKey: 'https://promo.test', submitSource: 'batch_auto', result: 'success', timestamp: new Date(2026, 6, 31, 23, 59, 0).getTime() }
  ], { promotionWebsiteKey: 'https://promo.test', now });
  assert.equal(total, 2);
});

test('requires confirmation at every configured checkpoint', () => {
  assert.equal(getConfirmationCheckpoint(49, 50), 0);
  assert.equal(getConfirmationCheckpoint(50, 50), 50);
  assert.equal(getConfirmationCheckpoint(100, 50), 100);
});

test('validates enabled interval is strictly longer than page timeout', () => {
  assert.equal(validateAutoSubmitGuardSettings({ enabled: true, minMinutes: 5, maxMinutes: 20, timeoutSeconds: 60 }).valid, true);
  assert.equal(validateAutoSubmitGuardSettings({ enabled: true, minMinutes: 1, maxMinutes: 20, timeoutSeconds: 60 }).valid, false);
  assert.equal(validateAutoSubmitGuardSettings({ enabled: false, minMinutes: 1, maxMinutes: 1, timeoutSeconds: 600 }).valid, true);
});

test('creates random waits inside configured inclusive bounds', () => {
  assert.equal(createRandomWaitMs({ minMinutes: 5, maxMinutes: 20, random: () => 0 }), 5 * 60 * 1000);
  assert.equal(createRandomWaitMs({ minMinutes: 5, maxMinutes: 20, random: () => 0.999999 }), 20 * 60 * 1000);
});

test('schedules random intervals only after successful or pending submission results', () => {
  for (const result of ['success', 'success_pending_moderation', 'submitted_unconfirmed']) {
    assert.equal(shouldScheduleAutoSubmitInterval(result), true);
  }
  for (const result of ['skipped', 'source_hit', 'no_comment_box', 'manual_required', 'blocked_illegal', 'fail', 'unknown']) {
    assert.equal(shouldScheduleAutoSubmitInterval(result), false);
  }
});
