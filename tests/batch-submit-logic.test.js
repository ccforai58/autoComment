const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_SUCCESS_CONFIRMATION_MARKER,
  buildBatchConfirmPayload,
  buildPreSubmitRecoveryPayload,
  normalizeBatchConfirmMessage,
  classifySubmitEvidence,
  findSubmitErrorEvidence,
  classifyRestoredSubmitEvidence
} = require('../lib/batch-submit-logic');

test('buildBatchConfirmPayload emits strict success fields', () => {
  const payload = buildBatchConfirmPayload({
    batchId: 'batch-1',
    urlIndex: 2,
    url: 'https://example.test/post',
    result: 'success',
    aiContent: 'Useful generated comment',
    promotionWebsiteUrl: 'https://target.test/'
  });

  assert.equal(payload.result, 'success');
  assert.equal(payload.confirmedBy, BATCH_SUCCESS_CONFIRMATION_MARKER);
  assert.equal(typeof payload.confirmedAt, 'number');
});

test('normalizeBatchConfirmMessage rejects success without explicit result', () => {
  const normalized = normalizeBatchConfirmMessage({
    confirmedBy: BATCH_SUCCESS_CONFIRMATION_MARKER,
    aiContent: 'Generated comment'
  });

  assert.equal(normalized.result, 'fail');
  assert.equal(normalized.isStrictSuccess, false);
  assert.match(normalized.errorMessage, /missing explicit success result/);
});

test('normalizeBatchConfirmMessage preserves submitted_unconfirmed', () => {
  const normalized = normalizeBatchConfirmMessage({
    result: 'submitted_unconfirmed',
    errorMessage: 'submit triggered but no acceptance signal'
  });

  assert.equal(normalized.result, 'submitted_unconfirmed');
  assert.equal(normalized.errorMessage, 'submit triggered but no acceptance signal');
});

test('classifySubmitEvidence detects strong success', () => {
  const result = classifySubmitEvidence({
    triggerResult: 'ajax',
    successMessageFound: true,
    explicitError: ''
  });

  assert.deepEqual(result, {
    result: 'success',
    reason: 'success_message_found',
    confidence: 'strong'
  });
});

test('classifySubmitEvidence returns submitted_unconfirmed for weak evidence', () => {
  const result = classifySubmitEvidence({
    triggerResult: 'ajax',
    explicitError: ''
  });

  assert.equal(result.result, 'submitted_unconfirmed');
  assert.equal(result.confidence, 'weak');
});

test('classifySubmitEvidence returns fail for ordinary explicit errors', () => {
  const result = classifySubmitEvidence({
    triggerResult: 'ajax',
    explicitError: 'submit failed: duplicate comment detected'
  });

  assert.equal(result.result, 'fail');
  assert.equal(result.reason, 'submit failed: duplicate comment detected');
});

test('classifySubmitEvidence returns manual_required for captcha errors', () => {
  const result = classifySubmitEvidence({
    triggerResult: 'ajax',
    explicitError: 'submit failed: captcha'
  });

  assert.equal(result.result, 'manual_required');
  assert.equal(result.reason, 'submit failed: captcha');
});

test('findSubmitErrorEvidence ignores generic captcha mentions outside explicit errors', () => {
  const result = findSubmitErrorEvidence({
    bodyText: 'This page loads captcha scripts for spam protection but shows no submit error.',
    candidateTexts: []
  });

  assert.equal(result.found, false);
  assert.equal(result.error, '');
  assert.equal(result.bodyCaptchaMention, true);
});

test('findSubmitErrorEvidence detects explicit captcha failure text', () => {
  const result = findSubmitErrorEvidence({
    bodyText: 'Comment form',
    candidateTexts: ['Error: invalid captcha. Please try again.']
  });

  assert.equal(result.found, true);
  assert.equal(result.error, 'submit failed: invalid captcha');
  assert.equal(result.manualRequired, true);
  assert.equal(result.source, 'candidate');
});

