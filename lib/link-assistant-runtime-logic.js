(function initLinkAssistantRuntimeLogic(root) {
  'use strict';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHttpUrl(value) {
  const text = safeText(value);
  if (!text) return { ok: false, url: '', key: '', domain: '' };
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, url: '', key: '', domain: '' };
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
      domain: keyUrl.hostname.replace(/^www\./, '')
    };
  } catch (_) {
    return { ok: false, url: '', key: '', domain: '' };
  }
}

function parseKeywords(value) {
  const rawItems = Array.isArray(value)
    ? value
    : safeText(value).split(/[\n,\uFF0C;\uFF1B]+/);
  const seen = new Set();
  const result = [];
  for (const item of rawItems) {
    const keyword = safeText(item);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function normalizePromotionProject(input) {
  const source = input && typeof input === 'object' ? input : {};
  const targetRaw = firstNonEmpty(source.targetUrl, source.target_url, source.websiteUrl, source.website_url, source.promotionWebsiteUrl);
  const normalized = normalizeHttpUrl(targetRaw);
  const keywords = parseKeywordArray(source.keywords || source.keywordsJson || source.keywords_json || source.defaultAnchorText || source.default_anchor_text);
  return {
    id: source.id || null,
    targetUrl: normalized.ok ? normalized.url : targetRaw,
    targetUrlKey: normalized.ok ? normalized.key : '',
    targetDomain: normalized.ok ? normalized.domain : safeText(source.targetDomain || source.target_domain),
    keywords,
    pageTitle: safeText(source.pageTitle || source.page_title || source.title),
    metaDescription: safeText(source.metaDescription || source.meta_description || source.description || source.productDescription || source.product_description),
    h1: safeText(source.h1),
    commentAuthor: safeText(source.commentAuthor || source.comment_author),
    contactEmail: safeText(source.contactEmail || source.contact_email),
    defaultSubmitMode: safeText(source.defaultSubmitMode || source.default_submit_mode || 'auto')
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
}

function normalizeId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseKeywordArray(value) {
  if (Array.isArray(value)) return parseKeywords(value);
  const text = safeText(value);
  if (!text) return [];
  if (/^\s*\[/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parseKeywords(parsed);
    } catch (_) {}
  }
  return parseKeywords(text);
}

function normalizeProject(input) {
  if (!input || typeof input !== 'object') return null;
  const normalized = normalizePromotionProject({
    ...input,
    keywords: parseKeywordArray(input.keywords || input.keywordsJson || input.keywords_json || input.defaultAnchorText)
  });
  const id = normalizeId(input.id);
  return {
    ...normalized,
    id: id || input.id || null,
    keywords: parseKeywordArray(input.keywords || input.keywordsJson || input.keywords_json || normalized.keywords)
  };
}

function buildPromotionWebsiteContent(project, legacyContent) {
  const source = project || {};
  const parts = [];
  if (source.pageTitle) parts.push(`Title: ${source.pageTitle}`);
  if (source.metaDescription) parts.push(`Description: ${source.metaDescription}`);
  if (source.h1) parts.push(`H1: ${source.h1}`);
  if (Array.isArray(source.keywords) && source.keywords.length) {
    parts.push(`Keywords: ${source.keywords.join(', ')}`);
  }
  return parts.join('\n') || safeText(legacyContent);
}

function selectPromotionCopyInputs(input = {}) {
  const project = normalizeProject(input.project);
  const legacyUrl = safeText(input.legacyUrl);
  const legacyContent = safeText(input.legacyContent);
  const usedProjectKeywords = project ? parseKeywordArray(project.keywords) : [];
  const promotionWebsiteUrl = project && project.targetUrl ? project.targetUrl : legacyUrl;
  const promotionWebsiteContent = project
    ? buildPromotionWebsiteContent({ ...project, keywords: usedProjectKeywords }, legacyContent)
    : legacyContent;

  return {
    promotionProjectId: project && project.id ? project.id : null,
    targetUrl: project && project.targetUrl ? project.targetUrl : '',
    targetDomain: project && project.targetDomain ? project.targetDomain : '',
    promotionWebsiteUrl,
    promotionWebsiteContent,
    usedProjectKeywords
  };
}

function buildSubmissionPayload(input = {}) {
  const project = normalizeProject(input.project) || {};
  const resultEntry = input.resultEntry && typeof input.resultEntry === 'object' ? input.resultEntry : {};
  const semrushMeta = input.semrushMeta && typeof input.semrushMeta === 'object'
    ? input.semrushMeta
    : (resultEntry.semrushMeta && typeof resultEntry.semrushMeta === 'object' ? resultEntry.semrushMeta : {});
  const discoveryTargetUrl = firstNonEmpty(
    resultEntry.discoveryTargetUrl,
    resultEntry.discovery_target_url,
    input.discoveryTargetUrl,
    semrushMeta.targetUrl,
    semrushMeta.target_url
  );

  return {
    promotionProjectId: normalizeId(project.id),
    targetUrl: project.targetUrl || firstNonEmpty(resultEntry.targetUrl, resultEntry.promotionWebsiteUrl),
    targetDomain: project.targetDomain || safeText(resultEntry.targetDomain),
    sourceUrl: firstNonEmpty(resultEntry.sourceUrl, resultEntry.url),
    sourceDomain: safeText(resultEntry.sourceDomain),
    discoveryTargetUrl,
    pageAscore: resultEntry.pageAscore ?? semrushMeta.pageAscore ?? semrushMeta.page_ascore ?? null,
    sourceTitle: firstNonEmpty(resultEntry.sourceTitle, semrushMeta.sourceTitle, semrushMeta.source_title),
    externalLinks: resultEntry.externalLinks ?? semrushMeta.externalLinks ?? semrushMeta.external_links ?? null,
    lastSeen: firstNonEmpty(resultEntry.lastSeen, semrushMeta.lastSeen, semrushMeta.last_seen),
    submitResult: safeText(resultEntry.result),
    aiContent: resultEntry.aiContent == null ? null : String(resultEntry.aiContent),
    errorMessage: resultEntry.errorMessage == null ? null : String(resultEntry.errorMessage),
    semrushHeaders: Array.isArray(resultEntry.semrushHeaders) ? resultEntry.semrushHeaders : (Array.isArray(semrushMeta.semrushHeaders) ? semrushMeta.semrushHeaders : []),
    semrushRow: Array.isArray(resultEntry.semrushRow) ? resultEntry.semrushRow : (Array.isArray(resultEntry.originalRow) ? resultEntry.originalRow : (Array.isArray(semrushMeta.semrushRow) ? semrushMeta.semrushRow : [])),
    semrushMeta
  };
}

function normalizeCurrentProjectResponse(input = {}) {
  const currentPromotionProjectId = safeText(input.currentPromotionProjectId || input.current_promotion_project_id);
  if (!currentPromotionProjectId) {
    return { project: null, missingReason: 'missing_current_promotion_project_id' };
  }

  const response = input.response && typeof input.response === 'object' ? input.response : {};
  const projects = Array.isArray(response.projects) ? response.projects : [];
  const project = projects.map(normalizeProject).find((item) => item && String(item.id) === currentPromotionProjectId) || null;
  if (!project) {
    return { project: null, missingReason: 'current_promotion_project_not_found' };
  }
  return { project, missingReason: '' };
}

function buildBacklinkCheckResultPayload(input = {}) {
  const record = input.record && typeof input.record === 'object' ? input.record : {};
  const result = input.result && typeof input.result === 'object' ? input.result : {};
  const semrushMeta = record.semrushMeta && typeof record.semrushMeta === 'object'
    ? record.semrushMeta
    : (record.semrush_meta && typeof record.semrush_meta === 'object' ? record.semrush_meta : {});
  const submissionId = normalizeId(record.backendSubmissionId || record.submissionId || record.submission_id);
  if (!submissionId) return null;
  return {
    submissionId,
    promotionProjectId: normalizeId(record.promotionProjectId || record.promotion_project_id),
    targetUrl: firstNonEmpty(record.targetUrl, record.target_url, record.promotionWebsiteUrl, record.promotion_website_url),
    targetDomain: firstNonEmpty(record.targetDomain, record.target_domain),
    sourceUrl: firstNonEmpty(record.sourceUrl, record.source_url, record.url),
    sourceDomain: firstNonEmpty(record.sourceDomain, record.source_domain),
    sourceTitle: firstNonEmpty(record.sourceTitle, record.source_title),
    discoveryTargetUrl: firstNonEmpty(record.discoveryTargetUrl, record.discovery_target_url),
    latestBacklinkStatus: firstNonEmpty(result.latestBacklinkStatus, record.latestBacklinkStatus),
    latestBacklinkCheckedAt: firstNonEmpty(result.latestBacklinkCheckedAt, record.latestBacklinkCheckedAt),
    latestBacklinkMatchedHref: firstNonEmpty(result.latestBacklinkMatchedHref, record.latestBacklinkMatchedHref),
    latestBacklinkReason: firstNonEmpty(result.latestBacklinkReason, record.latestBacklinkReason),
    pageAscore: record.pageAscore ?? record.page_ascore ?? semrushMeta.pageAscore ?? semrushMeta.page_ascore ?? null,
    externalLinks: record.externalLinks ?? record.external_links ?? semrushMeta.externalLinks ?? semrushMeta.external_links ?? null,
    lastSeen: firstNonEmpty(record.lastSeen, record.last_seen, semrushMeta.lastSeen, semrushMeta.last_seen),
    semrushHeaders: Array.isArray(record.semrushHeaders) ? record.semrushHeaders : (Array.isArray(semrushMeta.semrushHeaders) ? semrushMeta.semrushHeaders : []),
    semrushRow: Array.isArray(record.semrushRow) ? record.semrushRow : (Array.isArray(record.originalRow) ? record.originalRow : (Array.isArray(semrushMeta.semrushRow) ? semrushMeta.semrushRow : [])),
    semrushMeta
  };
}

const api = {
  buildBacklinkCheckResultPayload,
  buildSubmissionPayload,
  normalizeCurrentProjectResponse,
  normalizeProject,
  parseKeywordArray,
  selectPromotionCopyInputs
};

root.AutoCommentLinkAssistantRuntimeLogic = api;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== 'undefined' ? globalThis : window);
