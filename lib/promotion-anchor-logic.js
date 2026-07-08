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
  const domain = getPromotionDomain(options.promotionUrl);
  const raw = [
    ...extractKeywordPhrases(options.promotionContent),
    ...extractKeywordPhrases(options.pageTitle),
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
      if (used.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  const candidates = buildAnchorCandidates(options);
  const fallbackAnchor = candidates[0] || 'this helpful resource';
  const anchor = extractFirstAnchor(original);
  const domain = getPromotionDomain(promotionUrl);
  const hasHrefNewline = !!(anchor && /\n\s*$/.test(anchor.href));
  const normalizedExistingAnchor = anchor ? normalizeAnchorText(anchor.anchorText) : '';
  const isDuplicate = normalizedExistingAnchor ? used.has(normalizedExistingAnchor.toLowerCase()) : false;
  const isDomainLike = normalizedExistingAnchor ? normalizedExistingAnchor.toLowerCase().includes(domain) : true;
  const finalAnchorText = (!normalizedExistingAnchor || isDuplicate || isDomainLike) ? fallbackAnchor : normalizedExistingAnchor;
  const anchorHtml = buildAnchorHtml(promotionUrl, finalAnchorText);

  if (anchor) {
    const shouldRewrite = anchor.full !== anchorHtml || isDuplicate || isDomainLike || !hasHrefNewline;
    return {
      text: shouldRewrite ? original.replace(anchor.full, anchorHtml) : original,
      changed: shouldRewrite,
      anchorText: finalAnchorText,
      anchorSource: shouldRewrite ? 'rewritten_anchor' : 'model_anchor',
      anchorWasDuplicate: isDuplicate,
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
  ensurePromotionAnchor
};