test('normalizeBatchConfirmMessage keeps no_comment_box and manual_required unchanged', () => {
  assert.equal(normalizeBatchConfirmMessage({ result: 'no_comment_box' }).result, 'no_comment_box');
  assert.equal(normalizeBatchConfirmMessage({ result: 'manual_required' }).result, 'manual_required');
});

test('buildBatchConfirmPayload does not mark unconfirmed submit as strict success', () => {
  const payload = buildBatchConfirmPayload({
    batchId: 'batch-1',
    urlIndex: 3,
    result: 'submitted_unconfirmed',
    errorMessage: 'submit triggered but no acceptance signal'
  });

  assert.equal(payload.result, 'submitted_unconfirmed');
  assert.equal(payload.confirmedBy, undefined);
  assert.equal(payload.confirmedAt, undefined);
});

test('buildPreSubmitRecoveryPayload stores navigation-prone submits as unconfirmed', () => {
  const payload = buildPreSubmitRecoveryPayload({
    batchId: 'batch-1',
    urlIndex: 4,
    url: 'https://example.test/post',
    aiContent: 'Generated comment before submit',
    promotionWebsiteUrl: 'https://target.test/'
  });

  assert.equal(payload.result, 'submitted_unconfirmed');
  assert.equal(payload.confirmedBy, undefined);
  assert.equal(payload.errorMessage, 'submit started; page changed before confirmation');
});

test('classifyRestoredSubmitEvidence upgrades restored success evidence to success', () => {
  const result = classifyRestoredSubmitEvidence({
    successMessageFound: true
  });

  assert.deepEqual(result, {
    result: 'success',
    reason: 'success_message_found_after_restore',
    confidence: 'strong'
  });
});

test('classifyRestoredSubmitEvidence does not finalize restored pages without acceptance evidence', () => {
  const result = classifyRestoredSubmitEvidence({});

  assert.deepEqual(result, {
    result: 'submitted_unconfirmed',
    reason: 'restored page did not show acceptance signal',
    confidence: 'weak'
  });
});

test('verifyBacklinkInHtml succeeds when anchor href points to promotion host', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<html><body><a href="https://Example.com/">Visit</a></body></html>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, true);
  assert.equal(result.promotionHost, 'example.com');
  assert.equal(result.matchedHref, 'https://Example.com/');
  assert.equal(result.candidateCount, 1);
});

test('verifyBacklinkInHtml ignores plain text URLs without anchor href', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<html><body>https://example.com is mentioned as text</body></html>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, false);
  assert.equal(result.reason, 'no_matching_anchor_href');
});

test('verifyBacklinkInHtml ignores relative anchors that resolve only because of the promotion base', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="#content">Skip</a><a href="/about">About</a><a href="./contact">Contact</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, false);
  assert.equal(result.hostMatchedCount, 0);
  assert.equal(result.reason, 'no_matching_anchor_href');
});

test('verifyBacklinkInHtml accepts protocol-relative backlink anchors', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="//example.com/">Example</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, true);
  assert.equal(result.matchedHref, '//example.com/');
});

test('verifyBacklinkHref rejects stale page anchors from old false success records', () => {
  const { verifyBacklinkHref } = require('../lib/batch-submit-logic');
  const result = verifyBacklinkHref('#content', 'https://example.com');

  assert.equal(result.linkVerified, false);
  assert.equal(result.reason, 'no_matching_anchor_href');
});

test('isVerifiedBacklinkRecord requires a verified external matchedHref', () => {
  const { isVerifiedBacklinkRecord } = require('../lib/batch-submit-logic');

  assert.equal(isVerifiedBacklinkRecord({
    linkVerified: true,
    matchedHref: '#content'
  }, 'https://example.com'), false);

  assert.equal(isVerifiedBacklinkRecord({
    linkVerified: false,
    matchedHref: 'https://example.com/'
  }, 'https://example.com'), false);

  assert.equal(isVerifiedBacklinkRecord({
    linkVerified: true,
    matchedHref: 'https://example.com/'
  }, 'https://example.com'), true);
});

