(function initLinkAssistantSettings(root) {
  'use strict';

  const CURRENT_PROJECT_KEY = 'current_promotion_project_id';
  const HOMEPAGE_PROFILE_TTL_HOURS_KEY = 'manual_homepage_profile_cache_ttl_hours';
  const DEFAULT_API_BASE = 'http://127.0.0.1:3000/api';
  const state = {
    projects: [],
    selectedProjectId: '',
    activeProjectId: '',
    lastFetchedTargetUrl: '',
    homepageProfileTtlHours: 24,
    loading: false
  };

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

  function parseList(value) {
    if (Array.isArray(value)) return dedupeList(value);
    const text = safeText(value);
    if (!text) return [];
    if (/^\s*\[/.test(text)) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return dedupeList(parsed);
      } catch (_) {}
    }
    return dedupeList(text.split(/[\n,\uFF0C;\uFF1B]+/));
  }

  function dedupeList(items) {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(items) ? items : []) {
      const text = safeText(item);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
    return result;
  }

function normalizeSubmitMode(value) {
  const mode = safeText(value).toLowerCase();
  if (mode === 'auto') return 'auto';
  if (mode === 'confirm' || mode === 'semi_auto' || mode === 'semi-auto') return 'confirm';
  if (mode === 'manual') return 'manual';
  return 'auto';
}

  function normalizeHomepageProfileTtlHours(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 24;
    return Math.min(168, Math.max(1, Math.round(number)));
  }

  function normalizeProjectFormPayload(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      targetUrl: safeText(source.targetUrl || source.target_url || source.websiteUrl || source.website_url),
      keywords: parseList(source.keywords || source.keywordList || source.keywordsJson || source.keywords_json || source.defaultAnchorText || source.default_anchor_text),
      pageTitle: safeText(source.pageTitle || source.page_title || source.title),
      metaDescription: safeText(source.metaDescription || source.meta_description || source.description || source.productDescription || source.product_description),
      h1: safeText(source.h1),
      commentAuthor: safeText(source.commentAuthor || source.comment_author),
      contactEmail: safeText(source.contactEmail || source.contact_email),
      defaultSubmitMode: normalizeSubmitMode(source.defaultSubmitMode || source.default_submit_mode)
    };
  }

  function normalizeProjectFromApi(project) {
    const source = project && typeof project === 'object' ? project : {};
    const payload = normalizeProjectFormPayload(source);
    return {
      id: source.id == null ? '' : String(source.id),
      targetDomain: safeText(source.targetDomain || source.target_domain),
      targetUrlKey: safeText(source.targetUrlKey || source.target_url_key),
      keywordsJson: JSON.stringify(payload.keywords),
      fetchStatus: safeText(source.fetchStatus || source.fetch_status),
      fetchError: safeText(source.fetchError || source.fetch_error),
      fetchedAt: safeText(source.fetchedAt || source.fetched_at),
      createdAt: safeText(source.createdAt || source.created_at),
      updatedAt: safeText(source.updatedAt || source.updated_at),
      ...payload
    };
  }

  function projectLabel(project) {
    if (!project) return '';
    return project.targetDomain || project.targetUrl || `Project ${project.id}`;
  }

  function keywordSummary(project) {
    const keywords = Array.isArray(project && project.keywords) ? project.keywords : [];
    if (!keywords.length) return '未填写关键词';
    if (keywords.length <= 2) return keywords.join(', ');
    return `${keywords.slice(0, 2).join(', ')} +${keywords.length - 2}`;
  }

  function mergeMetadataIntoFormValues(input = {}) {
    const currentValues = input.currentValues && typeof input.currentValues === 'object' ? input.currentValues : {};
    const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
    const overwrite = !!input.overwrite;
    const metadataKeywords = parseList(metadata.keywords || metadata.keywordsJson || metadata.keywords_json);
    const next = {
      keywords: safeText(currentValues.keywords),
      pageTitle: safeText(currentValues.pageTitle),
      metaDescription: safeText(currentValues.metaDescription),
      h1: safeText(currentValues.h1)
    };

    const fields = [
      ['pageTitle', metadata.pageTitle],
      ['metaDescription', metadata.metaDescription],
      ['h1', metadata.h1]
    ];
    for (const [key, value] of fields) {
      const text = safeText(value);
      if (text && (overwrite || !next[key])) next[key] = text;
    }
    if (metadataKeywords.length && (overwrite || !next.keywords)) {
      next.keywords = metadataKeywords.join('\n');
    }
    return next;
  }

  function setStatus(message, tone) {
    const el = getEl('settingsStatus');
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

  function setBusy(isBusy) {
    state.loading = !!isBusy;
    const buttons = typeof document === 'undefined' ? [] : document.querySelectorAll('[data-busy-lock="true"]');
    buttons.forEach((button) => {
      button.disabled = state.loading;
    });
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

  async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const requestOptions = {
      method: options.method || 'GET',
      headers,
      body
    };

    if (root.chrome && root.chrome.runtime && typeof root.chrome.runtime.sendMessage === 'function') {
      const bridged = await sendChromeMessage({
        type: 'LINK_ASSISTANT_API_REQUEST',
        apiBase: getApiBase(),
        path,
        options: requestOptions
      });
      if (!bridged || bridged.success === false) {
        throw new Error((bridged && bridged.error) || 'LINK_ASSISTANT_API_REQUEST_FAILED');
      }
      const payload = bridged.json != null ? bridged.json : (bridged.text ? JSON.parse(bridged.text) : {});
      if (!bridged.ok || (payload && payload.success === false)) {
        throw new Error((payload && (payload.message || payload.error)) || `Request failed: ${bridged.status}`);
      }
      return payload;
    }

    const response = await fetch(`${getApiBase()}${path}`, requestOptions);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || (payload && payload.success === false)) {
      throw new Error((payload && (payload.message || payload.error)) || `Request failed: ${response.status}`);
    }
    return payload;
  }

  async function storageGet(keys) {
    if (!root.chrome || !root.chrome.storage || !root.chrome.storage.local) return {};
    return new Promise((resolve) => {
      root.chrome.storage.local.get(keys, (value) => resolve(value || {}));
    });
  }

  async function storageSet(value) {
    if (!root.chrome || !root.chrome.storage || !root.chrome.storage.local) return;
    return new Promise((resolve) => {
      root.chrome.storage.local.set(value, () => resolve());
    });
  }

  async function loadActiveProjectId() {
    const stored = await storageGet([CURRENT_PROJECT_KEY]);
    state.activeProjectId = stored[CURRENT_PROJECT_KEY] ? String(stored[CURRENT_PROJECT_KEY]) : '';
    return state.activeProjectId;
  }

  async function setActiveProjectId(projectId) {
    const nextId = projectId ? String(projectId) : '';
    state.activeProjectId = nextId;
    await storageSet({ [CURRENT_PROJECT_KEY]: nextId });
    renderProjectList();
    renderActiveProject();
  }

  async function loadHomepageProfileTtlHours() {
    const stored = await storageGet([HOMEPAGE_PROFILE_TTL_HOURS_KEY]);
    state.homepageProfileTtlHours = normalizeHomepageProfileTtlHours(stored[HOMEPAGE_PROFILE_TTL_HOURS_KEY]);
    const input = getEl('homepageProfileTtlHoursInput');
    if (input) input.value = String(state.homepageProfileTtlHours);
    return state.homepageProfileTtlHours;
  }

  async function saveHomepageProfileTtlHours() {
    const input = getEl('homepageProfileTtlHoursInput');
    const value = normalizeHomepageProfileTtlHours(input && input.value);
    state.homepageProfileTtlHours = value;
    if (input) input.value = String(value);
    await storageSet({ [HOMEPAGE_PROFILE_TTL_HOURS_KEY]: value });
    setStatus(`首页画像缓存时间已保存为 ${value} 小时`, 'success');
    return value;
  }

  function readForm() {
    return normalizeProjectFormPayload({
      targetUrl: getEl('targetUrlInput') && getEl('targetUrlInput').value,
      keywords: getEl('keywordsInput') && getEl('keywordsInput').value,
      pageTitle: getEl('pageTitleInput') && getEl('pageTitleInput').value,
      metaDescription: getEl('metaDescriptionInput') && getEl('metaDescriptionInput').value,
      h1: getEl('h1Input') && getEl('h1Input').value,
      commentAuthor: getEl('commentAuthorInput') && getEl('commentAuthorInput').value,
      contactEmail: getEl('contactEmailInput') && getEl('contactEmailInput').value,
      defaultSubmitMode: getEl('defaultSubmitModeInput') && getEl('defaultSubmitModeInput').value
    });
  }

  function writeForm(project) {
    const normalized = normalizeProjectFromApi(project || {});
    const keywordText = Array.isArray(normalized.keywords) ? normalized.keywords.join('\n') : '';
    const fields = {
      targetUrlInput: normalized.targetUrl,
      keywordsInput: keywordText,
      pageTitleInput: normalized.pageTitle,
      metaDescriptionInput: normalized.metaDescription,
      h1Input: normalized.h1,
      commentAuthorInput: normalized.commentAuthor,
      contactEmailInput: normalized.contactEmail,
      defaultSubmitModeInput: normalized.defaultSubmitMode || 'auto'
    };
    for (const [id, value] of Object.entries(fields)) {
      const el = getEl(id);
      if (el) el.value = value || '';
    }
  }

  function getSelectedProject() {
    return state.projects.find((project) => String(project.id) === String(state.selectedProjectId)) || null;
  }

  function selectProjectFromList(currentState, project) {
    const source = currentState && typeof currentState === 'object' ? currentState : {};
    const projectId = project && project.id != null ? String(project.id) : '';
    return {
      selectedProjectId: projectId || safeText(source.selectedProjectId),
      activeProjectId: projectId || safeText(source.activeProjectId)
    };
  }

  function renderActiveProject() {
    const active = state.projects.find((project) => String(project.id) === String(state.activeProjectId)) || null;
    const domainEl = getEl('activeProjectDomain');
    const keywordEl = getEl('activeProjectKeywords');
    const urlEl = getEl('activeProjectUrl');
    if (domainEl) domainEl.textContent = active ? projectLabel(active) : '未选择';
    if (keywordEl) keywordEl.textContent = active ? keywordSummary(active) : '请先选择一个推广网站';
    if (urlEl) urlEl.textContent = active ? active.targetUrl : '';
  }

  function renderProjectList() {
    const list = getEl('projectList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.projects.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = '还没有推广网站';
      list.appendChild(empty);
      return;
    }
    for (const project of state.projects) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'project-item',
        String(project.id) === String(state.selectedProjectId) ? 'selected' : '',
        String(project.id) === String(state.activeProjectId) ? 'active' : ''
      ].filter(Boolean).join(' ');
      button.innerHTML = `
        <span class="project-title">${escapeHtml(projectLabel(project))}</span>
        <span class="project-subtitle">${escapeHtml(keywordSummary(project))}</span>
      `;
      button.addEventListener('click', () => {
        const nextState = selectProjectFromList(state, project);
        state.selectedProjectId = nextState.selectedProjectId;
        writeForm(project);
        setActiveProjectId(nextState.activeProjectId).catch((error) => {
          setStatus(getDisplayErrorMessage(error), 'error');
          renderProjectList();
          renderActiveProject();
        });
      });
      list.appendChild(button);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadProjects() {
    setBusy(true);
    setStatus('正在读取推广网站...', 'info');
    try {
      await loadActiveProjectId();
      await loadHomepageProfileTtlHours();
      const payload = await apiRequest('/link-assistant/projects');
      state.projects = (Array.isArray(payload.projects) ? payload.projects : []).map(normalizeProjectFromApi);
      if (!state.selectedProjectId && state.activeProjectId) state.selectedProjectId = state.activeProjectId;
      if (!state.selectedProjectId && state.projects.length) state.selectedProjectId = String(state.projects[0].id);
      const selected = getSelectedProject();
      if (selected) writeForm(selected);
      renderProjectList();
      renderActiveProject();
      setStatus(state.projects.length ? '推广网站已加载' : '新建第一个推广网站', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(options = {}) {
    const payload = readForm();
    if (!payload.targetUrl) {
      setStatus('请填写推广网址', 'error');
      return null;
    }
    setBusy(true);
    setStatus('正在保存...', 'info');
    try {
      const selectedId = state.selectedProjectId;
      const path = selectedId ? `/link-assistant/projects/${encodeURIComponent(selectedId)}` : '/link-assistant/projects';
      const result = await apiRequest(path, {
        method: selectedId ? 'PATCH' : 'POST',
        body: payload
      });
      const saved = normalizeProjectFromApi(result.project || {});
      state.selectedProjectId = saved.id;
      if (options.activate !== false) await setActiveProjectId(saved.id);
      await loadProjects();
      state.selectedProjectId = saved.id;
      writeForm(saved);
      renderProjectList();
      setStatus(options.activate === false ? '已保存' : '已保存并设为当前推广网站', 'success');
      return saved;
    } finally {
      setBusy(false);
    }
  }

  function newProject() {
    state.selectedProjectId = '';
    writeForm({});
    renderProjectList();
    setStatus('正在新建推广网站', 'info');
    const targetUrlInput = getEl('targetUrlInput');
    if (targetUrlInput) targetUrlInput.focus();
  }

  async function deleteSelectedProject() {
    const selected = getSelectedProject();
    if (!selected) {
      setStatus('请选择要删除的推广网站', 'error');
      return;
    }
    if (root.confirm && !root.confirm(`删除推广网站 ${projectLabel(selected)}？`)) return;
    setBusy(true);
    try {
      await apiRequest(`/link-assistant/projects/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      if (String(state.activeProjectId) === String(selected.id)) await setActiveProjectId('');
      state.selectedProjectId = '';
      writeForm({});
      await loadProjects();
      setStatus('已删除推广网站', 'success');
    } finally {
      setBusy(false);
    }
  }

  function applyMetadata(metadata, options = {}) {
    const overwrite = !!options.overwrite;
    const merged = mergeMetadataIntoFormValues({
      currentValues: {
        keywords: getEl('keywordsInput') && getEl('keywordsInput').value,
        pageTitle: getEl('pageTitleInput') && getEl('pageTitleInput').value,
        metaDescription: getEl('metaDescriptionInput') && getEl('metaDescriptionInput').value,
        h1: getEl('h1Input') && getEl('h1Input').value
      },
      metadata,
      overwrite
    });
    const fields = [
      ['keywordsInput', merged.keywords],
      ['pageTitleInput', merged.pageTitle],
      ['metaDescriptionInput', merged.metaDescription],
      ['h1Input', merged.h1]
    ];
    for (const [id, value] of fields) {
      const el = getEl(id);
      if (!el || !value) continue;
      el.value = value;
    }
  }

  async function fetchMetadata(options = {}) {
    const targetUrl = safeText(getEl('targetUrlInput') && getEl('targetUrlInput').value);
    if (!targetUrl) {
      setStatus('请先填写推广网址', 'error');
      return null;
    }
    setBusy(true);
    setStatus('正在抓取网页信息...', 'info');
    try {
      const payload = await apiRequest('/link-assistant/projects/fetch-metadata', {
        method: 'POST',
        body: { targetUrl }
      });
      const metadata = payload.metadata || {};
      state.lastFetchedTargetUrl = targetUrl;
      applyMetadata(metadata, { overwrite: options.overwrite !== false });
      setStatus(metadata.fetchStatus === 'success' ? '已抓取网页信息' : (metadata.fetchError || '抓取失败'), metadata.fetchStatus === 'success' ? 'success' : 'error');
      return metadata;
    } finally {
      setBusy(false);
    }
  }

  async function maybeAutoFetchMetadata() {
    const targetUrl = safeText(getEl('targetUrlInput') && getEl('targetUrlInput').value);
    if (!targetUrl || targetUrl === state.lastFetchedTargetUrl) return;
    const hasMetadata = ['keywordsInput', 'pageTitleInput', 'metaDescriptionInput', 'h1Input']
      .some((id) => safeText(getEl(id) && getEl(id).value));
    if (hasMetadata) return;
    try {
      await fetchMetadata({ overwrite: false });
    } catch (error) {
      setStatus(getDisplayErrorMessage(error), 'error');
    }
  }

  function openResourceLibrary() {
    if (root.chrome && root.chrome.runtime && typeof root.chrome.runtime.sendMessage === 'function') {
      sendChromeMessage({ type: 'OPEN_RESOURCE_LIBRARY' }).catch(() => {
        root.location.href = 'resource-library.html';
      });
      return;
    }
    root.location.href = 'resource-library.html';
  }

  function bindDom() {
    const bindings = [
      ['newProjectBtn', 'click', newProject],
      ['refreshProjectsBtn', 'click', () => loadProjects().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'))],
      ['saveProjectBtn', 'click', () => saveProject({ activate: true }).catch((error) => setStatus(getDisplayErrorMessage(error), 'error'))],
      ['saveOnlyBtn', 'click', () => saveProject({ activate: false }).catch((error) => setStatus(getDisplayErrorMessage(error), 'error'))],
      ['deleteProjectBtn', 'click', () => deleteSelectedProject().catch((error) => setStatus(getDisplayErrorMessage(error), 'error'))],
      ['fetchMetadataBtn', 'click', () => fetchMetadata({ overwrite: true }).catch((error) => setStatus(getDisplayErrorMessage(error), 'error'))],
      ['setActiveProjectBtn', 'click', () => {
        const selected = getSelectedProject();
        if (!selected) {
          setStatus('请选择推广网站', 'error');
          return;
        }
        setActiveProjectId(selected.id).then(() => setStatus('已设为当前推广网站', 'success'));
      }],
      ['openResourceLibraryBtn', 'click', openResourceLibrary]
    ];
    for (const [id, eventName, handler] of bindings) {
      const el = getEl(id);
      if (el) el.addEventListener(eventName, handler);
    }
    const targetUrlInput = getEl('targetUrlInput');
    if (targetUrlInput) targetUrlInput.addEventListener('blur', maybeAutoFetchMetadata);
    const ttlInput = getEl('homepageProfileTtlHoursInput');
    if (ttlInput) {
      ttlInput.addEventListener('change', () => saveHomepageProfileTtlHours().catch((error) => setStatus(getDisplayErrorMessage(error), 'error')));
      ttlInput.addEventListener('blur', () => saveHomepageProfileTtlHours().catch((error) => setStatus(getDisplayErrorMessage(error), 'error')));
    }
  }

  const publicApi = {
    CURRENT_PROJECT_KEY,
    HOMEPAGE_PROFILE_TTL_HOURS_KEY,
    getDisplayErrorMessage,
    mergeMetadataIntoFormValues,
    normalizeProjectFormPayload,
    normalizeProjectFromApi,
    selectProjectFromList,
    parseList,
    normalizeSubmitMode,
    normalizeHomepageProfileTtlHours,
    keywordSummary,
    projectLabel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      bindDom();
      loadProjects().catch((error) => {
        setStatus(getDisplayErrorMessage(error), 'error');
        renderProjectList();
        renderActiveProject();
      });
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
