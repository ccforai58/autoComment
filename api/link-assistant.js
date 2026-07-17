const express = require('express');

const database = require('./db');
const {
  buildManagementResourceCsv,
  buildSemrushCompatibleResourceCsv,
  normalizeHttpUrl,
  normalizePromotionProject,
  shapeResourcePage
} = require('../lib/link-assistant-resource-logic');

const METADATA_FETCH_TIMEOUT_MS = Number(process.env.LINK_ASSISTANT_METADATA_FETCH_TIMEOUT_MS || 12000);
const METADATA_MAX_HTML_CHARS = Number(process.env.LINK_ASSISTANT_METADATA_MAX_HTML_CHARS || 200000);

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function toMysqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  return safeDate.toISOString().slice(0, 19).replace('T', ' ');
}

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function toOptionalNumber(value) {
  const text = safeText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeFilterUrlKey(value) {
  const text = safeText(value);
  if (!text) return '';
  const normalized = normalizeHttpUrl(text);
  if (normalized.ok) return normalized.key || normalized.url.toLowerCase().replace(/\/+$/, '');
  return text.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

function getResourceDiscoveryTargetsForFilter(row) {
  const values = [
    ...parseJsonArray(rowValue(row, 'discoveryTargetUrlsJson', 'discovery_target_urls_json', 'discoveryTargetUrls', 'discovery_target_urls')),
    rowValue(row, 'firstDiscoveryTargetUrl', 'first_discovery_target_url'),
    rowValue(row, 'lastDiscoveryTargetUrl', 'last_discovery_target_url'),
    rowValue(row, 'discoveryTargetUrl', 'discovery_target_url')
  ];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = safeText(value);
    if (!text) continue;
    const key = normalizeFilterUrlKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function resourceMatchesDiscoveryTarget(row, discoveryTargetUrl) {
  const selectedKey = normalizeFilterUrlKey(discoveryTargetUrl);
  if (!selectedKey) return true;
  return getResourceDiscoveryTargetsForFilter(row)
    .some((target) => normalizeFilterUrlKey(target) === selectedKey);
}

function buildResourceFilterSearchText(row) {
  return [
    rowValue(row, 'sourceUrl', 'source_url'),
    rowValue(row, 'sourceDomain', 'source_domain'),
    rowValue(row, 'sourceTitle', 'source_title', 'title'),
    rowValue(row, 'resourceType', 'resource_type'),
    rowValue(row, 'qualityLabel', 'quality_label'),
    rowValue(row, 'notes'),
    rowValue(row, 'targetUrl', 'target_url'),
    rowValue(row, 'targetDomain', 'target_domain'),
    rowValue(row, 'pageTitle', 'page_title'),
    rowValue(row, 'metaDescription', 'meta_description'),
    rowValue(row, 'h1'),
    ...parseJsonArray(rowValue(row, 'topicTagsJson', 'topic_tags_json', 'topicTags', 'topic_tags')),
    ...getResourceDiscoveryTargetsForFilter(row)
  ].join(' ').toLowerCase();
}

function filterResourceRowsForQuery(rows, query = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const keyword = safeText(query.keyword).toLowerCase();
  const promotionProjectId = safeText(query.promotionProjectId || query.promotion_project_id);
  const resourceType = safeText(query.resourceType || query.resource_type);
  const qualityLabel = safeText(query.qualityLabel || query.quality_label);
  const discoveryTargetUrl = safeText(query.discoveryTargetUrl || query.discovery_target_url);
  let minPageAscore = toOptionalNumber(query.minPageAscore);
  let maxPageAscore = toOptionalNumber(query.maxPageAscore);
  if (minPageAscore !== null && maxPageAscore !== null && minPageAscore > maxPageAscore) {
    const tmp = minPageAscore;
    minPageAscore = maxPageAscore;
    maxPageAscore = tmp;
  }
  return sourceRows.filter((row) => {
    if (promotionProjectId && safeText(rowValue(row, 'promotionProjectId', 'promotion_project_id')) !== promotionProjectId) return false;
    if (resourceType && safeText(rowValue(row, 'resourceType', 'resource_type')) !== resourceType) return false;
    if (qualityLabel && safeText(rowValue(row, 'qualityLabel', 'quality_label')) !== qualityLabel) return false;
    if (discoveryTargetUrl && !resourceMatchesDiscoveryTarget(row, discoveryTargetUrl)) return false;
    const pageAscore = toOptionalNumber(rowValue(row, 'pageAscore', 'page_ascore'));
    if (minPageAscore !== null || maxPageAscore !== null) {
      if (pageAscore === null) return false;
      if (minPageAscore !== null && pageAscore < minPageAscore) return false;
      if (maxPageAscore !== null && pageAscore > maxPageAscore) return false;
    }
    if (keyword && !buildResourceFilterSearchText(row).includes(keyword)) return false;
    return true;
  });
}

function safeError(error) {
  return (error && error.message ? String(error.message) : String(error || 'unknown_error')).slice(0, 240);
}

function safeLogHost(value) {
  const normalized = normalizeHttpUrl(value);
  return normalized.ok ? normalized.domain : '';
}

function collapseWhitespace(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);?/g, (_, decimal) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripHtmlTags(value) {
  return collapseWhitespace(decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' ')));
}

function parseHtmlAttributes(tag) {
  const attributes = {};
  const text = String(tag || '');
  const pattern = /([^\s"'=<>`]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(text))) {
    const name = String(match[1] || '').toLowerCase();
    attributes[name] = decodeHtmlEntities(match[3] || match[4] || match[5] || '');
  }
  return attributes;
}

function getMetaContent(html, matcher) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = parseHtmlAttributes(tag);
    if (matcher(attrs)) return collapseWhitespace(attrs.content || '');
  }
  return '';
}

function extractFirstTagText(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(html || '').match(pattern);
  return match ? stripHtmlTags(match[1]) : '';
}

function parseMetadataKeywords(value) {
  const seen = new Set();
  const result = [];
  for (const item of String(value || '').split(/[\n,;\uFF0C\uFF1B]+/)) {
    const keyword = collapseWhitespace(item);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result.slice(0, 20);
}

function extractPromotionMetadataFromHtml(html, target) {
  const title = extractFirstTagText(html, 'title') || getMetaContent(html, (attrs) =>
    String(attrs.property || attrs.name || '').toLowerCase() === 'og:title'
  );
  const description = getMetaContent(html, (attrs) => String(attrs.name || '').toLowerCase() === 'description')
    || getMetaContent(html, (attrs) => String(attrs.property || '').toLowerCase() === 'og:description')
    || getMetaContent(html, (attrs) => String(attrs.name || '').toLowerCase() === 'twitter:description');
  const keywordsText = getMetaContent(html, (attrs) => String(attrs.name || '').toLowerCase() === 'keywords');

  return {
    targetUrl: target.targetUrl,
    targetDomain: target.targetDomain,
    keywords: parseMetadataKeywords(keywordsText),
    pageTitle: collapseWhitespace(title),
    metaDescription: collapseWhitespace(description),
    h1: extractFirstTagText(html, 'h1')
  };
}

async function fetchHtmlWithTimeout(url, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : METADATA_FETCH_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error('metadata_fetch_timeout')), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
      headers: {
        'user-agent': 'Mozilla/5.0 AutoCommentMetadataFetcher/1.0',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response || response.ok === false) {
      const status = response && response.status ? response.status : 'unknown';
      throw new Error(`http_status_${status}`);
    }
    const html = await response.text();
    return {
      html: String(html || '').slice(0, METADATA_MAX_HTML_CHARS),
      status: response.status || 200,
      finalUrl: response.url || url,
      contentType: response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('content-type') || '')
        : ''
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeId(value) {
  const text = safeText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : text;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) return row[key];
  }
  return '';
}

