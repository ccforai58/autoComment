(function initResourceLibrary(root) {
  'use strict';

  const DEFAULT_API_BASE = 'http://127.0.0.1:3000/api';
  const state = {
    resources: [],
    projects: [],
    savingIds: new Set(),
    pagination: {
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 0
    },
    sort: {
      sortBy: '',
      sortDir: 'desc'
    }
  };

  const RESOURCE_TYPE_OPTIONS = [
    ['', '未分类'],
    ['blog_comment', '博客评论'],
    ['directory', '目录站'],
    ['media_article', '媒体文章'],
    ['community_forum', '社区论坛'],
    ['resource_page', '资源页'],
    ['other', '其他']
  ];

  const QUALITY_OPTIONS = [
    ['', '未评级'],
    ['excellent', '优秀'],
    ['good', '良好'],
    ['ok', '一般'],
    ['low', '偏低']
  ];

  const SUBMIT_SOURCE_FILTER_OPTIONS = [
    ['', '全部提交来源'],
    ['manual_assistant', '手动助手'],
    ['batch_auto', '批量自动'],
    ['other', '其他/未标记']
  ];

  function getApiBase() {
    if (root.AUTO_COMMENT_CONFIG && root.AUTO_COMMENT_CONFIG.API_BASE) {
      return String(root.AUTO_COMMENT_CONFIG.API_BASE).replace(/\/+$/, '');
    }
    if (root.AUTO_COMMENT_API_BASE) {
      return String(root.AUTO_COMMENT_API_BASE).replace(/\/+$/, '');
    }
    return DEFAULT_API_BASE;
  }

  function getEl(id) {
    return typeof document === 'undefined' ? null : document.getElementById(id);
  }

  function safeText(value) {
    return String(value == null ? '' : value).trim();
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

  function parseTags(value) {
    const raw = Array.isArray(value) ? value : safeText(value).split(/[\n,\uFF0C;\uFF1B]+/);
    const seen = new Set();
    const result = [];
    for (const item of raw) {
      const tag = safeText(item);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
    }
    return result;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeUrlKey(value) {
    const text = safeText(value);
    if (!text) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      return parsed.href.replace(/\/+$/, '').toLowerCase();
    } catch (_) {
      return text.toLowerCase();
    }
  }

  function normalizePage(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 1;
    return Math.max(1, Math.round(number));
  }

  function normalizePageSize(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 50;
    return Math.min(500, Math.max(10, Math.round(number)));
  }

  function normalizeTotalPages(total, pageSize, totalPages) {
    const explicit = Number(totalPages);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.round(explicit));
    const count = Number(total);
    const size = normalizePageSize(pageSize);
    return count > 0 ? Math.max(1, Math.ceil(count / size)) : 0;
  }

  function normalizeSortBy(value) {
    const text = safeText(value);
    return text === 'pageAscore' ? text : '';
  }

  function normalizeSortDir(value) {
    return safeText(value).toLowerCase() === 'asc' ? 'asc' : 'desc';
  }

  function normalizeSubmitSourceForFilter(value) {
    const text = safeText(value);
    if (!text) return '';
    if (text === 'manual_assistant') return 'manual_assistant';
    if (text === 'batch' || text === 'batch_auto') return 'batch_auto';
    if (text === 'other') return 'other';
    return text;
  }

  function getSubmitSourceLabel(value) {
    const normalized = normalizeSubmitSourceForFilter(value);
    if (normalized === 'manual_assistant') return '手动助手';
    if (normalized === 'batch_auto') return '批量自动';
    return normalized ? normalized : '批量自动';
  }

  function toSortableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeOptionalNumber(value) {
    const text = safeText(value);
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function sortResources(resources, options = {}) {
    const rows = (Array.isArray(resources) ? resources : []).map(normalizeResource);
    const sortBy = normalizeSortBy(options.sortBy);
    if (!sortBy) return rows;
    const sortDir = normalizeSortDir(options.sortDir);
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        if (sortBy === 'pageAscore') {
          const av = toSortableNumber(a.row.pageAscore);
          const bv = toSortableNumber(b.row.pageAscore);
          if (av === null && bv === null) return a.index - b.index;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (av !== bv) return sortDir === 'asc' ? av - bv : bv - av;
        }
        return a.index - b.index;
      })
      .map((item) => item.row);
  }

  function getPagedResources(resources, pagination = {}) {
    const rows = Array.isArray(resources) ? resources : [];
    const pageSize = normalizePageSize(pagination.pageSize);
    const total = rows.length;
    const totalPages = normalizeTotalPages(total, pageSize, pagination.totalPages);
    const page = totalPages > 0 ? Math.min(normalizePage(pagination.page), totalPages) : 1;
    const offset = totalPages > 0 ? Math.max(0, (page - 1) * pageSize) : 0;
    return {
      rows: totalPages > 0 ? rows.slice(offset, offset + pageSize) : [],
      page,
      pageSize,
      total,
      totalPages,
      offset
    };
  }

  function getResourceDiscoveryTargets(resource) {
    const source = resource && typeof resource === 'object' ? resource : {};
    const values = [
      ...parseJsonArray(source.discoveryTargetUrls || source.discovery_target_urls || source.discoveryTargetUrlsJson || source.discovery_target_urls_json),
      source.firstDiscoveryTargetUrl || source.first_discovery_target_url,
      source.lastDiscoveryTargetUrl || source.last_discovery_target_url,
      source.discoveryTargetUrl || source.discovery_target_url
    ];
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const text = safeText(value);
      if (!text) continue;
      const key = normalizeUrlKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
    return result;
  }

  function getDiscoveryTargetOptions(resources) {
    const seen = new Set();
    const result = [];
    for (const resource of Array.isArray(resources) ? resources : []) {
      for (const target of getResourceDiscoveryTargets(resource)) {
        const key = normalizeUrlKey(target);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(target);
      }
    }
    return result;
  }

  function matchesDiscoveryTarget(resource, selectedDiscoveryTargetUrl) {
    const selected = safeText(selectedDiscoveryTargetUrl);
    if (!selected) return true;
    const selectedKey = normalizeUrlKey(selected);
    return getResourceDiscoveryTargets(resource).some((target) => normalizeUrlKey(target) === selectedKey);
  }

  function normalizeResource(resource) {
    const source = resource && typeof resource === 'object' ? resource : {};
    const discoveryTargetUrls = getResourceDiscoveryTargets(source);
    return {
      id: source.id == null ? '' : String(source.id),
      promotionProjectId: source.promotionProjectId == null && source.promotion_project_id == null
        ? ''
        : String(source.promotionProjectId ?? source.promotion_project_id),
      sourceUrl: safeText(source.sourceUrl || source.source_url),
      sourceUrlKey: safeText(source.sourceUrlKey || source.source_url_key),
      sourceDomain: safeText(source.sourceDomain || source.source_domain),
      firstDiscoveryTargetUrl: safeText(source.firstDiscoveryTargetUrl || source.first_discovery_target_url || discoveryTargetUrls[0]),
      lastDiscoveryTargetUrl: safeText(source.lastDiscoveryTargetUrl || source.last_discovery_target_url || discoveryTargetUrls[discoveryTargetUrls.length - 1]),
      discoveryTargetUrls,
      pageAscore: source.pageAscore ?? source.page_ascore ?? '',
      sourceTitle: safeText(source.sourceTitle || source.source_title || source.title),
      resourceType: safeText(source.resourceType || source.resource_type),
      qualityLabel: safeText(source.qualityLabel || source.quality_label),
      topicTags: parseTags(source.topicTags || source.topic_tags || source.topicTagsJson || source.topic_tags_json),
      notes: safeText(source.notes),
      externalLinks: source.externalLinks ?? source.external_links ?? '',
      lastSeen: safeText(source.lastSeen || source.last_seen),
      submitSource: safeText(source.submitSource || source.submit_source),
      targetUrl: safeText(source.targetUrl || source.target_url),
      targetDomain: safeText(source.targetDomain || source.target_domain),
      updatedAt: safeText(source.updatedAt || source.updated_at),
      createdAt: safeText(source.createdAt || source.created_at)
    };
  }

  function getFilteredResources(resources, filters = {}) {
    const rows = (Array.isArray(resources) ? resources : []).map(normalizeResource);
    const keyword = safeText(filters.keyword).toLowerCase();
    const resourceType = safeText(filters.resourceType);
    const qualityLabel = safeText(filters.qualityLabel);
    const discoveryTargetUrl = safeText(filters.discoveryTargetUrl);
    const promotionProjectId = safeText(filters.promotionProjectId);
    const submitSource = normalizeSubmitSourceForFilter(filters.submitSource);
    let minPageAscore = normalizeOptionalNumber(filters.minPageAscore);
    let maxPageAscore = normalizeOptionalNumber(filters.maxPageAscore);
    if (minPageAscore !== null && maxPageAscore !== null && minPageAscore > maxPageAscore) {
      const tmp = minPageAscore;
      minPageAscore = maxPageAscore;
      maxPageAscore = tmp;
    }

    return rows.filter((resource) => {
      if (promotionProjectId && String(resource.promotionProjectId) !== promotionProjectId) return false;
      if (resourceType && resource.resourceType !== resourceType) return false;
      if (qualityLabel && resource.qualityLabel !== qualityLabel) return false;
      if (submitSource) {
        const rowSubmitSource = normalizeSubmitSourceForFilter(resource.submitSource);
        if (submitSource === 'other') {
          if (rowSubmitSource === 'manual_assistant' || rowSubmitSource === 'batch_auto') return false;
        } else if (rowSubmitSource !== submitSource) {
          return false;
        }
      }
      if (!matchesDiscoveryTarget(resource, discoveryTargetUrl)) return false;
      if (minPageAscore !== null || maxPageAscore !== null) {
        const pageAscore = toSortableNumber(resource.pageAscore);
        if (pageAscore === null) return false;
        if (minPageAscore !== null && pageAscore < minPageAscore) return false;
        if (maxPageAscore !== null && pageAscore > maxPageAscore) return false;
      }
      if (!keyword) return true;

      const haystack = [
        resource.sourceUrl,
        resource.sourceDomain,
        resource.sourceTitle,
        resource.resourceType,
        resource.qualityLabel,
        resource.topicTags.join(' '),
        resource.notes,
        resource.targetUrl,
        resource.targetDomain,
        getResourceDiscoveryTargets(resource).join(' ')
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function buildResourceExportPath(input = {}) {
    const params = new URLSearchParams();
    const format = safeText(input.format).toLowerCase();
    const selectedDiscoveryTargetUrl = safeText(input.selectedDiscoveryTargetUrl || input.discoveryTargetUrl);
    const keyword = safeText(input.keyword);
    const resourceType = safeText(input.resourceType);
    const qualityLabel = safeText(input.qualityLabel);
    const promotionProjectId = safeText(input.promotionProjectId);
    const submitSource = normalizeSubmitSourceForFilter(input.submitSource);
    const minPageAscore = safeText(input.minPageAscore);
    const maxPageAscore = safeText(input.maxPageAscore);
    if (format === 'management') params.set('format', 'management');
    if (keyword) params.set('keyword', keyword);
    if (resourceType) params.set('resourceType', resourceType);
    if (qualityLabel) params.set('qualityLabel', qualityLabel);
    if (selectedDiscoveryTargetUrl) params.set('discoveryTargetUrl', selectedDiscoveryTargetUrl);
    if (promotionProjectId) params.set('promotionProjectId', promotionProjectId);
    if (submitSource) params.set('submitSource', submitSource);
    if (minPageAscore) params.set('minPageAscore', minPageAscore);
    if (maxPageAscore) params.set('maxPageAscore', maxPageAscore);
    const query = params.toString();
    return `/link-assistant/export.csv${query ? `?${query}` : ''}`;
  }

  function buildResourceListPath(input = {}) {
    const params = new URLSearchParams();
    const page = normalizePage(input.page);
    const pageSize = normalizePageSize(input.pageSize);
    const keyword = safeText(input.keyword);
    const resourceType = safeText(input.resourceType);
    const qualityLabel = safeText(input.qualityLabel);
    const discoveryTargetUrl = safeText(input.discoveryTargetUrl);
    const promotionProjectId = safeText(input.promotionProjectId);
    const submitSource = normalizeSubmitSourceForFilter(input.submitSource);
    const minPageAscore = safeText(input.minPageAscore);
    const maxPageAscore = safeText(input.maxPageAscore);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (keyword) params.set('keyword', keyword);
    if (resourceType) params.set('resourceType', resourceType);
    if (qualityLabel) params.set('qualityLabel', qualityLabel);
    if (discoveryTargetUrl) params.set('discoveryTargetUrl', discoveryTargetUrl);
    if (promotionProjectId) params.set('promotionProjectId', promotionProjectId);
    if (submitSource) params.set('submitSource', submitSource);
    if (minPageAscore) params.set('minPageAscore', minPageAscore);
    if (maxPageAscore) params.set('maxPageAscore', maxPageAscore);
    return `/link-assistant/resources?${params.toString()}`;
  }

  function setStatus(message, tone) {
    const el = getEl('pageStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.tone = tone || 'info';
  }

  function getDisplayErrorMessage(error) {
    const message = error && error.message ? String(error.message) : String(error || '');
    if (/not found|failed to fetch|networkerror|load failed|connection refused|econnrefused/i.test(message)) {
      return '本地服务未连接或接口不可用';
    }
    return message || '操作失败';
  }

  function sendChromeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!root.chrome || !root.chrome.runtime || typeof root.chrome.runtime.sendMessage !== 'function') {
        reject(new Error('chrome_runtime_unavailable'));
        return;
      }
      try {
        const maybePromise = root.chrome.runtime.sendMessage(message, (response) => {
          const lastError = root.chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'chrome_message_failed'));
            return;
          }
          resolve(response);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function requestLinkAssistantApi(path, options = {}) {
    const requestOptions = {
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) },
      body: options.body
    };
    if (root.chrome && root.chrome.runtime && typeof root.chrome.runtime.sendMessage === 'function') {
      const response = await sendChromeMessage({
        type: 'LINK_ASSISTANT_API_REQUEST',
        apiBase: getApiBase(),
        path,
        options: requestOptions
      });
      if (!response || response.success === false) {
        throw new Error((response && response.error) || 'LINK_ASSISTANT_API_REQUEST_FAILED');
      }
      return response;
    }

    const response = await fetch(`${getApiBase()}${path}`, requestOptions);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {}
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
      headers: {
        contentDisposition: response.headers.get('content-disposition') || '',
        contentType: response.headers.get('content-type') || ''
      }
    };
  }

  async function apiGet(path) {
    const response = await requestLinkAssistantApi(path, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const payload = response.json != null ? response.json : (response.text ? JSON.parse(response.text) : {});
    if (!response.ok || (payload && payload.success === false)) {
      throw new Error((payload && (payload.message || payload.error)) || `GET ${path} failed`);
    }
    return payload;
  }

  async function apiPatch(path, body) {
    const response = await requestLinkAssistantApi(path, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    const payload = response.json != null ? response.json : (response.text ? JSON.parse(response.text) : {});
    if (!response.ok || (payload && payload.success === false)) {
      throw new Error((payload && (payload.message || payload.error)) || `PATCH ${path} failed`);
    }
    return payload;
  }

  async function apiDelete(path) {
    const response = await requestLinkAssistantApi(path, {
      method: 'DELETE',
      headers: { Accept: 'application/json' }
    });
    const payload = response.json != null ? response.json : (response.text ? JSON.parse(response.text) : {});
    if (!response.ok || (payload && payload.success === false)) {
      throw new Error((payload && (payload.message || payload.error)) || `DELETE ${path} failed`);
    }
    return payload;
  }

  function getCurrentFilters() {
    return {
      keyword: getEl('keywordInput') ? getEl('keywordInput').value : '',
      resourceType: getEl('typeFilter') ? getEl('typeFilter').value : '',
      qualityLabel: getEl('qualityFilter') ? getEl('qualityFilter').value : '',
      discoveryTargetUrl: getEl('discoveryTargetFilter') ? getEl('discoveryTargetFilter').value : '',
      promotionProjectId: getEl('promotionProjectFilter') ? getEl('promotionProjectFilter').value : '',
      submitSource: getEl('submitSourceFilter') ? getEl('submitSourceFilter').value : '',
      minPageAscore: getEl('minAscoreInput') ? getEl('minAscoreInput').value : '',
      maxPageAscore: getEl('maxAscoreInput') ? getEl('maxAscoreInput').value : ''
    };
  }

  function buildOptions(options, selectedValue) {
    return options.map((option) => {
      const value = Array.isArray(option) ? option[0] : option;
      const label = Array.isArray(option) ? option[1] : option;
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function syncDiscoveryOptions() {
    const select = getEl('discoveryTargetFilter');
    if (!select) return;
    const selected = select.value;
    const options = [['', '全部发现来源']].concat(getDiscoveryTargetOptions(state.resources).map((target) => [target, target]));
    select.innerHTML = buildOptions(options, selected);
    select.value = selected;
  }

  function getProjectLabel(project) {
    if (!project) return '';
    return project.targetDomain || project.targetUrl || `Project ${project.id}`;
  }

  function syncProjectOptions() {
    const select = getEl('promotionProjectFilter');
    if (!select) return;
    const selected = select.value;
    const options = [['', '全部推广网站']].concat(state.projects.map((project) => [String(project.id), getProjectLabel(project)]));
    select.innerHTML = buildOptions(options, selected);
    select.value = selected;
  }

  function syncSubmitSourceOptions() {
    const select = getEl('submitSourceFilter');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = buildOptions(SUBMIT_SOURCE_FILTER_OPTIONS, selected);
    select.value = selected;
  }

  function renderPagination() {
    const totalNode = getEl('resourceTotal');
    const pageNode = getEl('pageJumpSelect');
    const pageSizeNode = getEl('pageSizeSelect');
    const prevBtn = getEl('prevPageBtn');
    const nextBtn = getEl('nextPageBtn');
    const pageInfoNode = getEl('resourcePageInfo');
    const pagination = state.pagination || {};
    const page = normalizePage(pagination.page);
    const pageSize = normalizePageSize(pagination.pageSize);
    const total = Number(pagination.total || 0);
    const totalPages = normalizeTotalPages(total, pageSize, pagination.totalPages);
    if (totalNode) totalNode.textContent = `共 ${total} 条`;
    if (pageNode) {
      if (totalPages <= 0) {
        pageNode.innerHTML = '<option value="1">第 1 页</option>';
        pageNode.value = '1';
        pageNode.disabled = true;
      } else {
        pageNode.innerHTML = Array.from({ length: totalPages }, (_, index) => {
          const number = index + 1;
          return `<option value="${number}">第 ${number} 页</option>`;
        }).join('');
        pageNode.disabled = false;
        pageNode.value = String(Math.min(Math.max(1, page), totalPages));
      }
    }
    if (pageSizeNode) pageSizeNode.value = String(pageSize);
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = !totalPages || page >= totalPages;
    if (pageInfoNode) pageInfoNode.textContent = totalPages > 0 ? `共 ${totalPages} 页` : '共 0 页';
  }

  function renderSortState() {
    const header = getEl('ascoreSortHeader');
    const indicator = getEl('ascoreSortIndicator');
    const active = state.sort && state.sort.sortBy === 'pageAscore';
    const dir = active ? normalizeSortDir(state.sort.sortDir) : '';
    if (header) {
      header.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
    if (indicator) {
      indicator.textContent = active ? (dir === 'asc' ? '↑' : '↓') : '↕';
    }
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function renderSummary(rows) {
    const node = getEl('resourceSummary');
    if (!node) return;
    const domains = new Set(rows.map((row) => row.sourceDomain).filter(Boolean));
    const pagination = state.pagination || {};
    node.textContent = `当前页 ${rows.length} 条，筛选后共 ${Number(pagination.total || 0)} 条，${domains.size} 个来源域名`;
  }

  function render() {
    if (typeof document === 'undefined') return;
    syncDiscoveryOptions();
    syncProjectOptions();
    syncSubmitSourceOptions();
    const rowsNode = getEl('resourceRows');
    if (!rowsNode) return;
    const filteredRows = getFilteredResources(state.resources, getCurrentFilters());
    const sortedRows = sortResources(filteredRows, state.sort);
    const paged = getPagedResources(sortedRows, state.pagination);
    state.pagination = {
      ...state.pagination,
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
      totalPages: paged.totalPages
    };
    renderPagination();
    renderSortState();
    renderSummary(paged.rows);

    if (!sortedRows.length) {
      rowsNode.innerHTML = '<tr><td colspan="12" class="empty">暂无匹配资源</td></tr>';
      return;
    }

    const offset = paged.offset;
    rowsNode.innerHTML = paged.rows.map((resource, index) => {
      const saving = state.savingIds.has(String(resource.id));
      const discoveryTargets = getResourceDiscoveryTargets(resource);
      const discoveryLabel = discoveryTargets.length > 1
        ? `${discoveryTargets[0]} +${discoveryTargets.length - 1}`
        : (discoveryTargets[0] || '');
      return `
        <tr data-resource-id="${escapeHtml(resource.id)}">
          <td class="num-cell">${offset + index + 1}</td>
          <td class="url-cell">
            <a href="${escapeHtml(resource.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(resource.sourceUrl)}</a>
            <small>${escapeHtml(resource.sourceTitle || '(untitled)')}</small>
          </td>
          <td class="url-cell">
            <span title="${escapeHtml(discoveryTargets.join('\n'))}">${escapeHtml(discoveryLabel)}</span>
          </td>
          <td class="ascore-cell">${escapeHtml(resource.pageAscore == null ? '' : resource.pageAscore)}</td>
          <td><select data-field="resourceType">${buildOptions(RESOURCE_TYPE_OPTIONS, resource.resourceType)}</select></td>
          <td><select data-field="qualityLabel">${buildOptions(QUALITY_OPTIONS, resource.qualityLabel)}</select></td>
          <td><input data-field="topicTags" type="text" value="${escapeHtml(resource.topicTags.join(', '))}" placeholder="seo, blog"></td>
          <td><textarea data-field="notes" placeholder="备注">${escapeHtml(resource.notes)}</textarea></td>
          <td>${escapeHtml(resource.sourceDomain)}</td>
          <td class="submit-source-cell">${escapeHtml(getSubmitSourceLabel(resource.submitSource))}</td>
          <td class="updated-cell">
            <span>${escapeHtml(saving ? '保存中...' : formatTime(resource.updatedAt))}</span>
            <small>${escapeHtml(resource.lastSeen ? `Last seen: ${resource.lastSeen}` : '')}</small>
          </td>
          <td><button type="button" class="text-danger" data-action="delete" ${saving ? 'disabled' : ''}>删除</button></td>
        </tr>
      `;
    }).join('');
    bindRowEditors();
  }

  async function loadResources() {
    setStatus('正在读取资源库...', 'info');
    const payload = await apiGet(buildResourceListPath({
      ...getCurrentFilters(),
      page: state.pagination.page,
      pageSize: state.pagination.pageSize
    }));
    state.resources = (Array.isArray(payload.resources) ? payload.resources : []).map(normalizeResource);
    const pageSize = normalizePageSize(payload.pagination && payload.pagination.pageSize ? payload.pagination.pageSize : state.pagination.pageSize);
    const total = Number(payload.pagination && payload.pagination.total ? payload.pagination.total : state.resources.length);
    const totalPages = normalizeTotalPages(total, pageSize, payload.pagination && payload.pagination.totalPages);
    const page = totalPages > 0
      ? Math.min(normalizePage(payload.pagination && payload.pagination.page), totalPages)
      : 1;
    if (payload.pagination) {
      state.pagination = {
        page,
        pageSize,
        total,
        totalPages
      };
    } else {
      state.pagination = {
        page,
        pageSize,
        total,
        totalPages
      };
    }
    render();
    setStatus(`已加载 ${state.resources.length} 条资源`, 'success');
  }

  async function loadProjects() {
    const payload = await apiGet('/link-assistant/projects');
    state.projects = Array.isArray(payload.projects) ? payload.projects : [];
    syncProjectOptions();
  }

  async function updateResource(id, patch) {
    const resourceId = safeText(id);
    if (!resourceId) throw new Error('Invalid resource id');
    state.savingIds.add(resourceId);
    render();
    try {
      const payload = { ...patch };
      if (Object.prototype.hasOwnProperty.call(payload, 'topicTags')) {
        payload.topicTags = parseTags(payload.topicTags);
      }
      const response = await apiPatch(`/link-assistant/resources/${encodeURIComponent(resourceId)}`, payload);
      const next = response.resource ? normalizeResource(response.resource) : null;
      if (next) {
        const index = state.resources.findIndex((resource) => String(resource.id) === resourceId);
        if (index >= 0) state.resources[index] = next;
      }
      setStatus('已保存资源', 'success');
      return next;
    } finally {
      state.savingIds.delete(resourceId);
      render();
    }
  }

  async function deleteResource(id) {
    const resourceId = safeText(id);
    if (!resourceId) throw new Error('Invalid resource id');
    const resource = state.resources.find((row) => String(row.id) === resourceId);
    const label = resource ? (resource.sourceDomain || resource.sourceUrl || resourceId) : resourceId;
    if (root.confirm && !root.confirm(`删除资源 ${label}？`)) return false;
    state.savingIds.add(resourceId);
    render();
    try {
      await apiDelete(`/link-assistant/resources/${encodeURIComponent(resourceId)}`);
      state.resources = state.resources.filter((row) => String(row.id) !== resourceId);
      setStatus('已删除资源', 'success');
      render();
      return true;
    } finally {
      state.savingIds.delete(resourceId);
      render();
    }
  }

  function bindRowEditors() {
    const rowsNode = getEl('resourceRows');
    if (!rowsNode) return;
    rowsNode.querySelectorAll('[data-field]').forEach((control) => {
      const eventName = control.tagName === 'TEXTAREA' || control.tagName === 'INPUT' ? 'blur' : 'change';
      control.addEventListener(eventName, () => {
        const row = control.closest('tr[data-resource-id]');
        if (!row) return;
        const patch = {};
        patch[control.getAttribute('data-field')] = control.value;
        updateResource(row.getAttribute('data-resource-id'), patch).catch((error) => {
          setStatus(getDisplayErrorMessage(error), 'error');
        });
      });
    });
    rowsNode.querySelectorAll('[data-action="delete"]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('tr[data-resource-id]');
        if (!row) return;
        deleteResource(row.getAttribute('data-resource-id')).catch((error) => {
          setStatus(getDisplayErrorMessage(error), 'error');
        });
      });
    });
  }

  function getFilenameFromDisposition(value, fallback) {
    const match = String(value || '').match(/filename="?([^";]+)"?/i);
    return match ? match[1] : fallback;
  }

  async function downloadExport(format) {
    const filters = getCurrentFilters();
    const path = buildResourceExportPath({
      format,
      ...filters
    });
    const response = await requestLinkAssistantApi(path, {
      method: 'GET',
      headers: { Accept: 'text/csv' }
    });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    const text = response.text || '';
    if (!text) throw new Error('CSV export returned empty content');
    const fallback = format === 'management' ? 'link-assistant-resources-management.csv' : 'link-assistant-semrush-resources.csv';
    const filename = getFilenameFromDisposition(response.headers && response.headers.contentDisposition, fallback);
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('CSV 已导出', 'success');
  }

  function bindToolbar() {
    const reloadFromFirstPage = () => {
      state.pagination.page = 1;
      loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'));
    };
    ['keywordInput', 'typeFilter', 'qualityFilter', 'discoveryTargetFilter', 'promotionProjectFilter', 'submitSourceFilter', 'minAscoreInput', 'maxAscoreInput'].forEach((id) => {
      const el = getEl(id);
      if (!el) return;
      el.addEventListener(id === 'keywordInput' || id === 'minAscoreInput' || id === 'maxAscoreInput' ? 'input' : 'change', reloadFromFirstPage);
    });
    const pageSizeSelect = getEl('pageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', () => {
        state.pagination.page = 1;
        state.pagination.pageSize = normalizePageSize(pageSizeSelect.value);
        loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'));
      });
    }
    const prevPageBtn = getEl('prevPageBtn');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        state.pagination.page = Math.max(1, normalizePage(state.pagination.page) - 1);
        loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'));
      });
    }
    const nextPageBtn = getEl('nextPageBtn');
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        state.pagination.page = normalizePage(state.pagination.page) + 1;
        loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'));
      });
    }
    const pageJumpSelect = getEl('pageJumpSelect');
    if (pageJumpSelect) {
      pageJumpSelect.addEventListener('change', () => {
        state.pagination.page = normalizePage(pageJumpSelect.value);
        loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'));
      });
    }
    const ascoreSortHeader = getEl('ascoreSortHeader');
    if (ascoreSortHeader) {
      ascoreSortHeader.addEventListener('click', () => {
        const current = state.sort || {};
        state.sort = {
          sortBy: 'pageAscore',
          sortDir: current.sortBy === 'pageAscore' && current.sortDir === 'desc' ? 'asc' : 'desc'
        };
        state.pagination.page = 1;
        render();
      });
    }
    const refreshBtn = getEl('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadResources().catch((error) => setStatus(getDisplayErrorMessage(error), 'error')));
    const exportCsvBtn = getEl('exportCsvBtn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => downloadExport('semrush').catch((error) => setStatus(getDisplayErrorMessage(error), 'error')));
    const exportManagementBtn = getEl('exportManagementBtn');
    if (exportManagementBtn) exportManagementBtn.addEventListener('click', () => downloadExport('management').catch((error) => setStatus(getDisplayErrorMessage(error), 'error')));
  }

  const publicApi = {
    buildResourceExportPath,
    buildResourceListPath,
    getDisplayErrorMessage,
    getDiscoveryTargetOptions,
    getFilteredResources,
    getPagedResources,
    getResourceDiscoveryTargets,
    getSubmitSourceLabel,
    matchesDiscoveryTarget,
    normalizePage,
    normalizePageSize,
    normalizeResource,
    parseTags,
    sortResources
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      bindToolbar();
      Promise.all([
        loadProjects().catch((error) => setStatus(getDisplayErrorMessage(error), 'error')),
        loadResources()
      ]).catch((error) => {
        setStatus(getDisplayErrorMessage(error), 'error');
        render();
      });
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
