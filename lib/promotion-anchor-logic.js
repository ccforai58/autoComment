function normalizePromotionUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    parsed.hash = '';
    parsed.search = '';
    let href = parsed.href;
    if (!/\/$/.test(parsed.pathname || '')) {
      href = href.replace(/\/?$/, '/');
    }
    return href;
  } catch (_) {
    return raw.replace(/\/?$/, '/');
  }
}

function getPromotionDomain(url) {
  try {
    return new URL(normalizePromotionUrl(url)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  }
}

function normalizeAnchorText(text) {
  const value = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (/https?:\/\//i.test(value)) return '';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(value)) return '';
  if (['click here', 'here', 'website', 'this site', 'this website', 'learn more', 'visit site', 'official website'].includes(lower)) {
    return '';
  }
  if (value.length < 6 || value.length > 80) return '';
  return value;
}

const ANCHOR_MODIFIERS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'custom',
  'personalized',
  'personalised',
  'best',
  'top',
  'online',
  'free',
  'simple',
  'easy',
  'useful',
  'helpful',
  'resource'
]);

function splitAnchorWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractPromotionKeywords(options = {}) {
  const direct = normalizeKeywordList(options.promotionKeywords);
  const content = String(options.promotionContent || '');
  const match = /^Keywords:\s*(.+)$/im.exec(content);
  return direct.length ? direct : normalizeKeywordList(match ? match[1] : '');
}

function getKeywordRootWords(options = {}) {
  const roots = new Set();
  for (const keyword of extractPromotionKeywords(options)) {
    for (const word of splitAnchorWords(keyword)) {
      if (ANCHOR_MODIFIERS.has(word)) continue;
      if (word.length < 3) continue;
      roots.add(word);
    }
  }
  return roots;
}

function buildKeywordAnchorCandidates(options = {}) {
  const candidates = [];
  for (const keyword of extractPromotionKeywords(options)) {
    const words = splitAnchorWords(keyword).filter((word) => !ANCHOR_MODIFIERS.has(word));
    if (!words.length) continue;
    if (words.length <= 4) candidates.push(words.join(' '));
    for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
      for (let index = 0; index <= words.length - size; index += 1) {
        candidates.push(words.slice(index, index + size).join(' '));
      }
    }
    candidates.push(...words);
  }
  return candidates;
}

function isKeywordRootedAnchor(anchorText, options = {}) {
  const roots = getKeywordRootWords(options);
  if (!roots.size) return true;
  const words = splitAnchorWords(anchorText);
  if (!words.length || words.length > 4) return false;
  const matched = words.filter((word) => roots.has(word));
  return words.length === 1 ? matched.length === 1 : matched.length >= Math.min(2, roots.size);
}

function extractKeywordPhrases(text) {
  const value = String(text || '').toLowerCase();
  const phrases = [];
  const known = [
    'custom flower name art',
    'personalized floral name design',
    'personalized floral name images',
    'flower-styled name images',
    'personalized flower name image',
    'practical SEO ideas',
    'website visibility tips',
    'search-focused content support',
    'SEO-focused website support',
    'helpful optimization ideas',
    'content reach ideas'
  ];
  for (const phrase of known) {
    if (value.includes(phrase.toLowerCase())) phrases.push(phrase);
  }
  return phrases;
}

