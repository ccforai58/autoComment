function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function formatManualFieldSpecs(fields) {
  if (!Array.isArray(fields) || !fields.length) return '';
  return fields
    .slice(0, 24)
    .map((field, index) => {
      const fieldId = safeText(field && field.fieldId);
      const role = safeText(field && field.role) || 'unknown';
      const label = safeText(field && field.label);
      const tag = safeText(field && field.tagName);
      const type = safeText(field && field.type);
      return `${index + 1}. ${fieldId ? `fieldId=${fieldId}, ` : ''}role=${role}${label ? `, label=${label}` : ''}${tag ? `, tag=${tag}` : ''}${type ? `, type=${type}` : ''}`;
    })
    .join('\n');
}

function buildHomepageProfilePrompt(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const lines = [
    source.targetUrl ? `URL: ${safeText(source.targetUrl)}` : '',
    source.targetDomain ? `Domain: ${safeText(source.targetDomain)}` : '',
    source.pageTitle || source.ogTitle ? `Title: ${safeText(source.pageTitle || source.ogTitle)}` : '',
    source.metaDescription || source.ogDescription ? `Description: ${safeText(source.metaDescription || source.ogDescription)}` : '',
    source.h1 ? `H1: ${safeText(source.h1)}` : '',
    Array.isArray(source.h2Texts) && source.h2Texts.length ? `H2: ${source.h2Texts.map(safeText).filter(Boolean).slice(0, 8).join(' | ')}` : '',
    Array.isArray(source.keywords) && source.keywords.length ? `Keywords: ${source.keywords.map(safeText).filter(Boolean).join(', ')}` : '',
    Array.isArray(source.imageAlts) && source.imageAlts.length ? `Images: ${source.imageAlts.map(safeText).filter(Boolean).slice(0, 8).join(' | ')}` : '',
    source.bodySummary ? `Summary: ${safeText(source.bodySummary)}` : ''
  ].filter(Boolean);
  return lines.join('\n');
}

function buildUserPrompt(input = {}) {
  const websiteUrl = safeText(input.websiteUrl);
  const title = safeText(input.title);
  const description = safeText(input.description);
  const bodyText = safeText(input.bodyText);
  const promotionWebsiteUrl = safeText(input.promotionWebsiteUrl);
  const promotionWebsiteContent = safeText(input.promotionWebsiteContent);
  const usedAnchorTexts = Array.isArray(input.usedAnchorTexts) ? input.usedAnchorTexts : [];
  const usedAnchorTextStats = Array.isArray(input.usedAnchorTextStats) ? input.usedAnchorTextStats : [];
  const manualMode = input.manualMode === true;
  const manualPageType = safeText(input.manualPageType || input.pageType);
  const manualFieldSpecs = formatManualFieldSpecs(input.manualFieldSpecs);
  const homepageProfileText = buildHomepageProfilePrompt(input.homepageProfile);
  const usedAnchors = usedAnchorTexts.map(safeText).filter(Boolean);
  const overusedAnchors = usedAnchorTextStats
    .filter((item) => item && Number(item.count) >= 30)
    .map((item) => safeText(item.text))
    .filter(Boolean);
  const languageHint = safeText(input.pageLanguageHint);
  const languageEvidence = safeText(input.pageLanguageEvidence);
  const websiteContent = [
    `【网站标题】${title || '(无标题)'}`,
    `【网站 URL】${websiteUrl || '(无 URL)'}`,
    description ? `【网站描述】${description}` : '',
    '【页面正文节选】',
    bodyText || '(当前页面正文内容为空或无法提取)'
  ].filter(Boolean).join('\n');
  const languageInstruction = [
    'The generated content language MUST match the main language of the current page.',
    'Infer the language from html lang, title, description, headings, and body text.',
    'Do not default to English when clear non-English language evidence is present.',
    'If uncertain, use English.'
  ].join(' ');
  const languageContext = [
    languageHint ? `Page language hint: ${languageHint}` : '',
    languageEvidence ? `Page language evidence: ${languageEvidence}` : ''
  ].filter(Boolean).join('\n');
  const manualInstruction = manualMode ? [
    'Manual assistant mode: Return one JSON object only. Do not use Markdown fences or explanations.',
    'JSON schema:',
    '{"commentText":"","siteTitle":"","tagline":"","shortDescription":"","longDescription":"","bio":"","tags":[],"categorySuggestion":"","pricingModel":"","authorName":"","contactEmail":"","websiteUrl":"","fieldValuesById":{"fieldId":"value"}}',
    'When detected form fields include fieldId, put the best value for each fillable field in fieldValuesById using the exact fieldId key.',
    'For directory/profile/media forms, generate plain field values only; do not include HTML links unless the field is a blog comment body.',
    'Fill values naturally from the promoted homepage profile and the current page field needs.',
    'Use only supported facts from the promoted website profile. Do not invent awards, pricing, reviews, or capabilities.',
    manualPageType ? `Detected page type: ${manualPageType}` : '',
    manualFieldSpecs ? `Detected form fields:\n${manualFieldSpecs}` : ''
  ].filter(Boolean).join('\n') : '';

  return [
    languageInstruction,
    languageContext,
    promotionWebsiteUrl ? `Promoted website URL: ${promotionWebsiteUrl}` : '',
    promotionWebsiteContent ? `Promoted website profile:\n${promotionWebsiteContent}` : '',
    homepageProfileText ? `Promoted homepage profile:\n${homepageProfileText}` : '',
    manualInstruction,
    overusedAnchors.length ? `Overused anchor texts in the last 2 days. Do not use them: ${overusedAnchors.join(' | ')}` : '',
    '下面是当前网站的内容，请根据 Skill 模板的要求，为该网站生成推广内容：',
    '',
    websiteContent,
    usedAnchors.length ? `Already used anchor texts in this batch. Do not repeat them: ${usedAnchors.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildHomepageProfilePrompt,
  buildUserPrompt,
  formatManualFieldSpecs
};
