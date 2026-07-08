const BATCH_SUCCESS_CONFIRMATION_MARKER = 'submit-confirmed-v3';

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function buildBatchConfirmPayload(input) {
  const source = isObject(input) ? input : {};
  const payload = {
    batchId: source.batchId,
    urlIndex: source.urlIndex,
    url: source.url || '',
    aiContent: source.aiContent || '',
    result: source.result || 'fail',
    promotionWebsiteUrl: source.promotionWebsiteUrl || '',
    promotionWebsiteKey: source.promotionWebsiteKey || '',
    copyPromotionWebsiteKey: source.copyPromotionWebsiteKey || '',
    errorMessage: source.errorMessage || null
  };

  if (payload.result === 'success') {
    payload.confirmedBy = BATCH_SUCCESS_CONFIRMATION_MARKER;
    payload.confirmedAt = source.confirmedAt || Date.now();
  }

  return payload;
}

function buildPreSubmitRecoveryPayload(input) {
  return buildBatchConfirmPayload({
    ...input,
    result: 'submitted_unconfirmed',
    errorMessage: input && input.errorMessage
      ? input.errorMessage
      : 'submit started; page changed before confirmation'
  });
}

function normalizeBatchConfirmMessage(message) {
  const source = isObject(message) ? message : {};
  const incomingResult = String(source.result || '').trim();
  const confirmedBy = String(source.confirmedBy || '').trim();
  const strictSuccess = incomingResult === 'success' && confirmedBy === BATCH_SUCCESS_CONFIRMATION_MARKER;

  if (strictSuccess) {
    return {
      result: 'success',
      errorMessage: source.errorMessage || null,
      isStrictSuccess: true
    };
  }

  if (incomingResult === 'submitted_unconfirmed') {
    return {
      result: 'submitted_unconfirmed',
      errorMessage: source.errorMessage || 'submit triggered but no acceptance signal',
      isStrictSuccess: false
    };
  }

  if (incomingResult && incomingResult !== 'success') {
    return {
      result: incomingResult,
      errorMessage: source.errorMessage || null,
      isStrictSuccess: false
    };
  }

  return {
    result: 'fail',
    errorMessage: source.errorMessage
      ? source.errorMessage
      : (confirmedBy === BATCH_SUCCESS_CONFIRMATION_MARKER
        ? 'missing explicit success result'
        : 'missing batch result'),
    isStrictSuccess: false
  };
}

function classifySubmitEvidence(evidence) {
  const source = isObject(evidence) ? evidence : {};
  const explicitError = String(source.explicitError || '').trim();
  if (explicitError) {
    if (/captcha|recaptcha|hcaptcha|turnstile|human verification|security check/i.test(explicitError)) {
      return { result: 'manual_required', reason: explicitError, confidence: 'strong' };
    }
    return { result: 'fail', reason: explicitError, confidence: 'strong' };
  }

  if (source.successMessageFound) {
    return { result: 'success', reason: 'success_message_found', confidence: 'strong' };
  }

  if (source.commentAppeared) {
    return { result: 'success', reason: 'comment_appeared_on_page', confidence: 'strong' };
  }

  const hasSubmitSignal = source.triggerResult && source.triggerResult !== 'timeout' && source.triggerResult !== 'cancelled';

  if (source.textareaCleared && hasSubmitSignal) {
    return { result: 'success', reason: 'textarea_cleared_after_submit', confidence: 'medium' };
  }

  if (source.navigationObserved && hasSubmitSignal) {
    return { result: 'success', reason: 'navigation_without_error', confidence: 'medium' };
  }

  if (hasSubmitSignal) {
    return {
      result: 'submitted_unconfirmed',
      reason: 'submit triggered but no acceptance signal',
      confidence: 'weak'
    };
  }

  return { result: 'fail', reason: 'submit confirmation timed out', confidence: 'strong' };
}