function shapeProjectRow(row) {
  if (!row) return null;
  return {
    id: rowValue(row, 'id'),
    targetUrl: rowValue(row, 'targetUrl', 'target_url', 'website_url', 'default_website_url'),
    targetUrlKey: rowValue(row, 'targetUrlKey', 'target_url_key'),
    targetDomain: rowValue(row, 'targetDomain', 'target_domain'),
    keywords: parseJsonArray(rowValue(row, 'keywordsJson', 'keywords_json', 'topic_tags')),
    keywordsJson: rowValue(row, 'keywordsJson', 'keywords_json', 'topic_tags') || '[]',
    pageTitle: rowValue(row, 'pageTitle', 'page_title', 'product_name', 'name'),
    metaDescription: rowValue(row, 'metaDescription', 'meta_description', 'product_description'),
    h1: rowValue(row, 'h1'),
    commentAuthor: rowValue(row, 'commentAuthor', 'comment_author'),
    contactEmail: rowValue(row, 'contactEmail', 'contact_email'),
    defaultSubmitMode: rowValue(row, 'defaultSubmitMode', 'default_submit_mode') || 'auto',
    fetchStatus: rowValue(row, 'fetchStatus', 'fetch_status'),
    fetchError: rowValue(row, 'fetchError', 'fetch_error'),
    fetchedAt: rowValue(row, 'fetchedAt', 'fetched_at')
  };
}

function shapeResourceRow(row) {
  if (!row) return null;
  return {
    id: rowValue(row, 'id', 'resourcePageId', 'resource_page_id'),
    verifiedBacklinkId: rowValue(row, 'verifiedBacklinkId', 'verified_backlink_id'),
    promotionProjectId: rowValue(row, 'promotionProjectId', 'promotion_project_id'),
    sourceUrl: rowValue(row, 'sourceUrl', 'source_url'),
    sourceUrlKey: rowValue(row, 'sourceUrlKey', 'source_url_key'),
    sourceDomain: rowValue(row, 'sourceDomain', 'source_domain'),
    firstDiscoveryTargetUrl: rowValue(row, 'firstDiscoveryTargetUrl', 'first_discovery_target_url'),
    lastDiscoveryTargetUrl: rowValue(row, 'lastDiscoveryTargetUrl', 'last_discovery_target_url'),
    discoveryTargetUrlsJson: rowValue(row, 'discoveryTargetUrlsJson', 'discovery_target_urls_json') || '[]',
    discoveryTargetUrls: parseJsonArray(rowValue(row, 'discoveryTargetUrlsJson', 'discovery_target_urls_json')),
    sourceTitle: rowValue(row, 'sourceTitle', 'source_title'),
    resourceType: rowValue(row, 'resourceType', 'resource_type'),
    qualityLabel: rowValue(row, 'qualityLabel', 'quality_label'),
    topicTagsJson: rowValue(row, 'topicTagsJson', 'topic_tags_json') || '[]',
    topicTags: parseJsonArray(rowValue(row, 'topicTagsJson', 'topic_tags_json')),
    notes: rowValue(row, 'notes'),
    pageAscore: rowValue(row, 'pageAscore', 'page_ascore'),
    externalLinks: rowValue(row, 'externalLinks', 'external_links'),
    lastSeen: rowValue(row, 'lastSeen', 'last_seen'),
    semrushHeadersJson: rowValue(row, 'semrushHeadersJson', 'semrush_headers_json') || '[]',
    semrushHeaders: parseJsonArray(rowValue(row, 'semrushHeadersJson', 'semrush_headers_json')),
    semrushRowJson: rowValue(row, 'semrushRowJson', 'semrush_row_json') || '[]',
    semrushRow: parseJsonArray(rowValue(row, 'semrushRowJson', 'semrush_row_json')),
    targetUrl: rowValue(row, 'targetUrl', 'target_url'),
    targetDomain: rowValue(row, 'targetDomain', 'target_domain'),
    targetDomainAuthority: rowValue(row, 'targetDomainAuthority', 'target_domain_authority'),
    targetDomainTraffic: rowValue(row, 'targetDomainTraffic', 'target_domain_traffic'),
    firstVerifiedAt: rowValue(row, 'firstVerifiedAt', 'first_verified_at'),
    lastVerifiedAt: rowValue(row, 'lastVerifiedAt', 'last_verified_at'),
    backlinkStatus: rowValue(row, 'backlinkStatus', 'backlink_status'),
    matchedHref: rowValue(row, 'matchedHref', 'matched_href'),
    keywords: parseJsonArray(rowValue(row, 'keywordsJson', 'keywords_json')),
    pageTitle: rowValue(row, 'pageTitle', 'page_title'),
    metaDescription: rowValue(row, 'metaDescription', 'meta_description'),
    h1: rowValue(row, 'h1'),
    createdAt: rowValue(row, 'createdAt', 'created_at'),
    updatedAt: rowValue(row, 'updatedAt', 'updated_at')
  };
}

