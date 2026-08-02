const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldRecordNativeManualSubmission,
  shouldAllowManualAssistant
} = require('../lib/manual-assistant-session-logic');

test('records a native submission only for an active manual session in this page', () => {
  assert.equal(shouldRecordNativeManualSubmission({
    manualSessionActive: true,
    hasLocalBatchContext: false
  }), true);
});

test('does not record a native submission before the user opens manual assistant', () => {
  assert.equal(shouldRecordNativeManualSubmission({
    manualSessionActive: false,
    hasLocalBatchContext: false
  }), false);
});

test('does not record a native submission in the current page batch context', () => {
  assert.equal(shouldRecordNativeManualSubmission({
    manualSessionActive: true,
    hasLocalBatchContext: true
  }), false);
});

test('allows manual assistant in another page without a local batch context', () => {
  assert.equal(shouldAllowManualAssistant({ hasLocalBatchContext: false }), true);
  assert.equal(shouldAllowManualAssistant({ hasLocalBatchContext: true }), false);
});