test('verifyBacklinkInHtml accepts http and https protocol differences', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="http://example.com/path/page">Example</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com/path');

  assert.equal(result.linkVerified, true);
  assert.equal(result.pathMatched, true);
});

test('verifyBacklinkInHtml requires specific path prefix when promotion URL has a path', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="https://example.com/other">Other</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com/target');

  assert.equal(result.linkVerified, false);
  assert.equal(result.hostMatchedCount, 1);
  assert.equal(result.reason, 'host_matched_path_mismatched');
});

test('classifyPostSubmitResult returns success only when backlink anchor is found', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<a href="https://promo.test/">Promo</a>',
    promotionUrl: 'https://promo.test',
    pageUrl: 'https://example.test/post/',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'success');
  assert.equal(result.linkVerification.linkVerified, true);
});

test('classifyPostSubmitResult does not count private WordPress moderation preview as public success', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<p>Your comment is awaiting moderation.</p><a href="https://promo.test/">Promo</a>',
    promotionUrl: 'https://promo.test',
    pageUrl: 'https://example.test/post/?unapproved=126722&moderation-hash=abc#comment-126722',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'submitted_unconfirmed');
  assert.equal(result.reason, 'private_moderation_preview_without_public_backlink');
  assert.equal(result.linkVerification.linkVerified, true);
});

test('classifyPostSubmitResult returns submitted_unconfirmed for moderation message without backlink', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<p>Your comment is awaiting moderation.</p>',
    promotionUrl: 'https://promo.test',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'submitted_unconfirmed');
  assert.equal(result.reason, 'submit_evidence_without_backlink');
});

test('classifyPostSubmitResult returns manual_required before ordinary failure', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '',
    promotionUrl: 'https://promo.test',
    submitTriggered: true,
    manualRequired: true,
    explicitError: 'submit failed: captcha'
  });

  assert.equal(result.result, 'manual_required');
});

test('mergeBatchRuntimeState replaces results by originalIndex', () => {
  const { mergeBatchRuntimeState } = require('../lib/batch-submit-logic');
  const previous = {
    batchId: 'batch-1',
    localResults: [{ originalIndex: 0, result: 'fail' }]
  };
  const next = mergeBatchRuntimeState(previous, {
    localResults: [
      { originalIndex: 0, result: 'success' },
      { originalIndex: 1, result: 'submitted_unconfirmed' }
    ]
  });

  assert.equal(next.localResults.length, 2);
  assert.equal(next.localResults[0].result, 'success');
  assert.equal(next.localResults[1].result, 'submitted_unconfirmed');
});

test('computeBatchTimeoutLimit keeps accepted tasks on the shorter configured timeout by default', () => {
  const { computeBatchTimeoutLimit } = require('../lib/batch-submit-logic');

  assert.equal(computeBatchTimeoutLimit({ configuredSeconds: 60, isAccepted: true }), 60);
  assert.equal(computeBatchTimeoutLimit({ configuredSeconds: 15, isAccepted: true }), 15);
  assert.equal(computeBatchTimeoutLimit({ configuredSeconds: 60, isAccepted: false }), 60);
});

test('buildFreshUploadRuntimeState resets restored terminated state for a newly uploaded CSV', () => {
  const { buildFreshUploadRuntimeState } = require('../lib/batch-submit-logic');
  const state = buildFreshUploadRuntimeState({
    status: 'terminated',
    batchId: 'old-batch',
    currentIndex: 7,
    localResults: [{ originalIndex: 0, result: 'fail' }]
  }, 2);

  assert.equal(state.status, 'idle');
  assert.equal(state.batchId, null);
  assert.equal(state.totalCount, 2);
  assert.equal(state.currentIndex, 0);
  assert.equal(state.pendingCount, 0);
  assert.deepEqual(state.localResults, []);
});

