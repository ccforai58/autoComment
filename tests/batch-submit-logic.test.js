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

test('normalizeBatchConfirmMessage preserves pending moderation success status', () => {
  const normalized = normalizeBatchConfirmMessage({
    result: 'success_pending_moderation',
    confirmedBy: BATCH_SUCCESS_CONFIRMATION_MARKER
  });

  assert.equal(normalized.result, 'success_pending_moderation');
  assert.equal(normalized.isStrictSuccess, true);
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

test('classifyPostSubmitResult treats moderation preview with backlink as success pending moderation', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<p>Your comment is awaiting moderation.</p><a href="https://promo.test/">Promo</a>',
    promotionUrl: 'https://promo.test',
    pageUrl: 'https://example.test/post/?unapproved=126722&moderation-hash=abc#comment-126722',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'success_pending_moderation');
  assert.equal(result.reason, 'backlink_anchor_found_in_moderation_preview');
  assert.equal(result.linkVerification.linkVerified, true);
});

test('buildBatchConfirmPayload marks pending moderation success as confirmed success evidence', () => {
  const payload = buildBatchConfirmPayload({
    batchId: 'batch-1',
    urlIndex: 2,
    result: 'success_pending_moderation',
    confirmedAt: 123
  });

  assert.equal(payload.result, 'success_pending_moderation');
  assert.equal(payload.confirmedBy, BATCH_SUCCESS_CONFIRMATION_MARKER);
  assert.equal(payload.confirmedAt, 123);
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

test('buildSubmitContextGraceResult records weak submit evidence instead of generic timeout', () => {
  const { buildSubmitContextGraceResult } = require('../lib/batch-submit-logic');

  assert.deepEqual(buildSubmitContextGraceResult({
    submitCtx: {
      result: 'submitted_unconfirmed',
      aiContent: 'Generated copy',
      successEvidence: {
        classifiedResult: 'submitted_unconfirmed',
        reason: 'submit triggered but no acceptance signal',
        confidence: 'weak'
      }
    }
  }), {
    result: 'submitted_unconfirmed',
    aiContent: 'Generated copy',
    errorMessage: 'submit observed as submitted_unconfirmed/submit triggered but no acceptance signal before grace timeout'
  });
});

test('safeLowerString handles non-string DOMTokenList-like values', () => {
  const { safeLowerString } = require('../lib/batch-submit-logic');
  const tokenListLike = { toString() { return 'Comment Form'; } };

  assert.equal(safeLowerString(tokenListLike), 'comment form');
  assert.equal(safeLowerString(null), '');
  assert.equal(safeLowerString(123), '123');
});

test('classifyDomainDrift blocks unexpected page drift away from original URL host', () => {
  const { classifyDomainDrift } = require('../lib/batch-submit-logic');

  assert.deepEqual(classifyDomainDrift({
    originalUrl: 'https://www.completelydelicious.com/tips/make-brownies-shiny-crackly-crust/',
    currentUrl: 'https://removebgvideo.com/'
  }), {
    drifted: true,
    result: 'fail',
    errorMessage: 'target page drifted from completelydelicious.com to removebgvideo.com',
    originalHost: 'completelydelicious.com',
    currentHost: 'removebgvideo.com'
  });

  assert.equal(classifyDomainDrift({
    originalUrl: 'https://example.com/post',
    currentUrl: 'https://www.example.com/post#comment-1'
  }).drifted, false);
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

  assert.deepEqual(classifyInitialCommentFormScan({
    hasForm: false,
    hasTextarea: false,
    usableCommentFieldCount: 0,
    hasEmbeddedCommentSignal: false
  }), {
    shouldStop: true,
    result: 'no_comment_box',
    errorMessage: 'no comment form found'
  });

  assert.equal(classifyInitialCommentFormScan({
    hasForm: false,
    hasTextarea: false,
    usableCommentFieldCount: 0,
    hasEmbeddedCommentSignal: true,
    embeddedSignalReason: 'comment_action'
  }).shouldStop, false);

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

test('chooseInitialStopReportMode uses confirm channel for terminal initial stops', () => {
  const { chooseInitialStopReportMode } = require('../lib/batch-submit-logic');

  assert.equal(chooseInitialStopReportMode({ result: 'manual_required' }), 'confirm_and_close');
  assert.equal(chooseInitialStopReportMode({ result: 'no_comment_box' }), 'confirm_and_close');
  assert.equal(chooseInitialStopReportMode({ result: 'fail' }), 'confirm_and_close');
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

test('chooseBacklinkVerificationUrl prefers post-submit comment anchor page over original csv url', () => {
  const { chooseBacklinkVerificationUrl } = require('../lib/batch-submit-logic');

  const result = chooseBacklinkVerificationUrl({
    originalUrl: 'https://example.test/post/comment-page-2/',
    currentUrl: 'https://example.test/post/comment-page-233/#comment-1407439'
  });

  assert.equal(result.verificationUrl, 'https://example.test/post/comment-page-233/');
  assert.equal(result.reason, 'current_comment_anchor_page');
});

test('buildBacklinkVerificationTargets falls back to original url after comment anchor page', () => {
  const { buildBacklinkVerificationTargets } = require('../lib/batch-submit-logic');

  const result = buildBacklinkVerificationTargets({
    originalUrl: 'https://example.test/post/',
    currentUrl: 'https://example.test/post/comment-page-233/#comment-1407439'
  });

  assert.deepEqual(result.map((item) => item.verificationUrl), [
    'https://example.test/post/comment-page-233/',
    'https://example.test/post/'
  ]);
  assert.deepEqual(result.map((item) => item.reason), [
    'current_comment_anchor_page',
    'original_url_fallback'
  ]);
});

test('validateCommentReadyForSubmit requires actual field content to include promotion host', () => {
  const { validateCommentReadyForSubmit } = require('../lib/batch-submit-logic');
  const expected = 'Helpful comment with <a href="https://example-target.test/\n">useful design ideas</a> included.';

  assert.equal(validateCommentReadyForSubmit({
    expectedText: expected,
    actualText: 'Helpful comment with ',
    actualHtml: 'Helpful comment with ',
    promotionUrl: 'https://example-target.test/'
  }).ok, false);

  assert.equal(validateCommentReadyForSubmit({
    expectedText: expected,
    actualText: 'Helpful comment with useful design ideas included.',
    actualHtml: 'Helpful comment with useful design ideas included.',
    promotionUrl: 'https://example-target.test/'
  }).ok, false);

  const complete = validateCommentReadyForSubmit({
    expectedText: expected,
    actualText: expected,
    actualHtml: expected,
    promotionUrl: 'https://example-target.test/'
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.hostFound, true);
});

test('chooseCommentReadyRecoveryAction escalates from segmented refill to direct fallback', () => {
  const { chooseCommentReadyRecoveryAction } = require('../lib/batch-submit-logic');

  assert.equal(chooseCommentReadyRecoveryAction({ ready: true, attempts: 0 }), 'none');
  assert.equal(chooseCommentReadyRecoveryAction({ ready: false, attempts: 0 }), 'segmented_refill');
  assert.equal(chooseCommentReadyRecoveryAction({ ready: false, attempts: 1 }), 'direct_set_value');
  assert.equal(chooseCommentReadyRecoveryAction({ ready: false, attempts: 2 }), 'fail');
});

test('chooseBacklinkVerificationUrl verifies private moderation preview page when present', () => {
  const { chooseBacklinkVerificationUrl } = require('../lib/batch-submit-logic');

  const result = chooseBacklinkVerificationUrl({
    originalUrl: 'https://example.test/post/',
    currentUrl: 'https://example.test/post/?unapproved=123&moderation-hash=abc#comment-123'
  });

  assert.equal(result.verificationUrl, 'https://example.test/post/?unapproved=123&moderation-hash=abc');
  assert.equal(result.privateModerationPreview, true);
  assert.equal(result.reason, 'private_moderation_preview_page');
});

test('classifySubmitWatcherSignal keeps watching after submit event but finishes on navigation', () => {
  const { classifySubmitWatcherSignal } = require('../lib/batch-submit-logic');

  assert.equal(classifySubmitWatcherSignal({ signal: 'submit' }).shouldFinish, false);
  assert.equal(classifySubmitWatcherSignal({ signal: 'fetch-submit' }).shouldFinish, false);
  assert.deepEqual(classifySubmitWatcherSignal({ signal: 'beforeunload' }), {
    shouldFinish: true,
    result: 'navigating'
  });
});

test('chooseReadyCommentField keeps valid preferred textarea over empty fallback', () => {
  const { chooseReadyCommentField } = require('../lib/batch-submit-logic');
  const expected = 'Helpful comment mentioning cfggt.com in the generated backlink text.';

  const result = chooseReadyCommentField({
    preferred: { id: 'comment', name: 'comment', text: expected, html: expected },
    fallback: { id: 'ak_hp_textarea', name: 'ak_hp_textarea', text: '', html: '' },
    expectedText: expected,
    promotionUrl: 'https://cfggt.com/'
  });

  assert.equal(result.source, 'preferred');
  assert.equal(result.reason, 'preferred_ready');
  assert.equal(result.field.id, 'comment');
  assert.equal(result.preferredValidation.ok, true);
  assert.equal(result.fallbackValidation.ok, false);
});

test('chooseReadyCommentField falls back when preferred textarea no longer validates', () => {
  const { chooseReadyCommentField } = require('../lib/batch-submit-logic');
  const expected = 'Helpful comment mentioning cfggt.com in the generated backlink text.';

  const result = chooseReadyCommentField({
    preferred: { id: 'old', text: '', html: '' },
    fallback: { id: 'comment', text: expected, html: expected },
    expectedText: expected,
    promotionUrl: 'https://cfggt.com/'
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'fallback_ready');
  assert.equal(result.field.id, 'comment');
});

test('getSubmitVerificationGraceSeconds extends wait for success evidence', () => {
  const { getSubmitVerificationGraceSeconds } = require('../lib/batch-submit-logic');

  assert.equal(getSubmitVerificationGraceSeconds({
    classifiedResult: 'success',
    confidence: 'strong',
    reason: 'success_message_found'
  }), 25);

  assert.equal(getSubmitVerificationGraceSeconds({
    classifiedResult: 'success',
    confidence: 'medium',
    reason: 'navigation_without_error'
  }), 20);

  assert.equal(getSubmitVerificationGraceSeconds({
    classifiedResult: 'submitted_unconfirmed',
    confidence: 'weak'
  }), 8);
});

test('buildAiReuseState fails first AI generation when no reusable copy exists', () => {
  const { buildAiReuseState } = require('../lib/batch-submit-logic');

  const result = buildAiReuseState({
    aiOk: false,
    reusableCopy: null
  });

  assert.equal(result.action, 'fail_first_generation');
  assert.equal(result.warning, 'first_generation_failed');
  assert.equal(result.reuseCount, 0);
});

test('buildAiReuseState warns after the same copy is reused three times', () => {
  const { buildAiReuseState } = require('../lib/batch-submit-logic');

  const result = buildAiReuseState({
    aiOk: false,
    reusableCopy: { text: 'Reusable generated copy with cfggt.com', key: 'copy-1' },
    previousReuseKey: 'copy-1',
    previousReuseCount: 2
  });

  assert.equal(result.action, 'reuse');
  assert.equal(result.reusableCopy.text, 'Reusable generated copy with cfggt.com');
  assert.equal(result.reuseCount, 3);
  assert.equal(result.warning, 'same_copy_reused_3_times');
});