const SUBMIT_ERROR_PATTERN_RULES = [
  { pattern: 'duplicate comment detected', manualRequired: false },
  { pattern: 'you are posting comments too quickly', manualRequired: false },
  { pattern: 'error: please fill the required fields', manualRequired: false },
  { pattern: 'error: please enter a valid email', manualRequired: false },
  { pattern: 'error: please type your comment text', manualRequired: false },
  { pattern: 'you must be logged in to comment', manualRequired: false },
  { pattern: 'comments are closed', manualRequired: false },
  { pattern: 'comment submission failure', manualRequired: false },
  { pattern: 'spam detected', manualRequired: false },
  { pattern: 'captcha verification failed', manualRequired: true },
  { pattern: 'invalid captcha', manualRequired: true },
  { pattern: 'incorrect captcha', manualRequired: true },
  { pattern: 'please complete the captcha', manualRequired: true },
  { pattern: 'recaptcha verification failed', manualRequired: true },
  { pattern: 'hcaptcha verification failed', manualRequired: true },
  { pattern: 'turnstile verification failed', manualRequired: true }
];

function findSubmitErrorEvidence(input) {
  const source = isObject(input) ? input : {};
  const candidateTexts = Array.isArray(source.candidateTexts)
    ? source.candidateTexts.map((text) => String(text || '').trim()).filter(Boolean)
    : [];
  const bodyText = String(source.bodyText || '').trim();
  const allCandidates = [
    ...candidateTexts.map((text, index) => ({ source: 'candidate', index, text })),
    { source: 'body', index: -1, text: bodyText }
  ].filter((item) => item.text);

  for (const item of allCandidates) {
    const lower = item.text.toLowerCase();
    for (const rule of SUBMIT_ERROR_PATTERN_RULES) {
      if (lower.includes(rule.pattern)) {
        return {
          found: true,
          error: `submit failed: ${rule.pattern}`,
          pattern: rule.pattern,
          manualRequired: !!rule.manualRequired,
          source: item.source,
          index: item.index,
          snippet: item.text.replace(/\s+/g, ' ').slice(0, 240),
          candidateCount: candidateTexts.length,
          bodyCaptchaMention: /\bcaptcha\b|recaptcha|hcaptcha|turnstile/i.test(bodyText)
        };
      }
    }
  }

  return {
    found: false,
    error: '',
    pattern: '',
    manualRequired: false,
    source: '',
    index: -1,
    snippet: '',
    candidateCount: candidateTexts.length,
    bodyCaptchaMention: /\bcaptcha\b|recaptcha|hcaptcha|turnstile/i.test(bodyText)
  };
}

function classifyRestoredSubmitEvidence(evidence) {
  const source = isObject(evidence) ? evidence : {};
  const explicitError = String(source.explicitError || '').trim();
  if (explicitError) {
    if (/captcha|recaptcha|hcaptcha|turnstile|human verification|security check/i.test(explicitError)) {
      return { result: 'manual_required', reason: explicitError, confidence: 'strong' };
    }
    return { result: 'fail', reason: explicitError, confidence: 'strong' };
  }

  if (source.successMessageFound) {
    return { result: 'success', reason: 'success_message_found_after_restore', confidence: 'strong' };
  }

  if (source.commentAppeared) {
    return { result: 'success', reason: 'comment_appeared_after_restore', confidence: 'strong' };
  }

  return {
    result: 'submitted_unconfirmed',
    reason: 'restored page did not show acceptance signal',
    confidence: 'weak'
  };
}

