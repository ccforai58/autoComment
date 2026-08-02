function firstValue(source, keys, fallback = '') {
  const data = source && typeof source === 'object' ? source : {};
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return fallback;
}

function normalizeHttpUrl(value) {
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
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCsvHeaderName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findCsvHeaderIndex(headers, names) {
  const accepted = new Set((Array.isArray(names) ? names : []).map(normalizeCsvHeaderName));
  return (Array.isArray(headers) ? headers : []).findIndex((item) => accepted.has(normalizeCsvHeaderName(item)));
}

function getSemrushArray(row, keys) {
  const value = firstValue(row, keys, []);
  return parseJsonArray(value).map((item) => String(item == null ? '' : item));
}

function getSemrushHeaders(row) {
  return getSemrushArray(row, ['semrushHeaders', 'semrush_headers', 'semrushHeadersJson', 'semrush_headers_json']);
}

function getSemrushRow(row) {
  return getSemrushArray(row, ['semrushRow', 'semrush_row', 'semrushRowJson', 'semrush_row_json']);
}

function parseKeywords(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,\uFF0C;\uFF1B]+/);
  const seen = new Set();
  const result = [];
  for (const item of rawItems) {
    const keyword = String(item || '').trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function mergeKeywordValues(...values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    for (const keyword of parseKeywords(value)) {
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(keyword);
    }
  }
  return result;
}

function normalizeSubmitMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'auto') return 'auto';
  if (mode === 'confirm' || mode === 'semi_auto' || mode === 'semi-auto') return 'confirm';
  if (mode === 'manual') return 'manual';
  return 'auto';
}

function normalizePromotionProject(input) {
  const source = input && typeof input === 'object' ? input : {};
  const targetRaw = firstValue(source, ['targetUrl', 'target_url', 'websiteUrl', 'website_url', 'promotionWebsiteUrl']);
  const normalized = normalizeHttpUrl(targetRaw);
  const keywords = mergeKeywordValues(
    firstValue(source, ['keywords', 'keywordList'], []),
    firstValue(source, ['keywordsJson', 'keywords_json'], []),
    firstValue(source, ['defaultAnchorText', 'default_anchor_text'], '')
  );

  return {
    id: firstValue(source, ['id'], null),
    targetUrl: normalized.ok ? normalized.url : String(targetRaw || '').trim(),
    targetUrlKey: normalized.ok ? normalized.key : '',
    targetDomain: normalized.ok ? normalized.domain : String(firstValue(source, ['targetDomain', 'target_domain'], '') || '').trim(),
    keywords,
    keywordsJson: JSON.stringify(keywords),
    pageTitle: String(firstValue(source, ['pageTitle', 'page_title', 'title'], '') || '').trim(),
    metaDescription: String(firstValue(source, ['metaDescription', 'meta_description', 'productDescription', 'product_description'], '') || '').trim(),
    h1: String(firstValue(source, ['h1'], '') || '').trim(),
    commentAuthor: String(firstValue(source, ['commentAuthor', 'comment_author'], '') || '').trim(),
    contactEmail: String(firstValue(source, ['contactEmail', 'contact_email'], '') || '').trim(),
    defaultSubmitMode: normalizeSubmitMode(firstValue(source, ['defaultSubmitMode', 'default_submit_mode'], 'auto')),
    fetchStatus: String(firstValue(source, ['fetchStatus', 'fetch_status'], '') || '').trim(),
    fetchError: String(firstValue(source, ['fetchError', 'fetch_error'], '') || '').trim(),
    fetchedAt: firstValue(source, ['fetchedAt', 'fetched_at'], '')
  };
}

function normalizeDiscoveryTarget(value) {
  const normalized = normalizeHttpUrl(value);
  return normalized.ok ? normalized.url : String(value || '').trim();
}