test('shouldFinalizePendingSubmitContextAfterGrace only finalizes matching stale submit contexts', () => {
  const { shouldFinalizePendingSubmitContextAfterGrace } = require('../lib/batch-submit-logic');
  const now = 10_000;

  assert.equal(shouldFinalizePendingSubmitContextAfterGrace({
    ctx: { batchId: 'b1', urlIndex: 0, result: 'submitted_unconfirmed', timestamp: 1_000, submitAttemptStarted: true },
    batchId: 'b1',
    urlIndex: 0,
    now,
    graceSeconds: 5
  }), true);

  assert.equal(shouldFinalizePendingSubmitContextAfterGrace({
    ctx: { batchId: 'b1', urlIndex: 0, result: 'submitted_unconfirmed', timestamp: 1_000 },
    batchId: 'b1',
    urlIndex: 0,
    now,
    graceSeconds: 5
  }), false);

  assert.equal(shouldFinalizePendingSubmitContextAfterGrace({
    ctx: { batchId: 'b1', urlIndex: 1, result: 'submitted_unconfirmed', timestamp: 1_000, submitAttemptStarted: true },
    batchId: 'b1',
    urlIndex: 0,
    now,
    graceSeconds: 5
  }), false);

  assert.equal(shouldFinalizePendingSubmitContextAfterGrace({
    ctx: { batchId: 'b1', urlIndex: 0, result: 'success', timestamp: 1_000 },
    batchId: 'b1',
    urlIndex: 0,
    now,
    graceSeconds: 5
  }), false);

  assert.equal(shouldFinalizePendingSubmitContextAfterGrace({
    ctx: { batchId: 'b1', urlIndex: 0, result: 'submitted_unconfirmed', timestamp: 8_000, submitAttemptStarted: true },
    batchId: 'b1',
    urlIndex: 0,
    now,
    graceSeconds: 5
  }), false);
});

test('buildSubmitContextGraceResult preserves strong submit evidence as submitted_unconfirmed', () => {
  const { buildSubmitContextGraceResult } = require('../lib/batch-submit-logic');

  assert.deepEqual(buildSubmitContextGraceResult({
    submitCtx: {
      result: 'submitted_unconfirmed',
      aiContent: 'Generated copy',
      errorMessage: 'old weak message',
      successEvidence: {
        classifiedResult: 'success',
        reason: 'comment_appeared_on_page',
        confidence: 'strong'
      }
    }
  }), {
    result: 'submitted_unconfirmed',
    aiContent: 'Generated copy',
    errorMessage: 'submit observed as success/comment_appeared_on_page but backlink verification did not finish before grace timeout'
  });
});

test('classifyInitialCommentFormScan quickly rejects forms without usable comment inputs', () => {
  const { classifyInitialCommentFormScan } = require('../lib/batch-submit-logic');

  assert.deepEqual(classifyInitialCommentFormScan({
    hasForm: true,
    hasTextarea: false,
    usableCommentFieldCount: 0,
    hasEmbeddedCommentSignal: false
  }), {
    shouldStop: true,
    result: 'no_comment_box',
    errorMessage: 'no usable comment input found'
  });

  assert.deepEqual(classifyInitialCommentFormScan({
    hasForm: true,
    hasTextarea: false,
    usableCommentFieldCount: 0,
    hasEmbeddedCommentSignal: true
  }), {
    shouldStop: false,
    result: '',
    errorMessage: ''
  });

  assert.equal(classifyInitialCommentFormScan({
    hasForm: true,
    hasTextarea: true,
    usableCommentFieldCount: 1
  }).shouldStop, false);
});

test('classifyInitialCommentFormScan stops cross-origin Blogger iframe as manual_required', () => {
  const { classifyInitialCommentFormScan } = require('../lib/batch-submit-logic');

  assert.deepEqual(classifyInitialCommentFormScan({
    hasForm: true,
    hasTextarea: false,
    usableCommentFieldCount: 0,
    hasEmbeddedCommentSignal: true,
    embeddedSignalReason: 'comment_iframe',
    embeddedSignalSrc: 'https://www.blogger.com/comment/frame/123?po=456'
  }), {
    shouldStop: true,
    result: 'manual_required',
    errorMessage: 'embedded Blogger comment iframe requires manual handling'
  });
});