function normalizePromotionTarget(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
  }

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    parsed.hash = '';
    const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    return {
      raw,
      normalizedUrl: `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}`,
      hostname: parsed.hostname.toLowerCase(),
      pathname,
      valid: true
    };
  } catch (_) {
    return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
  }
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractAnchorHrefs(html) {
  const source = String(html || '');
  const hrefs = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match;
  while ((match = anchorRe.exec(source)) !== null) {
    const href = decodeHtmlAttribute(match[1] || match[2] || match[3] || '').trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function isExternalHrefCandidate(href) {
  const value = String(href || '').trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^\/\//.test(value);
}

function parseHrefAgainstPromotion(href, promotionTarget) {
  if (!isExternalHrefCandidate(href)) return null;
  try {
    const base = /^\/\//.test(String(href || '').trim())
      ? 'https://external-link-base.invalid/'
      : (promotionTarget.normalizedUrl || `https://${promotionTarget.hostname}/`);
    const parsed = new URL(href, base);
    parsed.hash = '';
    return {
      href,
      hostname: parsed.hostname.toLowerCase(),
      pathname: (parsed.pathname || '/').replace(/\/+$/, '') || '/'
    };
  } catch (_) {
    return null;
  }
}

function verifyBacklinkInHtml(html, promotionUrl) {
  const promotion = normalizePromotionTarget(promotionUrl);
  const hrefs = extractAnchorHrefs(html);
  if (!promotion.valid) {
    return {
      linkVerified: false,
      matchedHref: '',
      promotionHost: '',
      candidateCount: hrefs.length,
      hostMatchedCount: 0,
      pathMatched: false,
      reason: 'invalid_promotion_url'
    };
  }

  let hostMatchedCount = 0;
  for (const href of hrefs) {
    const parsed = parseHrefAgainstPromotion(href, promotion);
    if (!parsed || parsed.hostname !== promotion.hostname) continue;
    hostMatchedCount++;
    const needsPath = promotion.pathname && promotion.pathname !== '/';
    const pathMatched = !needsPath || parsed.pathname === promotion.pathname || parsed.pathname.startsWith(`${promotion.pathname}/`);
    if (pathMatched) {
      return {
        linkVerified: true,
        matchedHref: href,
        promotionHost: promotion.hostname,
        candidateCount: hrefs.length,
        hostMatchedCount,
        pathMatched: true,
        reason: 'matching_anchor_href_found'
      };
    }
  }

  return {
    linkVerified: false,
    matchedHref: '',
    promotionHost: promotion.hostname,
    candidateCount: hrefs.length,
    hostMatchedCount,
    pathMatched: false,
    reason: hostMatchedCount > 0 ? 'host_matched_path_mismatched' : 'no_matching_anchor_href'
  };
}

function verifyBacklinkHref(href, promotionUrl) {
  const safeHref = String(href || '').replace(/"/g, '&quot;');
  return verifyBacklinkInHtml(`<a href="${safeHref}"></a>`, promotionUrl);
}

function isVerifiedBacklinkRecord(record, promotionUrl) {
  const source = isObject(record) ? record : {};
  if (source.linkVerified !== true) return false;
  const matchedHref = String(source.matchedHref || '').trim();
  if (!matchedHref) return false;
  return verifyBacklinkHref(matchedHref, promotionUrl).linkVerified;
}

function isPrivateModerationPreviewUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw, 'https://placeholder.invalid/');
    return parsed.searchParams.has('unapproved') && parsed.searchParams.has('moderation-hash');
  } catch (_) {
    return /[?&]unapproved=/.test(raw) && /[?&]moderation-hash=/.test(raw);
  }
}

function classifyPostSubmitResult(input) {
  const source = isObject(input) ? input : {};
  const linkVerification = verifyBacklinkInHtml(source.html || '', source.promotionUrl || '');
  const pageUrl = String(source.pageUrl || source.verificationUrl || '');

  if (linkVerification.linkVerified) {
    if (isPrivateModerationPreviewUrl(pageUrl)) {
      return {
        result: 'submitted_unconfirmed',
        reason: 'private_moderation_preview_without_public_backlink',
        confidence: 'weak',
        linkVerification
      };
    }
    return {
      result: 'success',
      reason: 'backlink_anchor_found',
      confidence: 'strong',
      linkVerification
    };
  }

  const explicitError = String(source.explicitError || '').trim();
  const manualRequired = !!source.manualRequired || /captcha|recaptcha|hcaptcha|turnstile|human verification|security check|cloudflare/i.test(explicitError);
  if (manualRequired) {
    return {
      result: 'manual_required',
      reason: explicitError || 'manual verification required',
      confidence: 'strong',
      linkVerification
    };
  }

  if (explicitError) {
    return {
      result: 'fail',
      reason: explicitError,
      confidence: 'strong',
      linkVerification
    };
  }

  const hasSubmitEvidence = !!(
    source.submitTriggered ||
    source.successMessageFound ||
    source.textareaCleared ||
    source.navigationObserved
  );

  if (hasSubmitEvidence) {
    return {
      result: 'submitted_unconfirmed',
      reason: 'submit_evidence_without_backlink',
      confidence: source.successMessageFound ? 'medium' : 'weak',
      linkVerification
    };
  }

  return {
    result: 'fail',
    reason: 'submit_not_triggered',
    confidence: 'strong',
    linkVerification
  };
}