function createMemoryLinkAssistantStore() {
  let nextId = 1;
  const projects = [];
  const resourcePages = [];
  const submissions = [];
  const verifiedBacklinks = [];

  function assignId(row) {
    if (!row.id) row.id = nextId++;
    return row;
  }

  return {
    async ensureTables() {},
    async listProjects() {
      return projects.map((row) => ({ ...row }));
    },
    async saveProject(project, now) {
      const existing = projects.find((row) => row.targetUrlKey && row.targetUrlKey === project.targetUrlKey);
      if (existing) {
        Object.assign(existing, project, { updatedAt: now });
        return { ...existing };
      }
      const row = assignId({ ...project, createdAt: now, updatedAt: now });
      projects.push(row);
      return { ...row };
    },
    async getProject(id) {
      const row = projects.find((item) => String(item.id) === String(id));
      return row ? { ...row } : null;
    },
    async deleteProject(id) {
      const index = projects.findIndex((item) => String(item.id) === String(id));
      if (index >= 0) projects.splice(index, 1);
      return index >= 0;
    },
    async upsertResourcePage(resource, now) {
      const existing = resourcePages.find((row) => row.sourceUrlKey && row.sourceUrlKey === resource.sourceUrlKey);
      if (existing) {
        const discovery = JSON.stringify(Array.from(new Set([
          ...parseJsonArray(existing.discoveryTargetUrlsJson),
          ...parseJsonArray(resource.discoveryTargetUrlsJson)
        ])));
        Object.assign(existing, resource, {
          discoveryTargetUrlsJson: discovery,
          firstDiscoveryTargetUrl: existing.firstDiscoveryTargetUrl || resource.firstDiscoveryTargetUrl,
          updatedAt: now
        });
        return { ...existing };
      }
      const row = assignId({ ...resource, createdAt: now, updatedAt: now });
      resourcePages.push(row);
      return { ...row };
    },
    async patchResourcePage(id, patch, now) {
      const row = resourcePages.find((item) => String(item.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: now });
      return { ...row };
    },
    async deleteResourcePage(id) {
      const index = resourcePages.findIndex((item) => String(item.id) === String(id));
      if (index < 0) return false;
      const [row] = resourcePages.splice(index, 1);
      for (let i = verifiedBacklinks.length - 1; i >= 0; i--) {
        if (String(verifiedBacklinks[i].resourcePageId) === String(row.id)) verifiedBacklinks.splice(i, 1);
      }
      return true;
    },
    async saveSubmission(submission, now) {
      const row = assignId({ ...submission, createdAt: now, updatedAt: now });
      submissions.push(row);
      return { ...row };
    },
    async getSubmission(id) {
      const row = submissions.find((item) => String(item.id) === String(id));
      return row ? { ...row } : null;
    },
    async updateSubmissionBacklinkCheck(id, patch, now) {
      const row = submissions.find((item) => String(item.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: now });
      return { ...row };
    },
    async upsertVerifiedBacklink(input, now) {
      const existing = verifiedBacklinks.find((row) =>
        String(row.sourceUrlKey) === String(input.sourceUrlKey) &&
        String(row.promotionProjectId) === String(input.promotionProjectId)
      );
      if (existing) {
        Object.assign(existing, input, {
          firstVerifiedAt: existing.firstVerifiedAt || input.firstVerifiedAt || now,
          lastVerifiedAt: input.lastVerifiedAt || now,
          updatedAt: now
        });
        return { ...existing };
      }
      const row = assignId({
        ...input,
        firstVerifiedAt: input.firstVerifiedAt || now,
        lastVerifiedAt: input.lastVerifiedAt || now,
        createdAt: now,
        updatedAt: now
      });
      verifiedBacklinks.push(row);
      return { ...row };
    },
    async listResources() {
      return verifiedBacklinks.map((verified) => {
        const resource = resourcePages.find((row) => String(row.id) === String(verified.resourcePageId)) || {};
        const project = projects.find((row) => String(row.id) === String(verified.promotionProjectId)) || {};
        return {
          ...resource,
          verifiedBacklinkId: verified.id,
          promotionProjectId: verified.promotionProjectId,
          targetUrl: verified.targetUrl || project.targetUrl,
          targetDomain: verified.targetDomain || project.targetDomain,
          targetDomainAuthority: verified.targetDomainAuthority,
          targetDomainTraffic: verified.targetDomainTraffic,
          firstVerifiedAt: verified.firstVerifiedAt,
          lastVerifiedAt: verified.lastVerifiedAt,
          backlinkStatus: verified.backlinkStatus,
          matchedHref: verified.matchedHref,
          keywordsJson: project.keywordsJson || '[]',
          pageTitle: project.pageTitle,
          metaDescription: project.metaDescription,
          h1: project.h1
        };
      }).map(shapeResourceRow);
    }
  };
}