test('classifySubmitButtonClickability allows trusted wpDiscuz submit in unfocused tabs', () => {
  const { classifySubmitButtonClickability } = require('../lib/batch-submit-logic');

  assert.deepEqual(classifySubmitButtonClickability({
    disabled: false,
    ariaDisabled: false,
    display: 'inline-block',
    visibility: 'visible',
    opacity: '1',
    rectWidth: 0,
    rectHeight: 0,
    documentHasFocus: false,
    isTrustedSubmitButton: true
  }), {
    clickable: true,
    reason: 'trusted_submit_button_in_unfocused_tab'
  });

  assert.equal(classifySubmitButtonClickability({
    disabled: false,
    ariaDisabled: false,
    display: 'none',
    visibility: 'visible',
    opacity: '1',
    rectWidth: 20,
    rectHeight: 20,
    documentHasFocus: false,
    isTrustedSubmitButton: true
  }).clickable, false);
});

test('chooseInitialStopReportMode uses confirm channel for manual-required stops', () => {
  const { chooseInitialStopReportMode } = require('../lib/batch-submit-logic');

  assert.equal(chooseInitialStopReportMode({ result: 'manual_required' }), 'confirm_and_close');
  assert.equal(chooseInitialStopReportMode({ result: 'no_comment_box' }), 'report_only');
  assert.equal(chooseInitialStopReportMode({ result: 'fail' }), 'report_only');
});

test('buildSubmitAttemptPlan prefers button click before native requestSubmit', () => {
  const { buildSubmitAttemptPlan } = require('../lib/batch-submit-logic');

  assert.deepEqual(buildSubmitAttemptPlan({ hasForm: true, hasRequestSubmit: true }), [
    'button-click',
    'synthetic-pointer-click',
    'request-submit',
    'fallback-dispatch-click',
    'form-submit'
  ]);

  assert.deepEqual(buildSubmitAttemptPlan({ hasForm: false, hasRequestSubmit: false }), [
    'button-click',
    'synthetic-pointer-click',
    'fallback-dispatch-click'
  ]);
});

test('getBatchPreSubmitDelayMs uses a short human-like delay before batch submit', () => {
  const { getBatchPreSubmitDelayMs } = require('../lib/batch-submit-logic');

  assert.equal(getBatchPreSubmitDelayMs({}), 900);
  assert.equal(getBatchPreSubmitDelayMs({ delayMs: 100 }), 300);
  assert.equal(getBatchPreSubmitDelayMs({ delayMs: 5000 }), 2000);
  assert.equal(getBatchPreSubmitDelayMs({ delayMs: 1200 }), 1200);
});

test('buildBatchCommentFillOptions uses fast human typing so accepted tasks finish before timeout', () => {
  const { buildBatchCommentFillOptions } = require('../lib/batch-submit-logic');

  assert.deepEqual(buildBatchCommentFillOptions({}), {
    fast: false,
    typingStrategy: 'human-fast'
  });
});

test('chooseSubmitLookupStrategy prefers known comment form before document-wide lookup', () => {
  const { chooseSubmitLookupStrategy } = require('../lib/batch-submit-logic');

  assert.equal(chooseSubmitLookupStrategy({ hasPreferredForm: true }), 'preferred-form');
  assert.equal(chooseSubmitLookupStrategy({ hasPreferredForm: false }), 'document-scan');
  assert.equal(chooseSubmitLookupStrategy({}), 'document-scan');
});

test('getPreClickLayoutWaitTimeoutMs keeps pre-click layout wait short and bounded', () => {
  const { getPreClickLayoutWaitTimeoutMs } = require('../lib/batch-submit-logic');

  assert.equal(getPreClickLayoutWaitTimeoutMs({}), 250);
  assert.equal(getPreClickLayoutWaitTimeoutMs({ timeoutMs: 40 }), 50);
  assert.equal(getPreClickLayoutWaitTimeoutMs({ timeoutMs: 5000 }), 1000);
  assert.equal(getPreClickLayoutWaitTimeoutMs({ timeoutMs: 400 }), 400);
});