function mergeDiscoveryTargets(existingJson, incomingUrl) {
  const existing = parseJsonArray(existingJson).map(normalizeDiscoveryTarget).filter(Boolean);
  const incoming = normalizeDiscoveryTarget(incomingUrl);
  const seen = new Set();
  const discoveryTargetUrls = [];

  for (const item of existing) {
    const key = normalizeHttpUrl(item).key || item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    discoveryTargetUrls.push(item);
  }

  if (incoming) {
    const incomingKey = normalizeHttpUrl(incoming).key || incoming.toLowerCase();
    if (!seen.has(incomingKey)) {
      discoveryTargetUrls.push(incoming);
      seen.add(incomingKey);
    }
  }

  return {
    firstDiscoveryTargetUrl: discoveryTargetUrls[0] || '',
    lastDiscoveryTargetUrl: incoming || discoveryTargetUrls[discoveryTargetUrls.length - 1] || '',
    discoveryTargetUrls
  };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function shapeResourcePage(input) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = normalizeHttpUrl(firstValue(source, ['sourceUrl', 'source_url', 'url']));
  const target = normalizeHttpUrl(firstValue(source, ['targetUrl', 'target_url', 'promotionWebsiteUrl']));
  const merged = mergeDiscoveryTargets(
    firstValue(source, ['discoveryTargetUrlsJson', 'discovery_target_urls_json', 'discoveryTargetUrls'], []),
    firstValue(source, ['discoveryTargetUrl', 'discovery_target_url', 'targetUrl', 'target_url'])
  );

  return {
    promotionProjectId: firstValue(source, ['promotionProjectId', 'promotion_project_id'], null),
    targetUrl: target.ok ? target.url : String(firstValue(source, ['targetUrl', 'target_url', 'promotionWebsiteUrl'], '') || '').trim(),
    targetUrlKey: target.ok ? target.key : '',
    targetDomain: target.ok ? target.domain : String(firstValue(source, ['targetDomain', 'target_domain'], '') || '').trim(),
    targetDomainAuthority: firstValue(source, ['targetDomainAuthority', 'target_domain_authority'], null),
    targetDomainTraffic: firstValue(source, ['targetDomainTraffic', 'target_domain_traffic'], null),
    sourceUrl: normalized.ok ? normalized.url : String(firstValue(source, ['sourceUrl', 'source_url', 'url'], '') || '').trim(),
    sourceUrlKey: normalized.ok ? normalized.key : '',
    sourceDomain: normalized.ok ? normalized.domain : String(firstValue(source, ['sourceDomain', 'source_domain'], '') || '').trim(),
    firstDiscoveryTargetUrl: merged.firstDiscoveryTargetUrl,
    lastDiscoveryTargetUrl: merged.lastDiscoveryTargetUrl,
    discoveryTargetUrls: merged.discoveryTargetUrls,
    discoveryTargetUrlsJson: JSON.stringify(merged.discoveryTargetUrls),
    sourceTitle: String(firstValue(source, ['sourceTitle', 'source_title', 'title'], '') || '').trim(),
    resourceType: String(firstValue(source, ['resourceType', 'resource_type'], '') || '').trim(),
    qualityLabel: String(firstValue(source, ['qualityLabel', 'quality_label'], '') || '').trim(),
    topicTags: parseKeywords(firstValue(source, ['topicTags', 'topic_tags', 'topicTagsJson', 'topic_tags_json'], [])),
    topicTagsJson: JSON.stringify(parseKeywords(firstValue(source, ['topicTags', 'topic_tags', 'topicTagsJson', 'topic_tags_json'], []))),
    notes: String(firstValue(source, ['notes'], '') || '').trim(),
    pageAscore: toNullableNumber(firstValue(source, ['pageAscore', 'page_ascore'])),
    externalLinks: toNullableNumber(firstValue(source, ['externalLinks', 'external_links'])),
    lastSeen: String(firstValue(source, ['lastSeen', 'last_seen'], '') || '').trim(),
    submitSource: String(firstValue(source, ['submitSource', 'submit_source'], '') || '').trim(),
    semrushHeaders: getSemrushHeaders(source),
    semrushHeadersJson: JSON.stringify(getSemrushHeaders(source)),
    semrushRow: getSemrushRow(source),
    semrushRowJson: JSON.stringify(getSemrushRow(source))
  };
}