function mergeBatchRuntimeState(previous, patch) {
  const base = isObject(previous) ? previous : {};
  const update = isObject(patch) ? patch : {};
  const merged = { ...base, ...update };
  const byIndex = new Map();

  for (const item of Array.isArray(base.localResults) ? base.localResults : []) {
    if (item && item.originalIndex !== undefined) {
      byIndex.set(item.originalIndex, item);
    }
  }

  for (const item of Array.isArray(update.localResults) ? update.localResults : []) {
    if (item && item.originalIndex !== undefined) {
      byIndex.set(item.originalIndex, { ...(byIndex.get(item.originalIndex) || {}), ...item });
    }
  }

  merged.localResults = Array.from(byIndex.values())
    .sort((a, b) => Number(a.originalIndex) - Number(b.originalIndex));
  merged.updatedAt = update.updatedAt || Date.now();
  return merged;
}

function computeBatchTimeoutLimit(input) {
  const source = isObject(input) ? input : {};
  const configured = Number(source.configuredSeconds);
  const fallback = Number(source.defaultSeconds || 60);
  const timeoutSeconds = Number.isFinite(configured) && configured > 0 ? configured : fallback;
  return Math.max(1, Math.round(timeoutSeconds));
}

function buildFreshUploadRuntimeState(_previous, parsedUrlCount) {
  const count = Math.max(0, Number(parsedUrlCount || 0));
  return {
    batchId: null,
    status: 'idle',
    totalCount: count,
    currentIndex: 0,
    localResults: [],
    successCount: 0,
    failCount: 0,
    skippedCount: 0,
    noCommentBoxCount: 0,
    manualRequiredCount: 0,
    blockedIllegalCount: 0,
    pendingCount: 0,
    activeTabCount: 0
  };
}

function shouldFinalizePendingSubmitContextAfterGrace(input) {
  const source = isObject(input) ? input : {};
  const ctx = isObject(source.ctx) ? source.ctx : {};
  if (!ctx.batchId || ctx.urlIndex === undefined) return false;
  if (ctx.batchId !== source.batchId) return false;
  if (Number(ctx.urlIndex) !== Number(source.urlIndex)) return false;
  if (ctx.result !== 'submitted_unconfirmed') return false;
  if (ctx.submitAttemptStarted !== true) return false;

  const timestamp = Number(ctx.timestamp || 0);
  const now = Number(source.now || Date.now());
  const graceMs = Math.max(1, Number(source.graceSeconds || 12)) * 1000;
  if (!timestamp || !Number.isFinite(timestamp) || !Number.isFinite(now)) return false;
  return now - timestamp >= graceMs;
}

function buildSubmitContextGraceResult(input) {
  const source = isObject(input) ? input : {};
  const ctx = isObject(source.submitCtx) ? source.submitCtx : {};
  const evidence = isObject(ctx.successEvidence) ? ctx.successEvidence : {};
  const isStrongSuccessEvidence = evidence.classifiedResult === 'success' && evidence.confidence === 'strong';
  const reason = evidence.reason || 'submit_evidence_without_backlink';

  return {
    result: 'submitted_unconfirmed',
    aiContent: ctx.aiContent || null,
    errorMessage: isStrongSuccessEvidence
      ? `submit observed as success/${reason} but backlink verification did not finish before grace timeout`
      : (ctx.errorMessage || 'submit started but no confirmation returned after grace period')
  };
}

function classifyInitialCommentFormScan(input) {
  const source = isObject(input) ? input : {};
  const hasForm = source.hasForm === true;
  const hasTextarea = source.hasTextarea === true;
  const usableCommentFieldCount = Number(source.usableCommentFieldCount || 0);
  const hasEmbeddedCommentSignal = source.hasEmbeddedCommentSignal === true;
  const embeddedSignalReason = String(source.embeddedSignalReason || '');
  const embeddedSignalSrc = String(source.embeddedSignalSrc || '').toLowerCase();
  if (
    hasForm &&
    !hasTextarea &&
    usableCommentFieldCount <= 0 &&
    hasEmbeddedCommentSignal &&
    embeddedSignalReason === 'comment_iframe' &&
    /(^|\/\/)(www\.)?blogger\.com\/comment\/frame\//.test(embeddedSignalSrc)
  ) {
    return {
      shouldStop: true,
      result: 'manual_required',
      errorMessage: 'embedded Blogger comment iframe requires manual handling'
    };
  }
  if (hasForm && !hasTextarea && usableCommentFieldCount <= 0 && !hasEmbeddedCommentSignal) {
    return {
      shouldStop: true,
      result: 'no_comment_box',
      errorMessage: 'no usable comment input found'
    };
  }
  return {
    shouldStop: false,
    result: '',
    errorMessage: ''
  };
}

