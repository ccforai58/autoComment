(function initLinkAssistantFormDetector(root) {
'use strict';

let normalizeHttpUrl;
if (typeof require === 'function') {
  ({ normalizeHttpUrl } = require('./link-assistant-resource-logic'));
} else {
  normalizeHttpUrl = function normalizeHttpUrlBrowser(value) {
    const text = String(value || '').trim();
    if (!text) return { ok: false, url: '', key: '', domain: '', error: 'empty_url' };
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, url: '', key: '', domain: '', error: 'unsupported_protocol' };
      }
      parsed.username = '';
      parsed.password = '';
      parsed.hostname = parsed.hostname.toLowerCase();
      const keyUrl = new URL(parsed.href);
      keyUrl.hash = '';
      keyUrl.hostname = keyUrl.hostname.toLowerCase();
      keyUrl.pathname = keyUrl.pathname.replace(/\/+$/, '') || '/';
      return {
        ok: true,
        url: parsed.href,
        key: keyUrl.href.replace(/\/+$/, '').toLowerCase(),
        domain: keyUrl.hostname.replace(/^www\./, ''),
        error: ''
      };
    } catch (_) {
      return { ok: false, url: '', key: '', domain: '', error: 'invalid_url' };
    }
  };
}

const DETECTOR_VERSION = 'manual-assistant-detector-2026-07-18-v1';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'preview',
  'ref',
  'spm',
  'yclid'
]);

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function safeLower(value) {
  return safeText(value).toLowerCase();
}

function cleanSourceUrl(value) {
  const text = safeText(value);
  if (!text) return { ok: false, sourceUrl: '', sourceUrlKey: '', error: 'empty_url' };
  const normalized = normalizeHttpUrl(text);
  if (!normalized.ok) return { ok: false, sourceUrl: text, sourceUrlKey: '', error: normalized.error || 'invalid_url' };

  const parsed = new URL(normalized.url);
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  const href = parsed.href.replace(/\/$/, '');
  const key = normalizeHttpUrl(href).key || href.toLowerCase();
  return { ok: true, sourceUrl: href, sourceUrlKey: key, error: '' };
}

function normalizeStableSourceUrl(input, currentUrl = '') {
  const source = input && typeof input === 'object' ? input : {};
  const canonical = safeText(source.canonicalUrl || source.canonical_url);
  const current = safeText(source.currentUrl || source.current_url || currentUrl);
  const candidates = [
    { value: canonical, reason: 'canonical' },
    { value: current, reason: 'current' }
  ];
  for (const candidate of candidates) {
    const cleaned = cleanSourceUrl(candidate.value);
    if (cleaned.ok) {
      return {
        sourceUrl: cleaned.sourceUrl,
        sourceUrlKey: cleaned.sourceUrlKey,
        reason: candidate.reason
      };
    }
  }
  return { sourceUrl: current || canonical || '', sourceUrlKey: '', reason: 'invalid' };
}

function countPattern(text, patterns) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function detectPageTypeFromSignals(signals) {
  const source = signals && typeof signals === 'object' ? signals : {};
  const text = safeLower([
    source.formText,
    source.pageText,
    source.buttonText,
    source.labelsText
  ].filter(Boolean).join(' '));

  const scores = {
    blog_comment: Number(source.commentSignals || 0) +
      countPattern(text, [/comment/, /leave a reply/, /post comment/, /respond/, /wordpress/]) +
      (Number(source.textareaCount || 0) > 0 ? 1 : 0),
    directory_submission: Number(source.directorySignals || 0) +
      countPattern(text, [/submit listing/, /add site/, /directory/, /website url/, /category/, /listing/]) +
      (Number(source.urlInputCount || 0) > 0 ? 1 : 0),
    media_submission: Number(source.mediaSignals || 0) +
      countPattern(text, [/submit article/, /abstract/, /article title/, /author bio/, /editorial/, /publish/]),
    profile_link: Number(source.profileSignals || 0) +
      countPattern(text, [/edit profile/, /profile/, /bio/, /company/, /social link/, /website/]),
    generic_form: 1
  };

  let pageType = 'generic_form';
  let score = scores.generic_form;
  for (const [candidate, candidateScore] of Object.entries(scores)) {
    if (candidateScore > score) {
      pageType = candidate;
      score = candidateScore;
    }
  }
  return {
    pageType,
    confidence: Math.max(0.1, Math.min(0.95, score / 8)),
    reasons: Object.entries(scores)
      .filter(([, value]) => value > 1)
      .map(([key, value]) => `${key}:${value}`)
  };
}