function createMysqlLinkAssistantStore(db = database) {
  let tablesReadyPromise = null;
  async function ensureColumn(table, column, definition) {
    const existing = await db.queryOne(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [table, column]
    );
    if (existing) return;
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, []);
    console.info('[link-assistant] column added', { table, column });
  }

  async function hasColumn(table, column) {
    const existing = await db.queryOne(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [table, column]
    );
    return !!existing;
  }

  async function dropForeignKeysForColumn(table, column) {
    const keys = await db.query(`
      SELECT CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [table, column]);
    for (const key of keys || []) {
      const name = key && key.CONSTRAINT_NAME ? String(key.CONSTRAINT_NAME) : '';
      if (!name) continue;
      try {
        await db.execute(`ALTER TABLE ${table} DROP FOREIGN KEY ${name}`, []);
        console.info('[link-assistant] foreign key dropped', { table, column, name });
      } catch (error) {
        console.warn('[link-assistant] foreign key drop skipped', {
          table,
          column,
          name,
          message: safeError(error)
        });
      }
    }
  }

  async function ensureMysqlMigrations() {
    await ensureColumn('link_promotion_projects', 'target_url', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'target_url_key', 'VARCHAR(768) DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'target_domain', "VARCHAR(255) DEFAULT ''");
    await ensureColumn('link_promotion_projects', 'keywords_json', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'page_title', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'meta_description', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'h1', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'comment_author', "VARCHAR(255) DEFAULT ''");
    await ensureColumn('link_promotion_projects', 'fetch_status', "VARCHAR(40) DEFAULT ''");
    await ensureColumn('link_promotion_projects', 'fetch_error', 'TEXT DEFAULT NULL');
    await ensureColumn('link_promotion_projects', 'fetched_at', "VARCHAR(40) DEFAULT ''");

    await ensureColumn('link_submission_records', 'resource_page_id', 'BIGINT UNSIGNED DEFAULT NULL');
    await ensureColumn('link_submission_records', 'target_url', 'TEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'target_domain', "VARCHAR(255) DEFAULT ''");
    await ensureColumn('link_submission_records', 'source_url_key', "VARCHAR(768) DEFAULT ''");
    await ensureColumn('link_submission_records', 'discovery_target_url', 'TEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'submit_result', "VARCHAR(60) DEFAULT ''");
    await ensureColumn('link_submission_records', 'ai_content', 'MEDIUMTEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'error_message', 'TEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'latest_backlink_status', "VARCHAR(60) DEFAULT ''");
    await ensureColumn('link_submission_records', 'latest_backlink_checked_at', "VARCHAR(40) DEFAULT ''");
    await ensureColumn('link_submission_records', 'latest_backlink_matched_href', 'TEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'latest_backlink_reason', 'TEXT DEFAULT NULL');
    await ensureColumn('link_submission_records', 'raw_payload', 'JSON DEFAULT NULL');
    await ensureColumn('resource_pages', 'semrush_headers_json', 'TEXT DEFAULT NULL');
    await ensureColumn('resource_pages', 'semrush_row_json', 'MEDIUMTEXT DEFAULT NULL');
    if (await hasColumn('link_submission_records', 'resource_id')) {
      await dropForeignKeysForColumn('link_submission_records', 'resource_id');
      await db.execute('ALTER TABLE link_submission_records MODIFY COLUMN resource_id BIGINT UNSIGNED DEFAULT NULL', []);
      console.info('[link-assistant] legacy submission resource_id relaxed', { table: 'link_submission_records' });
    }
  }

  return {
    async ensureTables() {
      if (tablesReadyPromise) return tablesReadyPromise;
      tablesReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS link_promotion_projects (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          target_url TEXT NOT NULL,
          target_url_key VARCHAR(768) NOT NULL,
          target_domain VARCHAR(255) DEFAULT '',
          keywords_json TEXT DEFAULT NULL,
          page_title TEXT DEFAULT NULL,
          meta_description TEXT DEFAULT NULL,
          h1 TEXT DEFAULT NULL,
          comment_author VARCHAR(255) DEFAULT '',
          contact_email VARCHAR(255) DEFAULT '',
          default_submit_mode VARCHAR(32) DEFAULT 'auto',
          fetch_status VARCHAR(40) DEFAULT '',
          fetch_error TEXT DEFAULT NULL,
          fetched_at VARCHAR(40) DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_link_projects_target (target_url_key(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `, []);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS resource_pages (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          source_url TEXT NOT NULL,
          source_url_key VARCHAR(768) NOT NULL,
          source_domain VARCHAR(255) DEFAULT '',
          first_discovery_target_url TEXT DEFAULT NULL,
          last_discovery_target_url TEXT DEFAULT NULL,
          discovery_target_urls_json TEXT DEFAULT NULL,
          source_title TEXT DEFAULT NULL,
          resource_type VARCHAR(60) DEFAULT '',
          quality_label VARCHAR(40) DEFAULT '',
          topic_tags_json TEXT DEFAULT NULL,
          notes TEXT DEFAULT NULL,
          page_ascore DECIMAL(10,2) DEFAULT NULL,
          external_links INT DEFAULT NULL,
          last_seen VARCHAR(80) DEFAULT '',
          semrush_headers_json TEXT DEFAULT NULL,
          semrush_row_json MEDIUMTEXT DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_resource_pages_source (source_url_key(191)),
          INDEX idx_resource_pages_domain (source_domain)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `, []);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS link_resources (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          source_url VARCHAR(512) NOT NULL,
          source_domain VARCHAR(255) NOT NULL,
          title VARCHAR(255) DEFAULT NULL,
          resource_type VARCHAR(64) DEFAULT NULL,
          quality_label VARCHAR(64) DEFAULT NULL,
          topic_tags JSON DEFAULT NULL,
          notes TEXT DEFAULT NULL,
          source_origin VARCHAR(64) DEFAULT NULL,
          deleted_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_link_resources_source_url (source_url),
          INDEX idx_link_resources_domain (source_domain)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `, []);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS link_submission_records (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          promotion_project_id BIGINT UNSIGNED DEFAULT NULL,
          resource_page_id BIGINT UNSIGNED DEFAULT NULL,
          target_url TEXT DEFAULT NULL,
          target_domain VARCHAR(255) DEFAULT '',
          source_url TEXT DEFAULT NULL,
          source_url_key VARCHAR(768) DEFAULT '',
          source_domain VARCHAR(255) DEFAULT '',
          discovery_target_url TEXT DEFAULT NULL,
          submit_result VARCHAR(60) DEFAULT '',
          ai_content MEDIUMTEXT DEFAULT NULL,
          error_message TEXT DEFAULT NULL,
          latest_backlink_status VARCHAR(60) DEFAULT '',
          latest_backlink_checked_at VARCHAR(40) DEFAULT '',
          latest_backlink_matched_href TEXT DEFAULT NULL,
          latest_backlink_reason TEXT DEFAULT NULL,
          raw_payload JSON DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_link_submission_project (promotion_project_id),
          INDEX idx_link_submission_source (source_url_key(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `, []);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS verified_backlinks (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          resource_page_id BIGINT UNSIGNED NOT NULL,
          promotion_project_id BIGINT UNSIGNED NOT NULL,
          source_url_key VARCHAR(768) NOT NULL,
          target_url TEXT NOT NULL,
          target_url_key VARCHAR(768) NOT NULL,
          target_domain VARCHAR(255) DEFAULT '',
          target_domain_authority DECIMAL(12,2) DEFAULT NULL,
          target_domain_traffic BIGINT DEFAULT NULL,
          discovery_target_url TEXT DEFAULT NULL,
          matched_href TEXT DEFAULT NULL,
          backlink_status VARCHAR(60) DEFAULT 'success',
          first_verified_at VARCHAR(40) DEFAULT '',
          last_verified_at VARCHAR(40) DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_verified_source_project (source_url_key(191), promotion_project_id),
          INDEX idx_verified_project (promotion_project_id),
          INDEX idx_verified_resource (resource_page_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `, []);
      await ensureMysqlMigrations();
      console.info('[link-assistant] tables ready');
      })().catch((error) => {
        tablesReadyPromise = null;
        throw error;
      });
      return tablesReadyPromise;
    },
    async listProjects() {
      const rows = await db.query('SELECT * FROM link_promotion_projects ORDER BY updated_at DESC', []);
      return rows.map(shapeProjectRow);
    },
    async saveProject(project) {
      await db.execute(`
        INSERT INTO link_promotion_projects (
          name, website_url, product_name, product_description, topic_tags,
          target_url, target_url_key, target_domain, keywords_json, page_title, meta_description, h1,
          comment_author, contact_email, default_submit_mode, fetch_status, fetch_error, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          website_url = VALUES(website_url),
          product_name = VALUES(product_name),
          product_description = VALUES(product_description),
          topic_tags = VALUES(topic_tags),
          target_url = VALUES(target_url),
          target_domain = VALUES(target_domain),
          keywords_json = VALUES(keywords_json),
          page_title = VALUES(page_title),
          meta_description = VALUES(meta_description),
          h1 = VALUES(h1),
          comment_author = VALUES(comment_author),
          contact_email = VALUES(contact_email),
          default_submit_mode = VALUES(default_submit_mode),
          fetch_status = VALUES(fetch_status),
          fetch_error = VALUES(fetch_error),
          fetched_at = VALUES(fetched_at),
          updated_at = CURRENT_TIMESTAMP
      `, [
        project.pageTitle || project.targetDomain || project.targetUrl,
        project.targetUrl,
        project.pageTitle || project.targetDomain || '',
        project.metaDescription || '',
        project.keywordsJson,
        project.targetUrl,
        project.targetUrlKey,
        project.targetDomain,
        project.keywordsJson,
        project.pageTitle,
        project.metaDescription,
        project.h1,
        project.commentAuthor,
        project.contactEmail,
        project.defaultSubmitMode,
        project.fetchStatus,
        project.fetchError,
        project.fetchedAt
      ]);
      return shapeProjectRow(await db.queryOne('SELECT * FROM link_promotion_projects WHERE website_url = ? OR target_url_key = ?', [project.targetUrl, project.targetUrlKey]));
    },
    async getProject(id) {
      return shapeProjectRow(await db.queryOne('SELECT * FROM link_promotion_projects WHERE id = ?', [id]));
    },
    async deleteProject(id) {
      const result = await db.execute('DELETE FROM link_promotion_projects WHERE id = ?', [id]);
      return result.affectedRows > 0;
    },
    async upsertResourcePage(resource) {
      await db.execute(`
        INSERT INTO resource_pages (
          source_url, source_url_key, source_domain, first_discovery_target_url, last_discovery_target_url,
          discovery_target_urls_json, source_title, resource_type, quality_label, topic_tags_json,
          notes, page_ascore, external_links, last_seen, semrush_headers_json, semrush_row_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          source_url = VALUES(source_url),
          source_domain = VALUES(source_domain),
          last_discovery_target_url = VALUES(last_discovery_target_url),
          discovery_target_urls_json = VALUES(discovery_target_urls_json),
          source_title = IF(VALUES(source_title) = '', source_title, VALUES(source_title)),
          resource_type = IF(VALUES(resource_type) = '', resource_type, VALUES(resource_type)),
          quality_label = IF(VALUES(quality_label) = '', quality_label, VALUES(quality_label)),
          topic_tags_json = IF(VALUES(topic_tags_json) = '[]', topic_tags_json, VALUES(topic_tags_json)),
          notes = IF(VALUES(notes) = '', notes, VALUES(notes)),
          page_ascore = COALESCE(VALUES(page_ascore), page_ascore),
          external_links = COALESCE(VALUES(external_links), external_links),
          last_seen = IF(VALUES(last_seen) = '', last_seen, VALUES(last_seen)),
          semrush_headers_json = IF(VALUES(semrush_headers_json) = '[]', semrush_headers_json, VALUES(semrush_headers_json)),
          semrush_row_json = IF(VALUES(semrush_row_json) = '[]', semrush_row_json, VALUES(semrush_row_json)),
          updated_at = CURRENT_TIMESTAMP
      `, [
        resource.sourceUrl,
        resource.sourceUrlKey,
        resource.sourceDomain,
        resource.firstDiscoveryTargetUrl,
        resource.lastDiscoveryTargetUrl,
        resource.discoveryTargetUrlsJson,
        resource.sourceTitle,
        resource.resourceType,
        resource.qualityLabel,
        resource.topicTagsJson,
        resource.notes,
        resource.pageAscore,
        resource.externalLinks,
        resource.lastSeen,
        resource.semrushHeadersJson,
        resource.semrushRowJson
      ]);
      return shapeResourceRow(await db.queryOne('SELECT * FROM resource_pages WHERE source_url_key = ?', [resource.sourceUrlKey]));
    },
    async patchResourcePage(id, patch) {
      const fields = [];
      const params = [];
      const map = {
        resourceType: 'resource_type',
        qualityLabel: 'quality_label',
        topicTagsJson: 'topic_tags_json',
        notes: 'notes',
        sourceTitle: 'source_title'
      };
      for (const [key, column] of Object.entries(map)) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          fields.push(`${column} = ?`);
          params.push(patch[key]);
        }
      }
      if (!fields.length) return shapeResourceRow(await db.queryOne('SELECT * FROM resource_pages WHERE id = ?', [id]));
      params.push(id);
      await db.execute(`UPDATE resource_pages SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
      return shapeResourceRow(await db.queryOne('SELECT * FROM resource_pages WHERE id = ?', [id]));
    },
    async deleteResourcePage(id) {
      await db.execute('DELETE FROM verified_backlinks WHERE resource_page_id = ?', [id]);
      const result = await db.execute('DELETE FROM resource_pages WHERE id = ?', [id]);
      return result.affectedRows > 0;
    },
    async saveSubmission(submission) {
      const existingSubmission = await db.queryOne(
        `
          SELECT *
          FROM link_submission_records
          WHERE source_url_key = ?
            AND promotion_project_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
        [submission.sourceUrlKey, submission.promotionProjectId]
      );
      if (existingSubmission && existingSubmission.id) {
        await db.execute(`
          UPDATE link_submission_records
          SET resource_page_id = ?,
            target_url = ?,
            target_domain = ?,
            source_url = ?,
            source_url_key = ?,
            source_domain = ?,
            discovery_target_url = ?,
            submit_result = ?,
            ai_content = ?,
            error_message = ?,
            raw_payload = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          submission.resourcePageId || null,
          submission.targetUrl,
          submission.targetDomain,
          submission.sourceUrl,
          submission.sourceUrlKey,
          submission.sourceDomain,
          submission.discoveryTargetUrl,
          submission.submitResult,
          submission.aiContent,
          submission.errorMessage,
          JSON.stringify(submission.rawPayload || {}),
          existingSubmission.id
        ]);
        return this.getSubmission(existingSubmission.id);
      }
      const result = await db.execute(`
        INSERT INTO link_submission_records (
          resource_id, source_url, source_domain, promotion_project_id, attempt_no, submit_mode, result,
          resource_page_id, target_url, target_domain, source_url_key, discovery_target_url,
          submit_result, ai_content, error_message, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        null,
        submission.sourceUrl,
        submission.sourceDomain,
        submission.promotionProjectId,
        1,
        'auto',
        submission.submitResult || '',
        submission.resourcePageId || null,
        submission.targetUrl,
        submission.targetDomain,
        submission.sourceUrlKey,
        submission.discoveryTargetUrl,
        submission.submitResult,
        submission.aiContent,
        submission.errorMessage,
        JSON.stringify(submission.rawPayload || {})
      ]);
      return this.getSubmission(result.insertId);
    },
    async getSubmission(id) {
      return await db.queryOne('SELECT * FROM link_submission_records WHERE id = ?', [id]);
    },
    async updateSubmissionBacklinkCheck(id, patch) {
      await db.execute(`
        UPDATE link_submission_records
        SET latest_backlink_status = ?,
          latest_backlink_checked_at = ?,
          latest_backlink_matched_href = ?,
          latest_backlink_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        patch.latestBacklinkStatus,
        patch.latestBacklinkCheckedAt,
        patch.latestBacklinkMatchedHref,
        patch.latestBacklinkReason,
        id
      ]);
      return this.getSubmission(id);
    },
    async upsertVerifiedBacklink(input) {
      await db.execute(`
        INSERT INTO verified_backlinks (
          resource_page_id, promotion_project_id, source_url_key, target_url, target_url_key, target_domain,
          target_domain_authority, target_domain_traffic, discovery_target_url, matched_href, backlink_status,
          first_verified_at, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          resource_page_id = VALUES(resource_page_id),
          target_url = VALUES(target_url),
          target_url_key = VALUES(target_url_key),
          target_domain = VALUES(target_domain),
          target_domain_authority = VALUES(target_domain_authority),
          target_domain_traffic = VALUES(target_domain_traffic),
          discovery_target_url = VALUES(discovery_target_url),
          matched_href = VALUES(matched_href),
          backlink_status = VALUES(backlink_status),
          last_verified_at = VALUES(last_verified_at),
          updated_at = CURRENT_TIMESTAMP
      `, [
        input.resourcePageId,
        input.promotionProjectId,
        input.sourceUrlKey,
        input.targetUrl,
        input.targetUrlKey,
        input.targetDomain,
        input.targetDomainAuthority,
        input.targetDomainTraffic,
        input.discoveryTargetUrl,
        input.matchedHref,
        input.backlinkStatus,
        toMysqlDateTime(input.firstVerifiedAt),
        toMysqlDateTime(input.lastVerifiedAt)
      ]);
      return await db.queryOne(
        'SELECT * FROM verified_backlinks WHERE source_url_key = ? AND promotion_project_id = ?',
        [input.sourceUrlKey, input.promotionProjectId]
      );
    },
    async listResources() {
      const rows = await db.query(`
        SELECT
          rp.*,
          vb.id AS verified_backlink_id,
          vb.promotion_project_id,
          vb.target_url,
          vb.target_domain,
          vb.target_domain_authority,
          vb.target_domain_traffic,
          vb.first_verified_at,
          vb.last_verified_at,
          vb.backlink_status,
          vb.matched_href,
          pp.keywords_json,
          pp.page_title,
          pp.meta_description,
          pp.h1
        FROM verified_backlinks vb
        JOIN resource_pages rp ON rp.id = vb.resource_page_id
        LEFT JOIN link_promotion_projects pp ON pp.id = vb.promotion_project_id
        ORDER BY vb.last_verified_at DESC, rp.updated_at DESC
      `, []);
      return rows.map(shapeResourceRow);
    }
  };
}

function createLinkAssistantService(options = {}) {
  const store = options.store || createMysqlLinkAssistantStore(options.db);
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch;

  function currentIso() {
    return toIsoString(now());
  }

  async function savePromotionProject(input) {
    const project = normalizePromotionProject(input);
    if (!project.targetUrl || !project.targetUrlKey) {
      const error = new Error('targetUrl is required');
      error.statusCode = 400;
      throw error;
    }
    const saved = await store.saveProject(project, currentIso());
    console.info('[link-assistant] project saved', {
      projectId: saved && saved.id,
      targetDomain: saved && saved.targetDomain
    });
    return shapeProjectRow(saved);
  }

  async function fetchPromotionMetadata(input) {
    const source = input && typeof input === 'object' ? input : {};
    const target = normalizePromotionProject({ targetUrl: source.targetUrl || source.target_url || source.websiteUrl || source.website_url });
    const fetchedAt = currentIso();
    const startedAt = Date.now();

    if (!target.targetUrlKey) {
      console.warn('[link-assistant][metadata] invalid target url', {
        targetHost: safeLogHost(source.targetUrl || source.target_url || source.websiteUrl || source.website_url),
        error: 'invalid_url'
      });
      return {
        targetUrl: safeText(source.targetUrl || source.target_url || source.websiteUrl || source.website_url),
        targetDomain: '',
        keywords: [],
        pageTitle: '',
        metaDescription: '',
        h1: '',
        fetchStatus: 'error',
        fetchError: target.targetUrl ? 'invalid_url' : 'empty_url',
        fetchedAt
      };
    }

    console.info('[link-assistant][metadata] fetch start', {
      targetDomain: target.targetDomain,
      timeoutMs: METADATA_FETCH_TIMEOUT_MS
    });

    try {
      const fetched = await fetchHtmlWithTimeout(target.targetUrl, {
        fetchImpl,
        timeoutMs: source.timeoutMs
      });
      const metadata = {
        ...extractPromotionMetadataFromHtml(fetched.html, target),
        fetchStatus: 'success',
        fetchError: '',
        fetchedAt
      };
      console.info('[link-assistant][metadata] fetch done', {
        targetDomain: target.targetDomain,
        status: fetched.status,
        contentType: fetched.contentType.slice(0, 80),
        durationMs: Date.now() - startedAt,
        hasKeywords: metadata.keywords.length > 0,
        hasTitle: !!metadata.pageTitle,
        hasDescription: !!metadata.metaDescription,
        hasH1: !!metadata.h1
      });
      return metadata;
    } catch (error) {
      const fetchError = error && error.name === 'AbortError' ? 'metadata_fetch_timeout' : safeError(error);
      console.warn('[link-assistant][metadata] fetch failed', {
        targetDomain: target.targetDomain,
        durationMs: Date.now() - startedAt,
        error: fetchError
      });
      return {
        targetUrl: target.targetUrl,
        targetDomain: target.targetDomain,
        keywords: [],
        pageTitle: '',
        metaDescription: '',
        h1: '',
        fetchStatus: 'error',
        fetchError,
        fetchedAt
      };
    }
  }

  async function ensurePromotionProject(input) {
    const id = normalizeId(input && (input.promotionProjectId || input.promotion_project_id));
    if (id) {
      const project = await store.getProject(id);
      if (project) return shapeProjectRow(project);
    }
    return savePromotionProject({
      targetUrl: input && (input.targetUrl || input.target_url || input.promotionWebsiteUrl),
      keywords: input && input.keywords
    });
  }

  async function saveSubmission(input) {
    const source = input && typeof input === 'object' ? input : {};
    const project = await ensurePromotionProject(source);
    const resource = shapeResourcePage({
      ...source,
      sourceUrl: source.sourceUrl || source.source_url || source.url,
      targetUrl: source.discoveryTargetUrl || source.discovery_target_url || source.targetUrl || project.targetUrl
    });
    if (!resource.sourceUrl || !resource.sourceUrlKey) {
      const error = new Error('sourceUrl is required');
      error.statusCode = 400;
      throw error;
    }
    const resourcePageId = normalizeId(source.resourcePageId || source.resource_page_id);
    const submission = await store.saveSubmission({
      promotionProjectId: project.id,
      resourcePageId,
      targetUrl: project.targetUrl,
      targetDomain: project.targetDomain,
      sourceUrl: resource.sourceUrl,
      sourceUrlKey: resource.sourceUrlKey,
      sourceDomain: resource.sourceDomain,
      discoveryTargetUrl: resource.firstDiscoveryTargetUrl || source.discoveryTargetUrl || '',
      submitResult: safeText(source.submitResult || source.result),
      aiContent: source.aiContent == null ? null : String(source.aiContent),
      errorMessage: source.errorMessage == null ? null : String(source.errorMessage),
      rawPayload: source
    }, currentIso());
    console.info('[link-assistant] submission saved', {
      submissionId: submission && submission.id,
      projectId: project.id,
      targetDomain: project.targetDomain,
      sourceDomain: resource.sourceDomain,
      result: safeText(source.submitResult || source.result),
      hasTargetUrl: !!project.targetUrl,
      hasSourceUrl: !!resource.sourceUrl
    });
    return {
      id: submission.id,
      submissionId: submission.id,
      promotionProjectId: project.id,
      resourcePageId,
      sourceUrl: resource.sourceUrl,
      sourceDomain: resource.sourceDomain
    };
  }

  function buildRecoveredSubmissionInput(source) {
    const sourceUrl = safeText(rowValue(source, 'sourceUrl', 'source_url', 'url'));
    const targetUrl = safeText(rowValue(
      source,
      'targetUrl',
      'target_url',
      'promotionWebsiteUrl',
      'promotion_website_url',
      'latestBacklinkMatchedHref',
      'latest_backlink_matched_href'
    ));
    if (!sourceUrl || !targetUrl) return null;
    return {
      promotionProjectId: rowValue(source, 'promotionProjectId', 'promotion_project_id') || null,
      targetUrl,
      sourceUrl,
      sourceDomain: safeText(rowValue(source, 'sourceDomain', 'source_domain')),
      sourceTitle: safeText(rowValue(source, 'sourceTitle', 'source_title')),
      discoveryTargetUrl: safeText(rowValue(source, 'discoveryTargetUrl', 'discovery_target_url')),
      resourceType: safeText(rowValue(source, 'resourceType', 'resource_type')) || 'blog_comment',
      submitResult: safeText(rowValue(source, 'submitResult', 'submit_result', 'result')) || 'success',
      aiContent: source.aiContent == null ? null : String(source.aiContent),
      errorMessage: source.errorMessage == null ? null : String(source.errorMessage),
      semrushMeta: source.semrushMeta || source.semrush_meta || null,
      semrushHeaders: source.semrushHeaders || source.semrush_headers || null,
      semrushRow: source.semrushRow || source.semrush_row || null
    };
  }

  async function recoverMissingSubmissionForBacklinkCheck(source, requestedSubmissionId) {
    const fallback = buildRecoveredSubmissionInput(source);
    if (!fallback) return null;
    const saved = await saveSubmission(fallback);
    const recoveredId = saved && (saved.id || saved.submissionId);
    const recovered = recoveredId ? await store.getSubmission(recoveredId) : null;
    console.warn('[link-assistant] recovered missing submission for backlink check', {
      requestedSubmissionId,
      recoveredSubmissionId: recoveredId || null,
      sourceDomain: fallback.sourceDomain || shapeResourcePage(fallback).sourceDomain,
      targetDomain: normalizePromotionProject({ targetUrl: fallback.targetUrl }).targetDomain
    });
    return recovered || saved || null;
  }

  async function saveBacklinkCheckResult(input) {
    const source = input && typeof input === 'object' ? input : {};
    const submissionId = normalizeId(source.submissionId || source.submission_id);
    if (!submissionId) {
      const error = new Error('submissionId is required');
      error.statusCode = 400;
      throw error;
    }
    console.info('[link-assistant] backlink check result received', {
      requestedSubmissionId: submissionId,
      promotionProjectId: rowValue(source, 'promotionProjectId', 'promotion_project_id') || null,
      sourceDomain: shapeResourcePage({ sourceUrl: rowValue(source, 'sourceUrl', 'source_url', 'url') }).sourceDomain,
      targetDomain: normalizePromotionProject({
        targetUrl: rowValue(source, 'targetUrl', 'target_url', 'promotionWebsiteUrl', 'promotion_website_url', 'latestBacklinkMatchedHref', 'latest_backlink_matched_href')
      }).targetDomain,
      status: safeText(source.latestBacklinkStatus || source.latest_backlink_status),
      pageAscore: rowValue(source, 'pageAscore', 'page_ascore') || null
    });
    let effectiveSubmissionId = submissionId;
    let submission = await store.getSubmission(submissionId);
    if (!submission) {
      submission = await recoverMissingSubmissionForBacklinkCheck(source, submissionId);
      effectiveSubmissionId = submission && rowValue(submission, 'id') ? rowValue(submission, 'id') : effectiveSubmissionId;
      if (!submission) {
        const error = new Error('submission not found');
        error.statusCode = 404;
        throw error;
      }
    }

    const status = safeText(source.latestBacklinkStatus || source.latest_backlink_status);
    const checkedAt = safeText(source.latestBacklinkCheckedAt || source.latest_backlink_checked_at) || currentIso();
    const patch = {
      latestBacklinkStatus: status,
      latestBacklinkCheckedAt: checkedAt,
      latestBacklinkMatchedHref: safeText(source.latestBacklinkMatchedHref || source.latest_backlink_matched_href),
      latestBacklinkReason: safeText(source.latestBacklinkReason || source.latest_backlink_reason)
    };
    await store.updateSubmissionBacklinkCheck(effectiveSubmissionId, patch, currentIso());

    if (status !== 'success') {
      console.info('[link-assistant] backlink check recorded without resource sync', {
        submissionId: effectiveSubmissionId,
        status
      });
      return { submissionId: effectiveSubmissionId, syncedToResourceLibrary: false };
    }

    const rawPayload = parseJsonObject(rowValue(submission, 'rawPayload', 'raw_payload'));
    const sourceSemrushMeta = parseJsonObject(source.semrushMeta || source.semrush_meta);
    const submissionSemrushMeta = parseJsonObject(rawPayload.semrushMeta || rawPayload.semrush_meta);
    const resource = await store.upsertResourcePage(shapeResourcePage({
      sourceUrl: rowValue(submission, 'sourceUrl', 'source_url'),
      sourceTitle: firstPresent(
        rowValue(source, 'sourceTitle', 'source_title'),
        rowValue(submission, 'sourceTitle', 'source_title'),
        rowValue(rawPayload, 'sourceTitle', 'source_title'),
        rowValue(sourceSemrushMeta, 'sourceTitle', 'source_title'),
        rowValue(submissionSemrushMeta, 'sourceTitle', 'source_title')
      ),
      resourceType: 'blog_comment',
      discoveryTargetUrl: firstPresent(
        rowValue(source, 'discoveryTargetUrl', 'discovery_target_url'),
        rowValue(submission, 'discoveryTargetUrl', 'discovery_target_url'),
        rowValue(rawPayload, 'discoveryTargetUrl', 'discovery_target_url'),
        rowValue(sourceSemrushMeta, 'targetUrl', 'target_url'),
        rowValue(submissionSemrushMeta, 'targetUrl', 'target_url')
      ),
      pageAscore: firstPresent(
        rowValue(source, 'pageAscore', 'page_ascore'),
        rowValue(rawPayload, 'pageAscore', 'page_ascore'),
        rowValue(sourceSemrushMeta, 'pageAscore', 'page_ascore'),
        rowValue(submissionSemrushMeta, 'pageAscore', 'page_ascore')
      ),
      externalLinks: firstPresent(
        rowValue(source, 'externalLinks', 'external_links'),
        rowValue(rawPayload, 'externalLinks', 'external_links'),
        rowValue(sourceSemrushMeta, 'externalLinks', 'external_links'),
        rowValue(submissionSemrushMeta, 'externalLinks', 'external_links')
      ),
      lastSeen: firstPresent(
        rowValue(source, 'lastSeen', 'last_seen'),
        rowValue(rawPayload, 'lastSeen', 'last_seen'),
        rowValue(sourceSemrushMeta, 'lastSeen', 'last_seen'),
        rowValue(submissionSemrushMeta, 'lastSeen', 'last_seen')
      ),
      semrushHeaders: firstPresent(
        rowValue(source, 'semrushHeaders', 'semrush_headers'),
        rowValue(rawPayload, 'semrushHeaders', 'semrush_headers'),
        rowValue(sourceSemrushMeta, 'semrushHeaders', 'semrush_headers'),
        rowValue(submissionSemrushMeta, 'semrushHeaders', 'semrush_headers')
      ),
      semrushRow: firstPresent(
        rowValue(source, 'semrushRow', 'semrush_row'),
        rowValue(rawPayload, 'semrushRow', 'semrush_row'),
        rowValue(sourceSemrushMeta, 'semrushRow', 'semrush_row'),
        rowValue(submissionSemrushMeta, 'semrushRow', 'semrush_row')
      )
    }), currentIso());
    const project = await store.getProject(rowValue(submission, 'promotionProjectId', 'promotion_project_id'));
    const target = normalizePromotionProject({
      targetUrl: rowValue(submission, 'targetUrl', 'target_url') || (project && project.targetUrl)
    });
    const verified = await store.upsertVerifiedBacklink({
      resourcePageId: resource.id,
      promotionProjectId: rowValue(submission, 'promotionProjectId', 'promotion_project_id'),
      sourceUrlKey: resource.sourceUrlKey,
      targetUrl: target.targetUrl,
      targetUrlKey: target.targetUrlKey,
      targetDomain: target.targetDomain,
      targetDomainAuthority: null,
      targetDomainTraffic: null,
      discoveryTargetUrl: rowValue(submission, 'discoveryTargetUrl', 'discovery_target_url'),
      matchedHref: patch.latestBacklinkMatchedHref,
      backlinkStatus: 'success',
      firstVerifiedAt: checkedAt,
      lastVerifiedAt: checkedAt
    }, currentIso());
    console.info('[link-assistant] backlink check synced to resource library', {
      submissionId: effectiveSubmissionId,
      resourcePageId: resource.id,
      verifiedBacklinkId: verified && verified.id,
      promotionProjectId: rowValue(submission, 'promotionProjectId', 'promotion_project_id'),
      sourceDomain: resource.sourceDomain,
      targetDomain: target.targetDomain,
      pageAscore: resource.pageAscore || null
    });
    return { submissionId: effectiveSubmissionId, syncedToResourceLibrary: true, resource, verifiedBacklink: verified };
  }

  async function listResources() {
    return store.listResources();
  }

  return {
    ensureTables: () => store.ensureTables(),
    listProjects: () => store.listProjects(),
    fetchPromotionMetadata,
    savePromotionProject,
    saveSubmission,
    saveBacklinkCheckResult,
    listResources,
    patchResource: async (id, patch) => {
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'resourceType')) payload.resourceType = safeText(patch.resourceType);
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'qualityLabel')) payload.qualityLabel = safeText(patch.qualityLabel);
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'topicTags')) payload.topicTagsJson = JSON.stringify(Array.isArray(patch.topicTags) ? patch.topicTags : []);
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'notes')) payload.notes = safeText(patch.notes);
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'sourceTitle')) payload.sourceTitle = safeText(patch.sourceTitle);
      return store.patchResourcePage(id, payload, currentIso());
    },
    deleteResource: (id) => store.deleteResourcePage(id),
    deleteProject: (id) => store.deleteProject(id)
  };
}

function createRouter(service = createLinkAssistantService()) {
  const router = express.Router();

  async function handle(handler, req, res) {
    try {
      await service.ensureTables();
      await handler(req, res);
    } catch (error) {
      const status = error && error.statusCode ? error.statusCode : 500;
      console.error('[link-assistant] request failed:', {
        path: req.path,
        method: req.method,
        status,
        error: safeError(error)
      });
      res.status(status).json({
        success: false,
        error: status === 500 ? 'LINK_ASSISTANT_FAILED' : safeError(error),
        message: safeError(error)
      });
    }
  }

  router.get('/link-assistant/projects', (req, res) => handle(async () => {
    res.json({ success: true, projects: await service.listProjects() });
  }, req, res));

  router.post('/link-assistant/projects', (req, res) => handle(async () => {
    const project = await service.savePromotionProject(req.body || {});
    res.status(200).json({ success: true, project });
  }, req, res));

  router.patch('/link-assistant/projects/:id', (req, res) => handle(async () => {
    const project = await service.savePromotionProject({ ...(req.body || {}), id: req.params.id });
    res.status(200).json({ success: true, project });
  }, req, res));

  router.delete('/link-assistant/projects/:id', (req, res) => handle(async () => {
    await service.deleteProject(req.params.id);
    res.status(200).json({ success: true });
  }, req, res));

  router.post('/link-assistant/projects/fetch-metadata', (req, res) => handle(async () => {
    const metadata = await service.fetchPromotionMetadata(req.body || {});
    res.status(200).json({ success: true, metadata });
  }, req, res));

  router.post('/link-assistant/submissions', (req, res) => handle(async () => {
    const submission = await service.saveSubmission(req.body || {});
    res.status(200).json({ success: true, ...submission });
  }, req, res));

  router.post('/link-assistant/submissions/:id/backlink-check-result', (req, res) => handle(async () => {
    const result = await service.saveBacklinkCheckResult({ ...(req.body || {}), submissionId: req.params.id });
    res.status(200).json({ success: true, ...result });
  }, req, res));

  router.get('/link-assistant/resources', (req, res) => handle(async () => {
    const rows = filterResourceRowsForQuery(await service.listResources(), req.query || {});
    res.status(200).json({ success: true, resources: rows });
  }, req, res));

  router.patch('/link-assistant/resources/:id', (req, res) => handle(async () => {
    const resource = await service.patchResource(req.params.id, req.body || {});
    if (!resource) {
      res.status(404).json({ success: false, error: 'RESOURCE_NOT_FOUND' });
      return;
    }
    res.status(200).json({ success: true, resource: shapeResourceRow(resource) });
  }, req, res));

  router.delete('/link-assistant/resources/:id', (req, res) => handle(async () => {
    await service.deleteResource(req.params.id);
    res.status(200).json({ success: true });
  }, req, res));

  router.get('/link-assistant/export.csv', (req, res) => handle(async () => {
    const rows = filterResourceRowsForQuery(await service.listResources(), req.query || {});
    const format = safeText(req.query.format) === 'management' ? 'management' : 'semrush';
    const exportPayload = format === 'management'
      ? buildManagementResourceCsv({ rows })
      : buildSemrushCompatibleResourceCsv({ rows, selectedDiscoveryTargetUrl: req.query.discoveryTargetUrl });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportPayload.filename}"`);
    res.status(200).send(exportPayload.content);
  }, req, res));

  router.ensureTables = service.ensureTables;
  return router;
}

const defaultRouter = createRouter();
defaultRouter.createRouter = createRouter;
defaultRouter.createMemoryLinkAssistantStore = createMemoryLinkAssistantStore;
defaultRouter.createMysqlLinkAssistantStore = createMysqlLinkAssistantStore;
defaultRouter.createLinkAssistantService = createLinkAssistantService;
defaultRouter.filterResourceRowsForQuery = filterResourceRowsForQuery;
defaultRouter.shapeResourceRow = shapeResourceRow;
defaultRouter.toMysqlDateTime = toMysqlDateTime;

module.exports = defaultRouter;