function classifySubmitButtonClickability(input) {
  const source = isObject(input) ? input : {};
  if (source.disabled === true) return { clickable: false, reason: 'disabled' };
  if (source.ariaDisabled === true || source.ariaDisabled === 'true') return { clickable: false, reason: 'aria_disabled' };
  if (source.display === 'none') return { clickable: false, reason: 'display_none' };
  if (source.visibility === 'hidden') return { clickable: false, reason: 'visibility_hidden' };
  if (String(source.opacity) === '0') return { clickable: false, reason: 'opacity_zero' };
  const rectWidth = Number(source.rectWidth || 0);
  const rectHeight = Number(source.rectHeight || 0);
  if ((rectWidth === 0 || rectHeight === 0) && source.isTrustedSubmitButton === true && source.documentHasFocus === false) {
    return { clickable: true, reason: 'trusted_submit_button_in_unfocused_tab' };
  }
  if (rectWidth === 0 || rectHeight === 0) return { clickable: false, reason: 'zero_rect' };
  return { clickable: true, reason: 'visible' };
}

function chooseInitialStopReportMode(input) {
  const source = isObject(input) ? input : {};
  return source.result === 'manual_required' ? 'confirm_and_close' : 'report_only';
}

function buildSubmitAttemptPlan(input) {
  const source = isObject(input) ? input : {};
  const hasForm = !!source.hasForm;
  const hasRequestSubmit = !!source.hasRequestSubmit;
  const plan = [];

  plan.push('button-click');
  plan.push('synthetic-pointer-click');
  if (hasForm && hasRequestSubmit) plan.push('request-submit');
  plan.push('fallback-dispatch-click');
  if (hasForm) plan.push('form-submit');
  return plan;
}

function getBatchPreSubmitDelayMs(input) {
  const source = isObject(input) ? input : {};
  const delay = Number(source.delayMs);
  if (!Number.isFinite(delay)) return 900;
  return Math.min(2000, Math.max(300, Math.round(delay)));
}

function buildBatchCommentFillOptions() {
  return {
    fast: false,
    typingStrategy: 'human-fast'
  };
}

function chooseSubmitLookupStrategy(input) {
  const source = isObject(input) ? input : {};
  return source.hasPreferredForm ? 'preferred-form' : 'document-scan';
}

function getPreClickLayoutWaitTimeoutMs(input) {
  const source = isObject(input) ? input : {};
  const timeout = Number(source.timeoutMs);
  if (!Number.isFinite(timeout)) return 250;
  return Math.min(1000, Math.max(50, Math.round(timeout)));
}

module.exports = {
  BATCH_SUCCESS_CONFIRMATION_MARKER,
  buildBatchConfirmPayload,
  buildPreSubmitRecoveryPayload,
  normalizeBatchConfirmMessage,
  classifySubmitEvidence,
  findSubmitErrorEvidence,
  classifyRestoredSubmitEvidence,
  normalizePromotionTarget,
  extractAnchorHrefs,
  verifyBacklinkInHtml,
  verifyBacklinkHref,
  isVerifiedBacklinkRecord,
  classifyPostSubmitResult,
  mergeBatchRuntimeState,
  computeBatchTimeoutLimit,
  buildFreshUploadRuntimeState,
  shouldFinalizePendingSubmitContextAfterGrace,
  buildSubmitContextGraceResult,
  classifyInitialCommentFormScan,
  classifySubmitButtonClickability,
  chooseInitialStopReportMode,
  buildSubmitAttemptPlan,
  getBatchPreSubmitDelayMs,
  buildBatchCommentFillOptions,
  isPrivateModerationPreviewUrl,
  chooseSubmitLookupStrategy,
  getPreClickLayoutWaitTimeoutMs
};
