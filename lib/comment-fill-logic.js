function shouldUseFastCommentFill(text, options = {}) {
  if (options.fast === true) return true;
  return String(text || '').length >= 300;
}

function getEffectiveSegmentedDelayScale(options = {}) {
  const requested = options.requestedDelayScale === undefined
    ? 1
    : Math.max(0, Number(options.requestedDelayScale) || 0);
  if (options.documentHidden === true || options.documentHasFocus === false) {
    return 0;
  }
  return requested;
}

function isLikelyWpDiscuzEditorCandidate(editor) {
  if (!editor || typeof editor.getAttribute !== 'function') return false;
  if (editor.getAttribute('contenteditable') !== 'true') return false;
  return true;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HUMAN_TYPING_PROFILES = {
  'human-fast': {
    baseMin: 8,
    baseMax: 30,
    punctuationMin: 60,
    punctuationMax: 160,
    newlineMin: 120,
    newlineMax: 320
  },
  'human-normal': {
    baseMin: 25,
    baseMax: 90,
    punctuationMin: 120,
    punctuationMax: 350,
    newlineMin: 300,
    newlineMax: 900
  },
  'human-careful': {
    baseMin: 60,
    baseMax: 180,
    punctuationMin: 500,
    punctuationMax: 1500,
    newlineMin: 800,
    newlineMax: 2000
  }
};

function normalizeTypingStrategy(strategy) {
  return HUMAN_TYPING_PROFILES[strategy] ? strategy : 'human-normal';
}

function randomBetween(min, max, random) {
  const roll = typeof random === 'function' ? random() : Math.random();
  return Math.round(min + (max - min) * Math.min(1, Math.max(0, roll)));
}

function getHumanTypingDelay(ch, profile, random) {
  if (ch === '\n' || ch === '\r') {
    return randomBetween(profile.newlineMin, profile.newlineMax, random);
  }
  if (/[.!?,;:，。！？；：]/.test(ch)) {
    return randomBetween(profile.punctuationMin, profile.punctuationMax, random);
  }
  return randomBetween(profile.baseMin, profile.baseMax, random);
}

function buildHumanTypingPlan(text, options = {}) {
  const strategy = normalizeTypingStrategy(options.strategy || options.typingStrategy);
  const profile = HUMAN_TYPING_PROFILES[strategy];
  const value = String(text || '');
  const steps = Array.from(value).map((ch) => ({
    ch,
    delayMs: getHumanTypingDelay(ch, profile, options.random)
  }));
  const totalDelayMs = steps.reduce((sum, step) => sum + step.delayMs, 0);
  return {
    strategy,
    steps,
    totalDelayMs,
    avgDelayMs: steps.length > 0 ? Math.round(totalDelayMs / steps.length) : 0
  };
}

function findPromotedTextRange(text, options = {}) {
  const value = String(text || '');
  const anchorMatch = /<a\b[\s\S]*?<\/a>/i.exec(value);
  if (anchorMatch) {
    return {
      start: anchorMatch.index,
      end: anchorMatch.index + anchorMatch[0].length,
      anchorDetected: true,
      hrefNewlinePreserved: /href\s*=\s*["'][\s\S]*?\n[\s\S]*?["']/i.test(anchorMatch[0])
    };
  }

  const promotionUrl = String(options.promotionUrl || '').trim();
  if (promotionUrl) {
    const normalizedUrl = promotionUrl.replace(/\/+$/, '');
    const directIndex = value.indexOf(promotionUrl);
    const normalizedIndex = normalizedUrl && normalizedUrl !== promotionUrl ? value.indexOf(normalizedUrl) : -1;
    const index = directIndex >= 0 ? directIndex : normalizedIndex;
    if (index >= 0) {
      const matched = directIndex >= 0 ? promotionUrl : normalizedUrl;
      return {
        start: index,
        end: index + matched.length,
        anchorDetected: false,
        hrefNewlinePreserved: false
      };
    }
  }

  const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(value);
  if (urlMatch) {
    return {
      start: urlMatch.index,
      end: urlMatch.index + urlMatch[0].length,
      anchorDetected: false,
      hrefNewlinePreserved: false
    };
  }

  return {
    start: 0,
    end: value.length,
    anchorDetected: false,
    hrefNewlinePreserved: false
  };
}

function buildSegmentedHumanTypingPlan(text, options = {}) {
  const value = String(text || '');
  const contextChars = Math.max(0, Math.round(Number(options.contextChars ?? 5) || 0));
  const maxDurationMs = Math.max(0, Math.round(Number(options.maxDurationMs ?? 60000) || 0));
  const range = findPromotedTextRange(value, options);
  const typedStart = Math.max(0, range.start - contextChars);
  const typedEnd = Math.min(value.length, range.end + contextChars);
  const prefix = value.slice(0, typedStart);
  const typed = value.slice(typedStart, typedEnd);
  const suffix = value.slice(typedEnd);
  const basePlan = buildHumanTypingPlan(typed, options);
  const capScale = maxDurationMs > 0 && basePlan.totalDelayMs > maxDurationMs
    ? maxDurationMs / basePlan.totalDelayMs
    : 1;
  const steps = basePlan.steps.map((step) => ({
    ch: step.ch,
    delayMs: Math.round(step.delayMs * capScale)
  }));
  const totalDelayMs = steps.reduce((sum, step) => sum + step.delayMs, 0);

  return {
    strategy: `segmented-${basePlan.strategy}`,
    baseStrategy: basePlan.strategy,
    prefix,
    typed,
    suffix,
    steps,
    totalDelayMs,
    avgDelayMs: steps.length > 0 ? Math.round(totalDelayMs / steps.length) : 0,
    maxDurationMs,
    delayCapScale: capScale,
    anchorDetected: range.anchorDetected,
    hrefNewlinePreserved: range.hrefNewlinePreserved,
    typedStart,
    typedEnd
  };
}

function assignInputValue(input, value) {
  const descriptor = input
    ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
    : null;
  if (descriptor && descriptor.set) {
    descriptor.set.call(input, value);
  } else if (input) {
    input.value = value;
  }
}

async function fillTextSegmented(input, value, options = {}) {
  if (!input) return false;
  const text = String(value || '');
  const plan = buildSegmentedHumanTypingPlan(text, options);
  const explicitDelay = options.delayMs !== undefined ? Math.max(0, Number(options.delayMs) || 0) : null;
  const delayScale = getEffectiveSegmentedDelayScale({
    requestedDelayScale: options.delayScale,
    documentHidden: options.documentHidden,
    documentHasFocus: options.documentHasFocus
  });
  const startedAt = Date.now();

  if (typeof input.focus === 'function') {
    input.focus();
  }

  let currentValue = plan.prefix;
  assignInputValue(input, currentValue);
  if (typeof input.dispatchEvent === 'function') {
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  for (const step of plan.steps) {
    currentValue += step.ch;
    assignInputValue(input, currentValue);
    if (typeof input.dispatchEvent === 'function') {
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    const waitMs = explicitDelay !== null ? explicitDelay : Math.round(step.delayMs * delayScale);
    await sleep(waitMs);
  }

  currentValue += plan.suffix;
  assignInputValue(input, currentValue);
  if (typeof input.dispatchEvent === 'function') {
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    const blurEvent = typeof FocusEvent === 'function'
      ? new FocusEvent('blur', { bubbles: true, relatedTarget: null })
      : new Event('blur', { bubbles: true, cancelable: true });
    input.dispatchEvent(blurEvent);
  }

  return {
    success: input.value === text,
    chars: text.length,
    prefixChars: plan.prefix.length,
    typedChars: plan.steps.length,
    suffixChars: plan.suffix.length,
    durationMs: Date.now() - startedAt,
    plannedDelayMs: plan.totalDelayMs,
    avgDelayMs: plan.avgDelayMs,
    maxDurationMs: plan.maxDurationMs,
    strategy: plan.strategy,
    anchorDetected: plan.anchorDetected,
    hrefNewlinePreserved: plan.hrefNewlinePreserved
  };
}

function assignEditableValue(editor, value) {
  if (!editor) return;
  editor.textContent = value;
  editor.innerText = value;
}

async function fillEditableSegmented(editor, value, options = {}) {
  if (!editor) return false;
  const text = String(value || '');
  const plan = buildSegmentedHumanTypingPlan(text, options);
  const explicitDelay = options.delayMs !== undefined ? Math.max(0, Number(options.delayMs) || 0) : null;
  const delayScale = getEffectiveSegmentedDelayScale({
    requestedDelayScale: options.delayScale,
    documentHidden: options.documentHidden,
    documentHasFocus: options.documentHasFocus
  });
  const startedAt = Date.now();

  if (typeof editor.focus === 'function') {
    editor.focus();
  }

  let currentValue = plan.prefix;
  assignEditableValue(editor, currentValue);
  if (typeof editor.dispatchEvent === 'function') {
    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  for (const step of plan.steps) {
    currentValue += step.ch;
    assignEditableValue(editor, currentValue);
    if (typeof editor.dispatchEvent === 'function') {
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    const waitMs = explicitDelay !== null ? explicitDelay : Math.round(step.delayMs * delayScale);
    await sleep(waitMs);
  }

  currentValue += plan.suffix;
  assignEditableValue(editor, currentValue);
  if (typeof editor.dispatchEvent === 'function') {
    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    const blurEvent = typeof FocusEvent === 'function'
      ? new FocusEvent('blur', { bubbles: true, relatedTarget: null })
      : new Event('blur', { bubbles: true, cancelable: true });
    editor.dispatchEvent(blurEvent);
  }

  return {
    success: editor.textContent === text,
    chars: text.length,
    prefixChars: plan.prefix.length,
    typedChars: plan.steps.length,
    suffixChars: plan.suffix.length,
    durationMs: Date.now() - startedAt,
    plannedDelayMs: plan.totalDelayMs,
    avgDelayMs: plan.avgDelayMs,
    maxDurationMs: plan.maxDurationMs,
    strategy: plan.strategy,
    anchorDetected: plan.anchorDetected,
    hrefNewlinePreserved: plan.hrefNewlinePreserved
  };
}

async function fillTextSequentially(input, value, options = {}) {
  if (!input) return false;
  const text = String(value || '');
  const plan = buildHumanTypingPlan(text, options);
  const explicitDelay = options.delayMs !== undefined ? Math.max(0, Number(options.delayMs) || 0) : null;
  const delayScale = options.delayScale === undefined ? 1 : Math.max(0, Number(options.delayScale) || 0);
  const startedAt = Date.now();

  if (typeof input.focus === 'function') {
    input.focus();
  }
  input.value = '';

  for (const step of plan.steps) {
    input.value += step.ch;
    if (typeof input.dispatchEvent === 'function') {
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    const waitMs = explicitDelay !== null ? explicitDelay : Math.round(step.delayMs * delayScale);
    await sleep(waitMs);
  }

  if (typeof input.dispatchEvent === 'function') {
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    const blurEvent = typeof FocusEvent === 'function'
      ? new FocusEvent('blur', { bubbles: true, relatedTarget: null })
      : new Event('blur', { bubbles: true, cancelable: true });
    input.dispatchEvent(blurEvent);
  }

  return {
    success: input.value === text,
    chars: plan.steps.length,
    durationMs: Date.now() - startedAt,
    plannedDelayMs: plan.totalDelayMs,
    avgDelayMs: plan.avgDelayMs,
    strategy: plan.strategy
  };
}

module.exports = {
  shouldUseFastCommentFill,
  getEffectiveSegmentedDelayScale,
  isLikelyWpDiscuzEditorCandidate,
  fillTextSequentially,
  buildHumanTypingPlan,
  buildSegmentedHumanTypingPlan,
  fillTextSegmented,
  fillEditableSegmented
};