function shapeVerifiedBacklink(input) {
  const source = input && typeof input === 'object' ? input : {};
  const target = normalizeHttpUrl(firstValue(source, ['targetUrl', 'target_url', 'promotionWebsiteUrl']));
  const sourceUrl = normalizeHttpUrl(firstValue(source, ['sourceUrl', 'source_url', 'url']));
  return {
    resourcePageId: firstValue(source, ['resourcePageId', 'resource_page_id'], null),
    promotionProjectId: firstValue(source, ['promotionProjectId', 'promotion_project_id'], null),
    targetUrl: target.ok ? target.url : String(firstValue(source, ['targetUrl', 'target_url', 'promotionWebsiteUrl'], '') || '').trim(),
    targetUrlKey: target.ok ? target.key : '',
    targetDomain: target.ok ? target.domain : String(firstValue(source, ['targetDomain', 'target_domain'], '') || '').trim(),
    targetDomainAuthority: firstValue(source, ['targetDomainAuthority', 'target_domain_authority'], null),
    targetDomainTraffic: firstValue(source, ['targetDomainTraffic', 'target_domain_traffic'], null),
    discoveryTargetUrl: normalizeDiscoveryTarget(firstValue(source, ['discoveryTargetUrl', 'discovery_target_url'], '')),
    matchedHref: String(firstValue(source, ['matchedHref', 'matched_href'], '') || '').trim(),
    backlinkStatus: String(firstValue(source, ['backlinkStatus', 'backlink_status'], 'success') || 'success').trim(),
    sourceUrlKey: sourceUrl.ok ? sourceUrl.key : String(firstValue(source, ['sourceUrlKey', 'source_url_key'], '') || '').trim()
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getRowDiscoveryTargets(row) {
  const value = firstValue(row, ['discoveryTargetUrls', 'discovery_target_urls', 'discoveryTargetUrlsJson', 'discovery_target_urls_json'], []);
  const parsed = parseJsonArray(value);
  if (parsed.length) return parsed.map(normalizeDiscoveryTarget).filter(Boolean);
  const single = normalizeDiscoveryTarget(firstValue(row, ['firstDiscoveryTargetUrl', 'first_discovery_target_url', 'discoveryTargetUrl', 'discovery_target_url'], ''));
  return single ? [single] : [];
}

function getSelectedDiscovery(row, selectedDiscoveryTargetUrl) {
  const targets = getRowDiscoveryTargets(row);
  const selected = normalizeDiscoveryTarget(selectedDiscoveryTargetUrl);
  if (!selected) return targets[0] || '';
  const selectedKey = normalizeHttpUrl(selected).key || selected.toLowerCase();
  return targets.some((item) => (normalizeHttpUrl(item).key || item.toLowerCase()) === selectedKey)
    ? selected
    : '';
}

function buildSemrushCompatibleResourceCsv(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const defaultHeaders = ['Source url', 'Target url', 'Page ascore', 'Source title', 'External links', 'Last seen'];
  const originalHeaders = rows.map(getSemrushHeaders).find((headers) => headers.length > 0) || [];
  const headers = originalHeaders.length ? originalHeaders.slice() : defaultHeaders.slice();
  for (const header of defaultHeaders) {
    if (findCsvHeaderIndex(headers, [header]) < 0) headers.push(header);
  }
  const outputRows = [];
  let skippedCount = 0;
  const selectedDiscoveryTargetUrl = normalizeDiscoveryTarget(source.selectedDiscoveryTargetUrl);

  for (const row of rows) {
    const discoveryTargetUrl = getSelectedDiscovery(row, source.selectedDiscoveryTargetUrl);
    const sourceUrl = String(firstValue(row, ['sourceUrl', 'source_url'], '') || '').trim();
    if (!sourceUrl || (selectedDiscoveryTargetUrl && !discoveryTargetUrl)) {
      if (!source.selectedDiscoveryTargetUrl) skippedCount++;
      continue;
    }
    const originalRow = getSemrushRow(row);
    const cells = headers.map((_, index) => originalRow[index] == null ? '' : originalRow[index]);
    const setCell = (names, value) => {
      const index = findCsvHeaderIndex(headers, names);
      if (index < 0) return;
      if (value === undefined || value === null) return;
      cells[index] = String(value);
    };
    setCell(['Source url', 'source_url', 'URL', 'url'], sourceUrl);
    setCell(['Target url', 'target_url'], discoveryTargetUrl || firstValue(row, ['firstDiscoveryTargetUrl', 'first_discovery_target_url', 'discoveryTargetUrl', 'discovery_target_url'], ''));
    setCell(['Page ascore', 'page_ascore', 'ascore'], firstValue(row, ['pageAscore', 'page_ascore'], ''));
    setCell(['Source title', 'source_title', 'title'], firstValue(row, ['sourceTitle', 'source_title'], ''));
    setCell(['External links', 'external_links'], firstValue(row, ['externalLinks', 'external_links'], ''));
    setCell(['Last seen', 'last_seen'], firstValue(row, ['lastSeen', 'last_seen'], ''));
    outputRows.push(cells.map(csvEscape).join(','));
  }

  const datePart = String(source.filenameDate || new Date().toISOString().slice(0, 10));
  return {
    content: [headers.join(','), ...outputRows].join('\n'),
    filename: `link-assistant-semrush-resources-${datePart}.csv`,
    recordCount: outputRows.length,
    skippedCount
  };
}

function buildManagementResourceCsv(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const headers = [
    '#',
    'Promotion target url',
    'Promotion target domain',
    'Target domain authority',
    'Target domain traffic',
    'Source url',
    'Source domain',
    'Discovery target url',
    'All discovery target urls',
    'Page ascore',
    'Source title',
    'External links',
    'Last seen',
    'Submit source',
    'First verified at',
    'Last verified at',
    'Backlink status',
    'Promotion keywords',
    'Page title',
    'Description',
    'H1'
  ];

  const outputRows = rows.map((row, index) => {
    const discoveryTargets = getRowDiscoveryTargets(row);
    const keywords = parseKeywords(firstValue(row, ['keywords', 'promotionKeywords', 'promotion_keywords'], []));
    return [
      index + 1,
      firstValue(row, ['targetUrl', 'target_url', 'promotionTargetUrl'], ''),
      firstValue(row, ['targetDomain', 'target_domain', 'promotionTargetDomain'], ''),
      firstValue(row, ['targetDomainAuthority', 'target_domain_authority'], ''),
      firstValue(row, ['targetDomainTraffic', 'target_domain_traffic'], ''),
      firstValue(row, ['sourceUrl', 'source_url'], ''),
      firstValue(row, ['sourceDomain', 'source_domain'], ''),
      firstValue(row, ['discoveryTargetUrl', 'discovery_target_url', 'firstDiscoveryTargetUrl', 'first_discovery_target_url'], ''),
      discoveryTargets.join('; '),
      firstValue(row, ['pageAscore', 'page_ascore'], ''),
      firstValue(row, ['sourceTitle', 'source_title'], ''),
      firstValue(row, ['externalLinks', 'external_links'], ''),
      firstValue(row, ['lastSeen', 'last_seen'], ''),
      firstValue(row, ['submitSource', 'submit_source'], ''),
      firstValue(row, ['firstVerifiedAt', 'first_verified_at'], ''),
      firstValue(row, ['lastVerifiedAt', 'last_verified_at'], ''),
      firstValue(row, ['backlinkStatus', 'backlink_status'], ''),
      keywords.join('; '),
      firstValue(row, ['pageTitle', 'page_title'], ''),
      firstValue(row, ['metaDescription', 'meta_description', 'description'], ''),
      firstValue(row, ['h1'], '')
    ].map(csvEscape).join(',');
  });

  const datePart = String(source.filenameDate || new Date().toISOString().slice(0, 10));
  return {
    content: [headers.map(csvEscape).join(','), ...outputRows].join('\n'),
    filename: `link-assistant-resources-management-${datePart}.csv`,
    recordCount: outputRows.length
  };
}

module.exports = {
  normalizeHttpUrl,
  normalizePromotionProject,
  normalizeSubmitMode,
  parseKeywords,
  mergeDiscoveryTargets,
  shapeResourcePage,
  shapeVerifiedBacklink,
  buildSemrushCompatibleResourceCsv,
  buildManagementResourceCsv,
  csvEscape
};