function buildAnchorCandidates(options = {}) {
  const used = new Set((options.usedAnchorTexts || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  const blocked = new Set((options.blockedAnchorTexts || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  const domain = getPromotionDomain(options.promotionUrl);
  const raw = [
    ...buildKeywordAnchorCandidates(options),
    ...extractKeywordPhrases(options.promotionContent),
    ...extractKeywordPhrases(options.pageTitle),
    ...extractKeywordPhrases(options.pageDescription),
    'practical SEO ideas',
    'website visibility tips',
    'search-focused content support',
    'helpful optimization ideas',
    'content reach ideas',
    'this helpful resource'
  ];

  const seen = new Set();
  return raw
    .map(normalizeAnchorText)
    .filter(Boolean)
    .filter((candidate) => !candidate.toLowerCase().includes(domain))
    .filter((candidate) => {
      const key = candidate.toLowerCase();
      if (used.has(key) || blocked.has(key) || seen.has(key)) return false;
      if (!isKeywordRootedAnchor(candidate, options)) return false;
      seen.add(key);
      return true;
    });
}

function getKeywordFallbackAnchor(options = {}) {
  const domain = getPromotionDomain(options.promotionUrl);
  return buildKeywordAnchorCandidates(options)
    .map(normalizeAnchorText)
    .filter(Boolean)
    .filter((candidate) => !candidate.toLowerCase().includes(domain))
    .find((candidate) => isKeywordRootedAnchor(candidate, options)) || '';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAnchorHtml(promotionUrl, anchorText) {
  const href = normalizePromotionUrl(promotionUrl);
  return `<a href="${href}\n">${anchorText}</a>`;
}

function extractFirstAnchor(text) {
  const match = /<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/i.exec(String(text || ''));
  if (!match) return null;
  return {
    full: match[0],
    href: match[2],
    anchorText: String(match[3] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  };
}

function ensurePromotionAnchor(text, options = {}) {
  const original = String(text || '');
  const promotionUrl = normalizePromotionUrl(options.promotionUrl);
  if (!promotionUrl) {
    return {
      text: original,
      changed: false,
      anchorText: '',
      anchorSource: 'none',
      anchorWasDuplicate: false,
      anchorRewritten: false,
      hrefNewlinePreserved: false,
      usedAnchorCount: (options.usedAnchorTexts || []).length
    };
  }

  const used = new Set((options.usedAnchorTexts || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  const blocked = new Set((options.blockedAnchorTexts || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  const candidates = buildAnchorCandidates(options);
  const fallbackAnchor = candidates[0] || getKeywordFallbackAnchor(options) || 'this helpful resource';
  const anchor = extractFirstAnchor(original);
  const domain = getPromotionDomain(promotionUrl);
  const hasHrefNewline = !!(anchor && /\n\s*$/.test(anchor.href));
  const normalizedExistingAnchor = anchor ? normalizeAnchorText(anchor.anchorText) : '';
  const isDuplicate = normalizedExistingAnchor ? used.has(normalizedExistingAnchor.toLowerCase()) : false;
  const isBlocked = normalizedExistingAnchor ? blocked.has(normalizedExistingAnchor.toLowerCase()) : false;
  const isDomainLike = normalizedExistingAnchor ? normalizedExistingAnchor.toLowerCase().includes(domain) : true;
  const isKeywordRooted = normalizedExistingAnchor ? isKeywordRootedAnchor(normalizedExistingAnchor, options) : false;
  const finalAnchorText = (!normalizedExistingAnchor || isDuplicate || isBlocked || isDomainLike || !isKeywordRooted) ? fallbackAnchor : normalizedExistingAnchor;
  const anchorHtml = buildAnchorHtml(promotionUrl, finalAnchorText);

  if (anchor) {
    const shouldRewrite = anchor.full !== anchorHtml || isDuplicate || isBlocked || isDomainLike || !isKeywordRooted || !hasHrefNewline;
    return {
      text: shouldRewrite ? original.replace(anchor.full, anchorHtml) : original,
      changed: shouldRewrite,
      anchorText: finalAnchorText,
      anchorSource: shouldRewrite ? 'rewritten_anchor' : 'model_anchor',
      anchorWasDuplicate: isDuplicate || isBlocked,
      anchorRewritten: shouldRewrite,
      hrefNewlinePreserved: true,
      usedAnchorCount: used.size
    };
  }

  const urlVariants = [
    promotionUrl,
    promotionUrl.replace(/\/$/, ''),
    promotionUrl.replace(/^https:\/\//i, 'http://'),
    promotionUrl.replace(/^https?:\/\//i, '')
  ].filter(Boolean);
  for (const variant of urlVariants) {
    const re = new RegExp(escapeRegExp(variant), 'i');
    if (re.test(original)) {
      return {
        text: original.replace(re, anchorHtml),
        changed: true,
        anchorText: finalAnchorText,
        anchorSource: 'rewritten_bare_url',
        anchorWasDuplicate: false,
        anchorRewritten: true,
        hrefNewlinePreserved: true,
        usedAnchorCount: used.size
      };
    }
  }

  const separator = original.trim().endsWith('.') ? ' ' : ' ';
  return {
    text: `${original.trim()}${separator}${anchorHtml}`.trim(),
    changed: true,
    anchorText: finalAnchorText,
    anchorSource: 'appended_anchor',
    anchorWasDuplicate: false,
    anchorRewritten: true,
    hrefNewlinePreserved: true,
    usedAnchorCount: used.size
  };
}

module.exports = {
  normalizePromotionUrl,
  normalizeAnchorText,
  buildAnchorCandidates,
  isKeywordRootedAnchor,
  ensurePromotionAnchor
};