function scoreFieldRole(input) {
  const source = input && typeof input === 'object' ? input : {};
  const haystack = safeLower([
    source.label,
    source.placeholder,
    source.name,
    source.id,
    source.ariaLabel,
    source.nearbyText,
    source.type
  ].filter(Boolean).join(' '));
  const tagName = safeLower(source.tagName);
  const type = safeLower(source.type);

  const roles = [
    { role: 'email', patterns: [/email/, /e-mail/], boost: type === 'email' ? 3 : 0 },
    { role: 'websiteUrl', patterns: [/website/, /site url/, /url/, /homepage/, /link/], boost: type === 'url' ? 3 : 0 },
    { role: 'comment', patterns: [/comment/, /reply/, /message/, /your thoughts/], boost: tagName === 'textarea' ? 2 : 0 },
    { role: 'description', patterns: [/description/, /describe/, /summary/, /about/, /details/], boost: tagName === 'textarea' ? 1 : 0 },
    { role: 'title', patterns: [/title/, /site name/, /website name/, /listing name/, /name of/], boost: 0 },
    { role: 'author', patterns: [/author/, /your name/, /name/, /contact person/], boost: 0 },
    { role: 'category', patterns: [/category/, /type/, /topic/], boost: 0 },
    { role: 'tags', patterns: [/tag/, /keyword/], boost: 0 },
    { role: 'profileBio', patterns: [/bio/, /profile/, /about me/, /company/], boost: tagName === 'textarea' ? 1 : 0 }
  ];

  let best = { role: '', score: 0, reasons: [] };
  for (const role of roles) {
    const matches = role.patterns.filter((pattern) => pattern.test(haystack));
    const score = matches.length * 2 + role.boost;
    if (score > best.score) {
      best = {
        role: role.role,
        score,
        reasons: matches.map((pattern) => pattern.source).concat(role.boost ? [`type:${type || tagName}`] : [])
      };
    }
  }
  return best.score > 0 ? best : { role: 'unknown', score: 0, reasons: [] };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function normalizePageType(value) {
  const text = safeLower(value);
  if (text === 'blog_comment') return 'blog_comment';
  if (text === 'directory_submission') return 'directory_submission';
  if (text === 'media_submission') return 'media_submission';
  if (text === 'profile_link') return 'profile_link';
  return 'generic_form';
}

function buildManualResourcePayload(input) {
  const source = input && typeof input === 'object' ? input : {};
  const stable = normalizeStableSourceUrl(source, source.sourceUrl || source.url || source.currentUrl || '');
  const pageType = normalizePageType(source.pageType || source.resourceType);
  return {
    sourceUrl: stable.sourceUrl,
    sourceUrlKey: stable.sourceUrlKey,
    sourceTitle: safeText(source.sourceTitle || source.title),
    resourceType: pageType,
    qualityLabel: safeText(source.qualityLabel || source.quality || source.level),
    topicTags: Array.isArray(source.topicTags) ? source.topicTags : [],
    notes: safeText(source.notes || source.remark),
    pageAscore: toNullableNumber(source.pageAscore || source.page_ascore),
    externalLinks: toNullableNumber(source.externalLinks || source.external_links || source.traffic),
    submitSource: 'manual_assistant',
    detectorVersion: DETECTOR_VERSION
  };
}

const api = {
  DETECTOR_VERSION,
  buildManualResourcePayload,
  detectPageTypeFromSignals,
  normalizeStableSourceUrl,
  scoreFieldRole
};

root.AutoCommentLinkAssistantFormDetector = api;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== 'undefined' ? globalThis : window);
