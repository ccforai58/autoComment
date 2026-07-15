// Text cleanup: previous comment was mojibake.

// ==================== section ====================
const API_BASE = (window.AUTO_COMMENT_CONFIG && window.AUTO_COMMENT_CONFIG.API_BASE) || 'http://127.0.0.1:3000/api';
const BLOG_RUN_STATS_ENDPOINT = `${API_BASE}/blog-run-stats`;
console.info('[batch][config] API_BASE =', API_BASE);
const POLL_INTERVAL = 3000;
const TIMEOUT_CHECK_INTERVAL = 5000;
const TIMEOUT_STORAGE_KEY = 'batch_timeout_seconds';
const SUBMIT_CONTEXT_CONFIRMATION_GRACE_SECONDS = 8;
const AI_REUSE_STATE_STORAGE_KEY = 'batch_ai_reuse_state_v1';

function sendLocalDebugLog(source, payload) {
  try {
    fetch(`${API_BASE}/debug-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, payload }),
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}

function getSemrushImportLogic() {
  return window.AutoCommentSemrushImportLogic || null;
}

function sanitizeSemrushImportValue(value) {
  const logic = getSemrushImportLogic();
  const sanitizeUrl = logic && typeof logic.sanitizeUrlForLog === 'function'
    ? logic.sanitizeUrlForLog
    : (url) => String(url || '').split(/[?#]/)[0].slice(0, 200);
  const sanitizeText = logic && typeof logic.sanitizeTextForLog === 'function'
    ? logic.sanitizeTextForLog
    : (text) => String(text == null ? '' : text).replace(/https?:\/\/[^\s"'<>`]+/gi, (match) => sanitizeUrl(match));

  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeSemrushImportValue(item));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return sanitizeText(value);
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(value.message || String(value))
    };
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && /(url|reason|message|error)/i.test(key)) {
      result[key] = sanitizeText(child);
    } else if (/url/i.test(key) && typeof child === 'string') {
      result[key] = sanitizeUrl(child);
    } else {
      result[key] = sanitizeSemrushImportValue(child);
    }
  }
  return result;
}

function logSubmitFlow(stage, details = {}) {
  const entry = { stage, batchId, ...details };
  console.log('[batch][submit-flow]', entry);
  sendLocalDebugLog('batch', entry);
}

function computeBatchTimeoutLimit({ configuredSeconds }) {
  const configured = Number(configuredSeconds);
  const fallback = 60;
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : fallback;
  return Math.max(1, Math.round(timeout));
}

function shouldFinalizePendingSubmitContextAfterGrace({ ctx, batchId: expectedBatchId, urlIndex, now, graceSeconds }) {
  if (!ctx || !ctx.batchId || ctx.urlIndex === undefined) return false;
  if (ctx.batchId !== expectedBatchId) return false;
  if (Number(ctx.urlIndex) !== Number(urlIndex)) return false;
  if (ctx.result !== 'submitted_unconfirmed') return false;
  if (ctx.submitAttemptStarted !== true) return false;
  const timestamp = Number(ctx.timestamp || 0);
  const graceMs = Math.max(1, Number(graceSeconds || SUBMIT_CONTEXT_CONFIRMATION_GRACE_SECONDS)) * 1000;
  if (!timestamp || !Number.isFinite(timestamp)) return false;
  return Number(now || Date.now()) - timestamp >= graceMs;
}

function buildSubmitContextGraceResult(submitCtx) {
  const ctx = submitCtx && typeof submitCtx === 'object' ? submitCtx : {};
  const evidence = ctx.successEvidence && typeof ctx.successEvidence === 'object' ? ctx.successEvidence : {};
  const isStrongSuccessEvidence = evidence.classifiedResult === 'success' && evidence.confidence === 'strong';
  const hasAnySubmitEvidence = !!(evidence.classifiedResult || evidence.reason || evidence.confidence);
  const reason = evidence.reason || 'submit_evidence_without_backlink';
  return {
    result: 'submitted_unconfirmed',
    aiContent: ctx.aiContent || null,
    errorMessage: isStrongSuccessEvidence
      ? `submit observed as success/${reason} but backlink verification did not finish before grace timeout`
      : (hasAnySubmitEvidence
        ? `submit observed as ${evidence.classifiedResult || 'unknown'}/${reason} before grace timeout`
        : (ctx.errorMessage || 'submit started but no confirmation returned after grace period'))
  };
}

function getSubmitVerificationGraceSecondsLocal(evidence) {
  const source = evidence && typeof evidence === 'object' ? evidence : {};
  const result = String(source.classifiedResult || source.result || '').trim();
  const confidence = String(source.confidence || '').trim();
  const reason = String(source.reason || '').trim();
  if (result === 'success' && confidence === 'strong') return 25;
  if (
    result === 'success' &&
    (confidence === 'medium' || /navigation_without_error|textarea_cleared|comment/i.test(reason))
  ) {
    return 20;
  }
  return SUBMIT_CONTEXT_CONFIRMATION_GRACE_SECONDS;
}

function resetRuntimeForNewUpload(parsedUrlCount) {
  batchId = null;
  status = 'idle';
  activeTabCount = 0;
  currentIndex = 0;
  initialPoints = parseInt(pointsBalance.textContent || '0', 10) || 0;
  currentPromotionWebsiteUrl = '';
  totalCount = Number(parsedUrlCount || 0);
  batchStartedAt = 0;
  successCount = 0;
  failCount = 0;
  skippedCount = 0;
  noCommentBoxCount = 0;
  manualRequiredCount = 0;
  blockedIllegalCount = 0;
  pendingCount = 0;
  localResults = [];
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  skippedIndices.clear();
  isOpeningTab = false;
  isTerminated = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  stopTimeoutChecker();
  setStatus('idle');
}

function clearRuntimeStorageForNewUpload() {
  try {
    chrome.storage.local.remove([
      BATCH_RUNTIME_STATE_KEY,
      BATCH_PENDING_TASK_KEY,
      'batchCtx',
      'batchSubmitCtx',
      AI_REUSE_STATE_STORAGE_KEY
    ], () => {
      console.log('[batch][runtime] cleared previous runtime state for new upload');
    });
  } catch (error) {
    console.warn('[batch][runtime] failed to clear previous runtime state:', error);
  }
}

// ==================== section ====================
let batchId = null;
let userId = null;
let parsedUrls = [];                // [{originalIndex, url}]
let status = 'idle';                // idle | running | completed
let activeTabCount = 0;
let currentIndex = 0;
let initialPoints = 0;
let currentPromotionWebsiteUrl = '';

// Text cleanup: previous comment was mojibake.
let totalCount = 0;
let batchStartedAt = 0;
let successCount = 0;
let failCount = 0;
let skippedCount = 0;
let noCommentBoxCount = 0;
let manualRequiredCount = 0;
let blockedIllegalCount = 0;
let pendingCount = 0;

// Text cleanup: previous comment was mojibake.
let localResults = [];              // [{originalIndex, url, result, aiContent, errorMessage, timestamp}]

// Text cleanup: previous comment was mojibake.
let pollTimer = null;

// Text cleanup: previous comment was mojibake.
let activeTabs = new Map();
let activeTabsByIndex = new Map();  // urlIndex -> { urlIndex, startTime }

// Text cleanup: previous comment was mojibake.
let timeoutCheckTimer = null;
let timeoutSeconds = 60;

// Text cleanup: previous comment was mojibake.
let isOpeningTab = false;
let tabsPendingConfirm = new Map();
// Text cleanup: previous comment was mojibake.
let tabsWaitingClose = new Set();
// Text cleanup: previous comment was mojibake.
let skippedIndices = new Set();

// ==================== section ====================
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const semrushUploadZone = document.getElementById('semrushUploadZone');
const semrushFileInput = document.getElementById('semrushFileInput');
const semrushMinAscore = document.getElementById('semrushMinAscore');
const semrushMaxPerDomain = document.getElementById('semrushMaxPerDomain');
const semrushImportStatus = document.getElementById('semrushImportStatus');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileCount = document.getElementById('fileCount');
const fileRemove = document.getElementById('fileRemove');
const urlPreview = document.getElementById('urlPreview');
const urlPreviewBody = document.getElementById('urlPreviewBody');
const duplicateCountEl = document.getElementById('duplicateCount');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const successCountEl = document.getElementById('successCount');
const failCountEl = document.getElementById('failCount');
const skippedCountEl = document.getElementById('skippedCount');
const noCommentBoxCountEl = document.getElementById('statsNoCommentBox');
const manualRequiredCountEl = document.getElementById('manualRequiredCount');
const pendingCountEl = document.getElementById('pendingCount');
const progressText = document.getElementById('progressText');
const footerActions = document.getElementById('footerActions');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const pointsBalance = document.getElementById('pointsBalance');
const pointsHint = document.getElementById('pointsHint');
const costHint = document.getElementById('costHint');
const statusBadge = document.getElementById('statusBadge');
const timeoutInput = document.getElementById('timeoutInput');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const refreshSetupBtn = document.getElementById('refreshSetupBtn');
const setupWebsiteValue = document.getElementById('setupWebsiteValue');
const setupIdentityValue = document.getElementById('setupIdentityValue');
const setupUserValue = document.getElementById('setupUserValue');
const setupStatusText = document.getElementById('setupStatusText');
const serviceStatusStrip = document.getElementById('serviceStatusStrip');
const resultsCard = document.getElementById('resultsCard');
const resultsCurrentTab = document.getElementById('resultsCurrentTab');
const resultsArchiveTab = document.getElementById('resultsArchiveTab');
const currentResultsPanel = document.getElementById('currentResultsPanel');
const archiveResultsPanel = document.getElementById('archiveResultsPanel');
const statsTotal = document.getElementById('statsTotal');
const statsSuccess = document.getElementById('statsSuccess');
const statsSkipped = document.getElementById('statsSkipped');
const statsManualRequired = document.getElementById('statsManualRequired');
const statsNoCommentBox = document.getElementById('statsNoCommentBox');
const statsFail = document.getElementById('statsFail');
const statsRate = document.getElementById('statsRate');
const filterResult = document.getElementById('filterResult');
const filterDomain = document.getElementById('filterDomain');
const filterTimeRange = document.getElementById('filterTimeRange');
const filterKeyword = document.getElementById('filterKeyword');
const statsTableBody = document.getElementById('statsTableBody');
const statsTableWrap = document.getElementById('statsTableWrap');
const statsCountLabel = document.getElementById('statsCountLabel');
const currentResultsEmpty = document.getElementById('currentResultsEmpty');
const archiveWebsiteFilter = document.getElementById('archiveWebsiteFilter');
const archiveResultFilter = document.getElementById('archiveResultFilter');
const archiveBacklinkStatusFilter = document.getElementById('archiveBacklinkStatusFilter');
const archiveKeyword = document.getElementById('archiveKeyword');
const archiveCountLabel = document.getElementById('archiveCountLabel');
const archiveSummary = document.getElementById('archiveSummary');
const archiveTableBody = document.getElementById('archiveTableBody');
const archiveTableWrap = document.getElementById('archiveTableWrap');
const archiveEmpty = document.getElementById('archiveEmpty');
const checkArchiveBacklinksBtn = document.getElementById('checkArchiveBacklinksBtn');
const archiveBacklinkConcurrency = document.getElementById('archiveBacklinkConcurrency');
const archiveBacklinkRetryDelay = document.getElementById('archiveBacklinkRetryDelay');
const pauseArchiveBacklinksBtn = document.getElementById('pauseArchiveBacklinksBtn');
const stopArchiveBacklinksBtn = document.getElementById('stopArchiveBacklinksBtn');
const retryArchiveBacklinksBtn = document.getElementById('retryArchiveBacklinksBtn');
const archiveBacklinkProgress = document.getElementById('archiveBacklinkProgress');
const exportArchiveBtn = document.getElementById('exportArchiveBtn');
const deleteArchiveSiteBtn = document.getElementById('deleteArchiveSiteBtn');
const deleteArchiveAllBtn = document.getElementById('deleteArchiveAllBtn');
let activeResultsView = 'current';
let archiveHasRecords = false;
let archiveWebsiteSelectionTouched = false;
let archiveBacklinkCheckRunning = false;
let archiveBacklinkCheckState = {
  active: false,
  paused: false,
  stopped: false,
  queue: [],
  running: new Map(),
  records: [],
  total: 0,
  startedAt: 0
};

// Text cleanup: previous comment was mojibake.
const batchAutoOpenPanel = document.getElementById('batchAutoOpenPanel');
const batchAutoGenerate = document.getElementById('batchAutoGenerate');
const batchAutoSubmit = document.getElementById('batchAutoSubmit');

// ==================== section ====================
const BATCH_SETTINGS_KEY = 'batch_task_settings';
const BATCH_URLS_KEY = 'batch_task_urls';
const BATCH_PENDING_TASK_KEY = 'batch_pending_task';
const BATCH_RUNTIME_STATE_KEY = 'batch_runtime_state_v1';
const WEBSITE_URL_STORAGE_KEY = 'promotion_website_url';
const PROMPT_FIELD_VALUES_STORAGE_KEY = 'auto_fill_prompt_field_values';
const BACKLINK_ARCHIVE_KEY = 'backlink_submission_archive';
const BACKLINK_ARCHIVE_LIMIT = 5000;

// Text cleanup: previous comment was mojibake.
const BATCH_CHECKBOX_SETTINGS_KEY = 'batch_checkbox_settings';

// Text cleanup: previous comment was mojibake.
async function loadBatchCheckboxSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([BATCH_CHECKBOX_SETTINGS_KEY], (data) => {
      const saved = data[BATCH_CHECKBOX_SETTINGS_KEY] || {};
      batchAutoOpenPanel.checked = !!saved.autoOpenPanel;
      batchAutoGenerate.checked = !!saved.autoGenerate;
      batchAutoSubmit.checked = !!saved.autoSubmit;
      console.log('[batch] message', saved);
      resolve();
    });
  });
}

// Text cleanup: previous comment was mojibake.
async function saveBatchCheckboxSettings() {
  return new Promise((resolve) => {
    const settings = {
      autoOpenPanel: batchAutoOpenPanel.checked,
      autoGenerate: batchAutoGenerate.checked,
      autoSubmit: batchAutoSubmit.checked
    };
    chrome.storage.sync.set({
      [BATCH_CHECKBOX_SETTINGS_KEY]: settings
    }, () => {
      console.log('[batch] message', settings);
      resolve();
    });
  });
}

// ==================== section ====================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadUserId();
  await loadPoints();
  await refreshSetupSummary();
  await refreshServiceStatus();
  await loadTimeoutSetting();
  await loadBatchCheckboxSettings();
  bindEvents();
  await renderArchive();
  await restoreBatchRuntimeState().catch((error) => {
    console.warn('[batch][runtime] restore failed:', error);
    return false;
  });

  updateUI();
}

async function loadUserId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['auto_comment_user_id'], (data) => {
      userId = data.auto_comment_user_id || '';
      resolve();
    });
  });
}

function pickLegacyPromptValue(values, keywords) {
  if (!values || typeof values !== 'object') return '';
  const normalizedKeywords = keywords.map((keyword) => String(keyword).toLowerCase());
  const entry = Object.entries(values).find(([key, value]) => {
    if (!value) return false;
    const normalizedKey = String(key || '').toLowerCase();
    return normalizedKeywords.some((keyword) => normalizedKey.includes(keyword));
  });
  return entry ? String(entry[1] || '').trim() : '';
}

async function getPromotionWebsiteUrlFromSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([WEBSITE_URL_STORAGE_KEY, PROMPT_FIELD_VALUES_STORAGE_KEY], (data) => {
      const savedUrl = data && typeof data[WEBSITE_URL_STORAGE_KEY] === 'string'
        ? data[WEBSITE_URL_STORAGE_KEY].trim()
        : '';
      const legacyUrl = pickLegacyPromptValue(data && data[PROMPT_FIELD_VALUES_STORAGE_KEY], [
        'website link',
        'website url',
        'url'
      ]);
      resolve(savedUrl || legacyUrl || '');
    });
  });
}

async function getSetupSummaryFromSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([
      WEBSITE_URL_STORAGE_KEY,
      PROMPT_FIELD_VALUES_STORAGE_KEY,
      'promotion_website_content',
      'auto_fill_user_name',
      'auto_fill_user_email',
      'auto_comment_user_id'
    ], (data) => {
      const promotionUrl = data && typeof data[WEBSITE_URL_STORAGE_KEY] === 'string'
        ? data[WEBSITE_URL_STORAGE_KEY].trim()
        : pickLegacyPromptValue(data && data[PROMPT_FIELD_VALUES_STORAGE_KEY], [
          'website link',
          'website url',
          'url'
        ]);
      const userName = data && typeof data.auto_fill_user_name === 'string'
        ? data.auto_fill_user_name.trim()
        : '';
      const userEmail = data && typeof data.auto_fill_user_email === 'string'
        ? data.auto_fill_user_email.trim()
        : '';
      const userIdValue = data && typeof data.auto_comment_user_id === 'string'
        ? data.auto_comment_user_id.trim()
        : 'local-user';
      resolve({ promotionUrl, userName, userEmail, userId: userIdValue || 'local-user' });
    });
  });
}

function setSetupValue(el, value, missingText) {
  if (!el) return;
  const text = value ? String(value) : missingText;
  el.textContent = text;
  el.title = text;
  el.classList.toggle('missing', !value);
}

async function refreshSetupSummary() {
  const setup = await getSetupSummaryFromSettings();
  const identity = [setup.userName, setup.userEmail].filter(Boolean).join(' / ');
  const missing = [];
  if (!setup.promotionUrl) missing.push('推广网站');
  if (!setup.userName) missing.push('姓名');
  if (!setup.userEmail) missing.push('邮箱');

  setSetupValue(setupWebsiteValue, setup.promotionUrl, '未配置');
  setSetupValue(setupIdentityValue, identity, '未配置');
  setSetupValue(setupUserValue, setup.userId, 'local-user');
  if (setupStatusText) {
    setupStatusText.textContent = missing.length
      ? `还缺少：${missing.join('、')}。补齐后再启动批量任务更稳。`
      : '配置已就绪，可以上传 CSV 并启动批量任务。';
    setupStatusText.style.color = missing.length ? '#b45309' : '#059669';
  }
}

function renderServiceStatus(statusPayload) {
  if (!serviceStatusStrip) return;
  const logic = getBatchResultsLogic();
  const summary = logic && logic.buildServiceStatusSummary
    ? logic.buildServiceStatusSummary(statusPayload)
    : null;
  const items = summary && Array.isArray(summary.items) ? summary.items : [
    { key: 'backend', label: 'Backend', status: 'bad', message: 'Unavailable' },
    { key: 'database', label: 'Database', status: 'bad', message: 'Unavailable' },
    { key: 'model', label: 'AI', status: 'bad', message: 'Unavailable' }
  ];

  items.forEach((item) => {
    const el = serviceStatusStrip.querySelector(`[data-service-key="${item.key}"]`);
    if (!el) return;
    el.classList.toggle('ok', item.status === 'ok');
    el.classList.toggle('bad', item.status === 'bad');
    el.textContent = item.label;
    el.title = item.message || '';
  });
}

async function refreshServiceStatus() {
  renderServiceStatus({});
  try {
    const response = await fetch(`${API_BASE}/local-status`, { cache: 'no-store' });
    const payload = await response.json();
    renderServiceStatus(payload);
    console.info('[batch][api] GET /local-status', {
      backend: payload && payload.backend ? payload.backend.ok : false,
      database: payload && payload.database ? payload.database.ok : false,
      model: payload && payload.model ? payload.model.ok : false
    });
  } catch (error) {
    renderServiceStatus({
      backend: { ok: false, error: 'Backend unavailable' },
      database: { ok: false, error: 'Backend unavailable' },
      model: { ok: false, error: 'Backend unavailable' }
    });
    console.warn('[batch][api] GET /local-status failed:', error);
  }
}

async function loadPoints() {
  if (!userId) {
    pointsBalance.textContent = '--';
    return;
  }
  try {
    console.info('[batch][api] GET /get-points', { userId });
    const resp = await fetch(`${API_BASE}/get-points?userId=${encodeURIComponent(userId)}`);
    const json = await resp.json();
    if (json.success && json.points !== undefined) {
      pointsBalance.textContent = json.points;
    } else {
      pointsBalance.textContent = '0';
    }
  } catch (e) {
    pointsBalance.textContent = '--';
  }
}

async function loadTimeoutSetting() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([TIMEOUT_STORAGE_KEY], (data) => {
      const saved = parseInt(data[TIMEOUT_STORAGE_KEY], 10);
      timeoutSeconds = (saved && saved >= 10 && saved <= 600) ? saved : 60;
      timeoutInput.value = String(timeoutSeconds);
      resolve();
    });
  });
}

// ==================== section ====================
function saveTimeoutSetting() {
  const val = parseInt(timeoutInput.value, 10);
  if (val >= 10 && val <= 600) {
    timeoutSeconds = val;
    chrome.storage.sync.set({ [TIMEOUT_STORAGE_KEY]: val });
  } else {
    timeoutInput.value = String(timeoutSeconds);
  }
}

// ==================== section ====================
function bindEvents() {
  // Text cleanup: previous comment was mojibake.
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', handleFileDrop);
  fileInput.addEventListener('change', handleFileSelect);
  if (semrushUploadZone && semrushFileInput) {
    semrushUploadZone.addEventListener('click', () => semrushFileInput.click());
    semrushFileInput.addEventListener('change', handleSemrushFileSelect);
    semrushUploadZone.addEventListener('dragover', handleDragOver);
    semrushUploadZone.addEventListener('dragleave', handleDragLeave);
    semrushUploadZone.addEventListener('drop', handleSemrushFileDrop);
  }

  // Text cleanup: previous comment was mojibake.
  fileRemove.addEventListener('click', resetFile);

  // Text cleanup: previous comment was mojibake.
  startBtn.addEventListener('click', () => {
    if (status === 'terminated') {
      resumeBatch();
    } else {
      startBatch();
    }
  });
  stopBtn.addEventListener('click', stopBatch);
  exportBtn.addEventListener('click', exportResults);
  clearBtn.addEventListener('click', clearBatch);
  if (checkArchiveBacklinksBtn) checkArchiveBacklinksBtn.addEventListener('click', checkArchiveBacklinkStatus);
  if (pauseArchiveBacklinksBtn) pauseArchiveBacklinksBtn.addEventListener('click', toggleArchiveBacklinkPause);
  if (stopArchiveBacklinksBtn) stopArchiveBacklinksBtn.addEventListener('click', stopArchiveBacklinkCheck);
  if (retryArchiveBacklinksBtn) retryArchiveBacklinksBtn.addEventListener('click', () => checkArchiveBacklinkStatus({ force: true }));
  if (exportArchiveBtn) exportArchiveBtn.addEventListener('click', exportArchiveResults);
  if (deleteArchiveSiteBtn) deleteArchiveSiteBtn.addEventListener('click', deleteSelectedArchiveWebsiteRecords);
  if (deleteArchiveAllBtn) deleteArchiveAllBtn.addEventListener('click', deleteAllArchiveWebsiteRecords);
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  }
  if (refreshSetupBtn) {
    refreshSetupBtn.addEventListener('click', () => {
      refreshSetupSummary();
      refreshServiceStatus();
      loadPoints();
    });
  }

  // Text cleanup: previous comment was mojibake.
  timeoutInput.addEventListener('change', saveTimeoutSetting);

  // Text cleanup: previous comment was mojibake.
  batchAutoOpenPanel.addEventListener('change', saveBatchCheckboxSettings);
  batchAutoGenerate.addEventListener('change', saveBatchCheckboxSettings);
  batchAutoSubmit.addEventListener('change', saveBatchCheckboxSettings);

  // Text cleanup: previous comment was mojibake.
  chrome.runtime.onMessage.addListener((message) => {
    // Text cleanup: previous comment was mojibake.
    if (message.type === 'BATCH_CONFIRMED') {
      console.log('[batch] message', { urlIndex: message.urlIndex, result: message.result, aiContentLen: message.aiContent ? message.aiContent.length : 0, tabsPendingConfirm: [...tabsPendingConfirm.entries()], tabsWaitingClose: [...tabsWaitingClose], time: new Date().toISOString() });
      handleTabConfirmed(message.urlIndex, message.result, message.aiContent, message.errorMessage, {
        linkVerified: message.linkVerified,
        matchedHref: message.matchedHref
      });
    }
  });

  // Text cleanup: previous comment was mojibake.
  filterResult.addEventListener('change', renderStats);
  filterDomain.addEventListener('change', renderStats);
  filterTimeRange.addEventListener('change', renderStats);
  filterKeyword.addEventListener('input', debounce(renderStats, 300));
  if (resultsCurrentTab) resultsCurrentTab.addEventListener('click', () => setResultsView('current'));
  if (resultsArchiveTab) resultsArchiveTab.addEventListener('click', () => setResultsView('archive'));
  if (archiveWebsiteFilter) {
    archiveWebsiteFilter.addEventListener('change', () => {
      archiveWebsiteSelectionTouched = true;
      renderArchive();
    });
  }
  if (archiveResultFilter) archiveResultFilter.addEventListener('change', renderArchive);
  if (archiveBacklinkStatusFilter) archiveBacklinkStatusFilter.addEventListener('change', renderArchive);
  if (archiveKeyword) archiveKeyword.addEventListener('input', debounce(renderArchive, 300));
  window.addEventListener('focus', refreshWorkbenchConfig);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshWorkbenchConfig();
    }
  });
}

async function refreshWorkbenchConfig() {
  await loadUserId();
  await refreshSetupSummary();
  await loadPoints();
}

// ==================== section ====================
function handleFileDrop(e) {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function handleDragOver(e) {
  e.preventDefault();
  if (e.currentTarget && e.currentTarget.classList) {
    e.currentTarget.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  if (e.currentTarget && e.currentTarget.classList) {
    e.currentTarget.classList.remove('drag-over');
  }
}

function handleSemrushFileSelect(e) {
  const file = e.target.files[0];
  if (file) processSemrushFile(file);
}

function handleSemrushFileDrop(e) {
  e.preventDefault();
  if (semrushUploadZone) semrushUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processSemrushFile(file);
}

function logSemrushImport(stage, details = {}) {
  const entry = sanitizeSemrushImportValue({ stage, ...details });
  console.info('[batch][semrush-import]', entry);
  sendLocalDebugLog('semrush-import', entry);
}

function setSemrushImportStatus(text) {
  if (semrushImportStatus) semrushImportStatus.textContent = text;
  logSemrushImport('status', { text });
}

function getSemrushImportFatalMessage(errorCode) {
  if (errorCode === 'missing_source_url') {
    return 'Semrush CSV 缺少 Source url 列，无法导入';
  }
  return '';
}

async function reviewSemrushDomain({ domain, sampleUrl }) {
  const timeoutMs = 15000;
  const startedAt = Date.now();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(new DOMException('Semrush domain review timeout', 'AbortError')), timeoutMs)
    : null;

  try {
    const response = await fetch(`${API_BASE}/semrush-domain-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, sampleUrl }),
      signal: controller ? controller.signal : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return {
        status: 'review_failed',
        reason: payload && payload.error ? String(payload.error) : `http_${response.status}`,
        durationMs: Date.now() - startedAt
      };
    }
    return {
      ...payload,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return {
        status: 'review_failed',
        reason: 'timeout',
        durationMs: Date.now() - startedAt
      };
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function processFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('请上传 CSV 文件');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    parseCSV(e.target.result, file.name);
  };
  reader.onerror = () => {
    alert('文件读取失败');
  };
  reader.readAsArrayBuffer(file);
}

function evaluateIllegalSiteForBatchItem(url, sourceDomain) {
  const filter = window.AutoCommentIllegalSiteFilter;
  if (!filter || typeof filter.evaluateUrl !== 'function') {
    console.warn('[batch] illegal-site filter is not loaded; skipping URL precheck');
    return { blocked: false };
  }
  return filter.evaluateUrl(url, { sourceDomain });
}

function getIllegalSiteBlockMessage(check) {
  if (!check || !check.blocked) return '';
  return check.reason || 'blocked by illegal-site filter';
}

function normalizeEncoding(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.length;

  // UTF-16 LE BOM: FF FE
  if (len >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.slice(2));
  }
  // UTF-16 BE BOM: FE FF
  if (len >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.slice(2));
  }
  // Text cleanup: previous comment was mojibake.
  if (len >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.slice(3));
  }
  // Text cleanup: previous comment was mojibake.
  if (len >= 4 && bytes[1] === 0x00 && bytes[3] === 0x00) {
    return new TextDecoder('utf-16le').decode(bytes);
  }

  // Text cleanup: previous comment was mojibake.
  let hasGBKSignature = false;
  for (let i = 0; i < len - 1; i++) {
    const b = bytes[i];
    if (b >= 0x81 && b <= 0xfe) {
      hasGBKSignature = true;
      break;
    }
  }

  // Text cleanup: previous comment was mojibake.
  const utf8Text = new TextDecoder('utf-8').decode(bytes);

  // Text cleanup: previous comment was mojibake.
  if (hasGBKSignature && (utf8Text.includes('\uFFFD') || utf8Text.includes('\u003f\u003f\u003f') || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(utf8Text.slice(0, 100)))) {
    try {
      // Text cleanup: previous comment was mojibake.
      const gbkText = new TextDecoder('gbk').decode(bytes);
      // Text cleanup: previous comment was mojibake.
      const validChineseCount = (gbkText.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (validChineseCount > 0) {
        return gbkText;
      }
    } catch (e) {
      // Text cleanup: previous comment was mojibake.
    }
  }

  return utf8Text;
}

function parseCSV(raw, fileNameParam) {
  const text = normalizeEncoding(raw);
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    alert('CSV file is empty or invalid.');
    return;
  }

  // Text cleanup: previous comment was mojibake.
  const headerRaw = lines[0];
  const header = parseCSVLine(headerRaw);
  const colUrl = findCsvColumn(header, [
    'URL',
    'url',
    'Url',
    'source url',
    'source_url',
    'original url',
    'original_url',
    'page url',
    'page_url',
    'link',
    'target url',
    'target_url',
  ], lines, 1);
  const colDomain = findCsvColumn(header, [
    'sourceDomain',
    'source domain',
    'source_domain',
    'url domain',
    'url_domain',
    'domain',
  ], lines, -1);

  if (colUrl === -1) {
    alert('CSV file is missing the source URL column. Please check the file format.');
    resetFile();
    return;
  }

  let validCount = 0;
  let invalidCount = 0;
  let illegalCount = 0;
  let duplicateCount = 0;
  const seenSourceUrlKeys = new Set();
  parsedUrls = [];
  urlPreviewBody.innerHTML = '';
  if (duplicateCountEl) duplicateCountEl.textContent = '';
  if (semrushImportStatus) semrushImportStatus.textContent = '';
  if (semrushUploadZone) semrushUploadZone.classList.remove('has-file');

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    let url = (row[colUrl] || '').trim();
    let sourceDomain = colDomain >= 0 ? (row[colDomain] || '').trim() : '';

    if (!url) {
      invalidCount++;
      continue;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    if (!isValidUrl(url)) {
      invalidCount++;
      continue;
    }

    const sourceUrlKey = normalizeCsvSourceUrlKey(url);
    if (sourceUrlKey && seenSourceUrlKeys.has(sourceUrlKey)) {
      duplicateCount++;
      continue;
    }
    if (sourceUrlKey) {
      seenSourceUrlKeys.add(sourceUrlKey);
    }

    const illegalCheck = evaluateIllegalSiteForBatchItem(url, sourceDomain);
    if (illegalCheck.blocked) {
      illegalCount++;
    }

    parsedUrls.push({
      originalIndex: parsedUrls.length,
      url,
      sourceDomain,
      illegalCheck: illegalCheck.blocked ? illegalCheck : null,
      originalRow: row
    });
    validCount++;

    const tr = document.createElement('tr');
    tr.dataset.url = url;
    if (illegalCheck.blocked) {
      tr.classList.add('illegal');
      tr.title = getIllegalSiteBlockMessage(illegalCheck);
    }
    tr.innerHTML = `<td>${parsedUrls.length}</td><td>${escapeHtml(sourceDomain || url)}</td><td>${escapeHtml(url)}</td>`;
    urlPreviewBody.appendChild(tr);
  }

  urlPreview.classList.add('visible');
  fileName.textContent = fileNameParam || 'Uploaded file';
  fileInfo.classList.add('visible');
  uploadZone.classList.add('has-file');
  fileCount.textContent = `${validCount} URL(s)`;
  if (invalidCount > 0) fileCount.textContent += `, skipped ${invalidCount} invalid`;
  if (illegalCount > 0) fileCount.textContent += `, blocked ${illegalCount}`;
  if (duplicateCount > 0) {
    fileCount.textContent += `, deduped ${duplicateCount} duplicate source URL(s)`;
    if (duplicateCountEl) duplicateCountEl.textContent = `deduped ${duplicateCount} duplicate source URL(s)`;
  }
  updateCostHint(Math.max(0, validCount - illegalCount));
  if (validCount > 0) {
    resetRuntimeForNewUpload(parsedUrls.length);
    clearRuntimeStorageForNewUpload();
  }
  updateStatsUI();
  updateUI();
}

async function processSemrushFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('请上传 CSV 文件');
    return;
  }

  try {
    setSemrushImportStatus('正在解析 CSV...');
    const raw = await file.arrayBuffer();
    const text = normalizeEncoding(raw);
    const parsed = Papa.parse(text, { skipEmptyLines: true });
    const rows = parsed.data || [];
    if (rows.length < 2) {
      alert('Semrush CSV 文件为空或格式无效');
      return;
    }

    const logic = getSemrushImportLogic();
    if (!logic || typeof logic.runSemrushImport !== 'function') {
      alert('Semrush 导入模块未加载');
      return;
    }

    const minPageAscoreValue = Number(semrushMinAscore && semrushMinAscore.value);
    const maxPerDomainValue = Number(semrushMaxPerDomain && semrushMaxPerDomain.value);
    const options = {
      minPageAscore: Number.isFinite(minPageAscoreValue) ? minPageAscoreValue : 5,
      maxPerDomain: Number.isFinite(maxPerDomainValue) ? maxPerDomainValue : 3
    };

    logSemrushImport('start', { fileName: file.name, fileSize: file.size, options });
    setSemrushImportStatus('正在去重和离线筛选...');
    const result = await logic.runSemrushImport({
      header: rows[0],
      rows: rows.slice(1),
      options,
      illegalSiteFilter: window.AutoCommentIllegalSiteFilter,
      reviewDomain: async (input) => {
        setSemrushImportStatus(`正在联网复查疑似站群：${input.domain}`);
        return reviewSemrushDomain(input);
      }
    });

    const importErrorCode = typeof logic.getSemrushImportErrorCode === 'function'
      ? logic.getSemrushImportErrorCode(result)
      : (result && result.errorCode) || '';
    const fatalMessage = getSemrushImportFatalMessage(importErrorCode);
    if (fatalMessage) {
      setSemrushImportStatus('导入失败');
      logSemrushImport('failed', { errorCode: importErrorCode, message: fatalMessage });
      alert(fatalMessage);
      return;
    }

    parsedUrls = result.submitItems.map((item, index) => ({
      originalIndex: index,
      url: item.url,
      sourceDomain: item.sourceDomain,
      targetDomain: item.targetDomain,
      illegalCheck: null,
      originalRow: item.originalRow,
      semrushMeta: {
        targetUrl: item.targetUrl,
        targetDomain: item.targetDomain,
        pageAscore: item.pageAscore,
        externalLinks: item.externalLinks,
        lastSeen: item.lastSeen
      }
    }));

    renderSemrushPreview(result);
    fileName.textContent = file.name;
    fileInfo.classList.add('visible');
    fileInput.value = '';
    uploadZone.classList.remove('has-file');
    if (semrushUploadZone) semrushUploadZone.classList.add('has-file');
    fileCount.textContent = logic.buildSemrushImportSummary(result.stats);
    updateCostHint(parsedUrls.length);
    resetRuntimeForNewUpload(parsedUrls.length);
    clearRuntimeStorageForNewUpload();
    updateStatsUI();
    updateUI();
    setSemrushImportStatus('导入完成');
    logSemrushImport('complete', {
      stats: result.stats,
      diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics.slice(0, 50) : []
    });
  } catch (error) {
    console.warn('[batch][semrush-import] failed', sanitizeSemrushImportValue(error));
    logSemrushImport('failed', { message: error && error.message ? error.message : String(error) });
    alert(`Semrush CSV 导入失败：${error && error.message ? error.message : error}`);
    setSemrushImportStatus('导入失败');
  } finally {
    if (semrushFileInput) semrushFileInput.value = '';
  }
}

function renderSemrushPreview(result) {
  urlPreviewBody.innerHTML = '';
  (result.submitItems || []).forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.dataset.url = item.url;
    const displayDomain = item.targetDomain || item.sourceDomain || '';
    tr.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(displayDomain)}</td><td>${escapeHtml(item.url)}</td>`;
    urlPreviewBody.appendChild(tr);
  });
  if (duplicateCountEl) {
    duplicateCountEl.textContent = result.stats.networkReviewRows > 0
      ? `联网复查失败待确认 ${result.stats.networkReviewRows} 条，未提交`
      : '';
  }
  urlPreview.classList.add('visible');
}

function normalizeCsvSourceUrlKey(url) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.normalizeSubmissionSourceUrlKey === 'function') {
    return logic.normalizeSubmissionSourceUrlKey(url);
  }

  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.href.toLowerCase();
  } catch (_) {
    return text.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function normalizeCsvHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '')
    .toLowerCase();
}

function looksLikeUrlColumnValue(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(text);
}

function findCsvColumn(header, names, lines, fallbackIndex) {
  const normalizedNames = new Set(names.map(normalizeCsvHeader));
  const found = header.findIndex((h) => normalizedNames.has(normalizeCsvHeader(h)));
  if (found >= 0) return found;

  if (fallbackIndex >= 0) {
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const row = parseCSVLine(lines[i]);
      if (looksLikeUrlColumnValue(row[fallbackIndex])) return fallbackIndex;
    }
  }

  return -1;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function resetFile() {
  fileInput.value = '';
  if (semrushFileInput) semrushFileInput.value = '';
  fileInfo.classList.remove('visible');
  uploadZone.classList.remove('has-file');
  if (semrushUploadZone) semrushUploadZone.classList.remove('has-file');
  urlPreview.classList.remove('visible');
  urlPreviewBody.innerHTML = '';
  parsedUrls = [];
  startBtn.disabled = true;
  fileCount.textContent = '';
  if (duplicateCountEl) duplicateCountEl.textContent = '';
  if (semrushImportStatus) semrushImportStatus.textContent = '';
  updateCostHint(0);
}

function updateCostHint(count) {
  if (count === 0) {
    costHint.textContent = '';
  } else {
    costHint.textContent = `Estimated cost: ${count} point(s)`;
  }
}

// ==================== section ====================
async function startBatch() {
  if (!userId) {
    alert('请先在设置页配置用户 ID');
    return;
  }
  if (parsedUrls.length === 0) {
    alert('请先上传有效的 CSV 文件');
    return;
  }

  await new Promise((resolve) => {
    chrome.storage.local.remove(['batchCtx', 'batchSubmitCtx'], resolve);
  });

  // Text cleanup: previous comment was mojibake.
  await saveBatchTaskSettings();

  currentPromotionWebsiteUrl = await getPromotionWebsiteUrlFromSettings();
  initialPoints = parseInt(pointsBalance.textContent || '0', 10);
  batchId = generateUUID();
  totalCount = parsedUrls.length;
  batchStartedAt = Date.now();
  successCount = 0;
  failCount = 0;
  skippedCount = 0;
  noCommentBoxCount = 0;
  manualRequiredCount = 0;
  blockedIllegalCount = 0;
  pendingCount = totalCount;
  currentIndex = 0;
  localResults = [];
  status = 'running';

  setStatus('running');
  updateUI();
  updateStatsUI();
  persistBatchRuntimeState();

  // Text cleanup: previous comment was mojibake.
  openNextTabSync();
}

// Text cleanup: previous comment was mojibake.
async function saveBatchTaskSettings() {
  return new Promise((resolve) => {
    const settings = {
      autoOpenPanel: batchAutoOpenPanel.checked,
      autoGenerate: batchAutoGenerate.checked,
      autoSubmit: batchAutoSubmit.checked,
      savedAt: Date.now()
    };
    const urls = parsedUrls.map(item => item.url);

    chrome.storage.local.set({
      [BATCH_SETTINGS_KEY]: settings,
      [BATCH_URLS_KEY]: urls
    }, () => {
      console.log('[batch] message', settings, 'URL 鏁伴噺:', urls.length);
      resolve();
    });
  });
}

// Text cleanup: previous comment was mojibake.
async function clearBatchTaskSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([BATCH_SETTINGS_KEY, BATCH_URLS_KEY, BATCH_PENDING_TASK_KEY], () => {
      console.log('[batch] batch task settings cleared');
      resolve();
    });
  });
}

// Text cleanup: previous comment was mojibake.
let isTerminated = false;

async function stopBatch() {
  // Text cleanup: previous comment was mojibake.
  isTerminated = true;
  setStatus('terminated');

  // Text cleanup: previous comment was mojibake.
  const terminatedCount = pendingCount;

  // Text cleanup: previous comment was mojibake.
  if (pollTimer) clearTimeout(pollTimer);
  stopTimeoutChecker();

  // Text cleanup: previous comment was mojibake.
  const activeEntries = Array.from(activeTabs.entries());
  for (const [tabId, info] of activeEntries) {
    if (!localResults.some((r) => r.originalIndex === info.urlIndex)) {
      const elapsed = Math.round((Date.now() - info.startTime) / 1000);
      handleTabResult(info.urlIndex, 'fail', null, 'Manual stop', elapsed, { suppressCompletion: true });
    }
  }

  // Text cleanup: previous comment was mojibake.
  const tabIds = activeEntries.map(([tabId]) => tabId);
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  for (const tabId of tabIds) {
    try {
      await new Promise((resolve) => {
        chrome.tabs.remove(tabId, () => resolve());
      });
    } catch (_) {}
  }
  activeTabCount = 0;

  // Text cleanup: previous comment was mojibake.
  updateStatsUI();
  updateUI();
  persistBatchRuntimeState();

  // Text cleanup: previous comment was mojibake.
  console.log(`[batch] Manually stopped. Kept ${localResults.length} result(s), success ${successCount}, fail ${failCount}, skipped ${terminatedCount} pending item(s).`);
}

// Text cleanup: previous comment was mojibake.
async function resumeBatch() {
  console.log('[resumeBatch] start resume', { status, currentIndex, totalCount, successCount, failCount });

  if (status !== 'terminated') {
    console.log('[batch] message');
    return;
  }

  // Text cleanup: previous comment was mojibake.
  isTerminated = false;
  isOpeningTab = false;

  // Text cleanup: previous comment was mojibake.
  const processedCount = getProcessedCount();
  pendingCount = totalCount - processedCount;
  const processedIndices = new Set(localResults.map((r) => r.originalIndex));
  let nextIndex = currentIndex;
  while (nextIndex < totalCount && processedIndices.has(nextIndex)) {
    nextIndex++;
  }
  if (nextIndex >= totalCount) {
    const fallbackIndex = parsedUrls.findIndex((_, idx) => !processedIndices.has(idx));
    nextIndex = fallbackIndex === -1 ? totalCount : fallbackIndex;
  }
  currentIndex = nextIndex;

  console.log('[batch] message', currentIndex, '-', totalCount - 1);

  setStatus('running');
  updateUI();
  persistBatchRuntimeState();

  // Text cleanup: previous comment was mojibake.
  console.log('[batch] message');

  openNextTabSync();
}

// Text cleanup: previous comment was mojibake.
async function openNextTabSync() {
  console.log('[batch] message', { isOpeningTab, status, isTerminated, currentIndex, totalCount });
  if (isOpeningTab) {
    console.log('[openNextTabSync] skip: already opening a tab');
    return;
  }
  isOpeningTab = true;
  await openNextTab();
  isOpeningTab = false;
}

async function openNextTab() {
  console.log('[openNextTab] check conditions', { status, isTerminated, activeTabCount, currentIndex, totalCount });

  if (status !== 'running') {
    console.log('[batch] message');
    return;
  }
  if (isTerminated) {
    console.log('[openNextTab] skip: terminated');
    return;
  }
  if (activeTabCount >= 1) {
    console.log('[openNextTab] skip: a tab is already active');
    return;
  }
  if (currentIndex >= totalCount) {
    console.log('[batch] message');
    return;
  }

  const urlIndex = currentIndex;
  const item = parsedUrls[urlIndex];
  const { url, sourceDomain } = item;
  console.log('[openNextTab] opening tab', { urlIndex, url });
  logSubmitFlow('batch.open_prepare', {
    urlIndex,
    url,
    currentIndex,
    totalCount
  });
  currentIndex++;

  const duplicateSubmission = await findExistingPromotionSubmissionForUrl(url);
  if (duplicateSubmission.shouldSkip) {
    console.info('[batch] skip duplicate promotion submission', {
      urlIndex,
      url,
      promotionWebsiteUrl: currentPromotionWebsiteUrl,
      existingResult: duplicateSubmission.record && duplicateSubmission.record.result
    });
    logSubmitFlow('batch.duplicate_submission_skip', {
      urlIndex,
      url,
      promotionWebsiteUrl: currentPromotionWebsiteUrl,
      existingResult: duplicateSubmission.record && duplicateSubmission.record.result,
      reason: duplicateSubmission.reason || 'duplicate_promotion_submission'
    });
    handleTabResult(
      urlIndex,
      'skipped',
      duplicateSubmission.record && duplicateSubmission.record.aiContent,
      'duplicate_promotion_submission',
      0,
      { suppressArchive: true }
    );
    if (status === 'running' && currentIndex < totalCount) {
      setTimeout(openNextTabSync, 0);
    } else if (status === 'running' && activeTabCount === 0) {
      checkAllCompleted();
    }
    return;
  }

  const illegalCheck = item.illegalCheck || evaluateIllegalSiteForBatchItem(url, sourceDomain);
  if (illegalCheck.blocked) {
    console.warn('[batch] message', { urlIndex, url, illegalCheck });
    item.illegalCheck = illegalCheck;
    handleTabResult(urlIndex, 'blocked_illegal', null, getIllegalSiteBlockMessage(illegalCheck), 0);
    if (status === 'running' && currentIndex < totalCount) {
      setTimeout(openNextTabSync, 0);
    } else if (status === 'running' && activeTabCount === 0) {
      checkAllCompleted();
    }
    return;
  }

  try {
    chrome.storage.local.set({
      [BATCH_PENDING_TASK_KEY]: {
        batchId,
        urlIndex,
        url,
        createdAt: Date.now()
      }
    }, () => {
      logSubmitFlow('batch.pending_task_saved', {
        urlIndex,
        url,
        storageError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
      });
    });

    chrome.tabs.create({ url, active: true }, (tab) => {
      const createError = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
      if (createError || !tab || !tab.id) {
        logSubmitFlow('batch.tab_create_failed', {
          urlIndex,
          url,
          error: createError || 'chrome.tabs.create returned no tab'
        });
        handleTabResult(urlIndex, 'fail', null, 'Tab create failed: ' + (createError || 'missing tab'), 0);
        if (status === 'running' && currentIndex < totalCount) {
          setTimeout(openNextTabSync, 1000);
        } else if (status === 'running' && activeTabCount === 0) {
          checkAllCompleted();
        }
        return;
      }
      logSubmitFlow('batch.tab_create_done', {
        urlIndex,
        url,
        tabId: tab.id
      });
      activeTabCount++;
      activeTabs.set(tab.id, { urlIndex, startTime: Date.now() });
      activeTabsByIndex.set(urlIndex, { urlIndex, startTime: Date.now() });

      // Text cleanup: previous comment was mojibake.
      highlightPreviewRow(urlIndex, 'processing');

      startTimeoutChecker();
      updateStatsUI();

      // Text cleanup: previous comment was mojibake.
      const listener = (tabId, removeInfo) => {
        if (tabId === tab.id) {
          // Text cleanup: previous comment was mojibake.
          const startTime = activeTabs.get(tab.id)?.startTime;
          activeTabs.delete(tab.id);
          activeTabsByIndex.delete(urlIndex);
          activeTabCount = Math.max(0, activeTabCount - 1);
          chrome.tabs.onRemoved.removeListener(listener);
          chrome.storage.local.get([BATCH_PENDING_TASK_KEY], (data) => {
            const pending = data[BATCH_PENDING_TASK_KEY];
            if (pending && pending.batchId === batchId && pending.urlIndex === urlIndex) {
              chrome.storage.local.remove(BATCH_PENDING_TASK_KEY, () => {});
            }
          });

          console.log('[batch] message', { tabId, urlIndex, activeTabCount, status });

          // Text cleanup: previous comment was mojibake.
          if (!localResults.some((r) => r.originalIndex === urlIndex)) {
            console.log('[batch] message', urlIndex);
            const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
            handleTabResult(urlIndex, 'fail', null, 'User manually closed the tab', elapsed);
          } else {
            console.log('[batch] message', urlIndex);
            clearPreviewRow(urlIndex);
          }

          updateStatsUI();

          // Text cleanup: previous comment was mojibake.
          if (status === 'running' && currentIndex < totalCount) {
            openNextTabSync();
          } else if (status === 'running' && activeTabCount === 0) {
            // Text cleanup: previous comment was mojibake.
            const processedCount = getProcessedCount();
            console.log('[batch] message', { processedCount, totalCount, activeTabCount });
            checkAllCompleted();
          }
        }
      };
      chrome.tabs.onRemoved.addListener(listener);

      // Text cleanup: previous comment was mojibake.
      function sendWhenReady(tabId, retries = 0) {
        if (status !== 'running' || isTerminated || !activeTabs.has(tabId)) {
          console.log('[batch] message', { tabId, status, isTerminated });
          return;
        }
        if (retries > 20) {
          console.warn('[batch] content.js ready timeout, giving up:', tabId);
          if (!localResults.some((r) => r.originalIndex === urlIndex)) {
            handleTabResult(urlIndex, 'fail', null, 'content.js ready timeout; page may be unavailable or extension injection is blocked');
          }
          try {
            chrome.tabs.remove(tabId, () => {});
          } catch (_) {}
          return;
        }
        chrome.tabs.sendMessage(tabId, { type: 'PING' }).then(() => {
          // Text cleanup: previous comment was mojibake.
          console.log('[batch] message', tab.id, { batchId, urlIndex, url, time: new Date().toISOString() });
          chrome.tabs.sendMessage(tab.id, {
            type: 'BATCH_HANDLE',
            batchId,
            urlIndex,
            url
          }).then((response) => {
            console.log('[batch] message', response, 'tabId:', tab.id, 'tabsPendingConfirm:', [...tabsPendingConfirm.keys()], 'time:', new Date().toISOString());
            if (response && response.ok) {
              if (localResults.some((r) => r.originalIndex === urlIndex) || !activeTabs.has(tab.id)) {
                console.log('[batch] message', { tabId: tab.id, urlIndex });
                return;
              }
              const activeInfo = activeTabs.get(tab.id);
              if (activeInfo) {
                activeInfo.acceptedAt = Date.now();
                activeTabs.set(tab.id, activeInfo);
              }
              console.log('[batch] message', tab.id, '鍒?tabsPendingConfirm, 绛夊緟 BATCH_CONFIRMED...');
              tabsPendingConfirm.set(tab.id, { urlIndex });
              tabsWaitingClose.add(tab.id);
            } else {
              console.warn('[batch] message', response);
            }
          }).catch((err) => {
            console.warn('[batch] message', err.message || err, 'tabId:', tab.id);
            // Text cleanup: previous comment was mojibake.
            if (!localResults.some((r) => r.originalIndex === urlIndex)) {
              console.log('[batch] sendMessage failed and no result exists; recording failure');
              handleTabResult(urlIndex, 'fail', null, 'Message send failed: ' + (err.message || 'The tab may have been closed'));
            }
          });
        }).catch(() => {
          // Text cleanup: previous comment was mojibake.
          setTimeout(() => sendWhenReady(tabId, retries + 1), 500);
        });
      }
      sendWhenReady(tab.id);
    });
  } catch (e) {
    console.error('[batch] message', e);
    // Text cleanup: previous comment was mojibake.
    if (currentIndex < totalCount) {
      setTimeout(openNextTabSync, 1000);
    }
  }
}

// Text cleanup: previous comment was mojibake.
// Text cleanup: previous comment was mojibake.
function handleTabResult(urlIndex, result, aiContent, errorMessage, forcedElapsed, options = {}) {
  console.log('[batch] message', { urlIndex, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage });
  const item = parsedUrls[urlIndex];
  if (!item) {
    console.log('[batch] message', urlIndex);
    return;
  }

  // Text cleanup: previous comment was mojibake.
  if (localResults.some((r) => r.originalIndex === urlIndex)) {
    console.log('[batch] message', urlIndex);
    return;
  }

  let elapsed = forcedElapsed !== undefined ? forcedElapsed : null;
  if (elapsed === null) {
    const tabInfo = activeTabsByIndex.get(urlIndex);
    elapsed = tabInfo ? Math.round((Date.now() - tabInfo.startTime) / 1000) : null;
  }

  const resultEntry = {
    originalIndex: urlIndex,
    url: item.url,
    sourceDomain: item.sourceDomain || '',
    promotionWebsiteUrl: currentPromotionWebsiteUrl || '',
    result: result,
    aiContent: aiContent || null,
    errorMessage: errorMessage || null,
    linkVerified: options.linkVerified,
    matchedHref: options.matchedHref || '',
    timestamp: Date.now(),
    elapsed,
    originalRow: item.originalRow || null
  };

  localResults.push(resultEntry);

  reportBlogRunStatsIfNeeded(item, result);

  if (result === 'success' || result === 'success_pending_moderation') {
    successCount++;
    highlightPreviewRow(urlIndex, 'success');
  } else if (result === 'skipped') {
    skippedCount++;
    skippedIndices.add(urlIndex);
    highlightPreviewRow(urlIndex, 'skipped');
  } else if (result === 'no_comment_box') {
    noCommentBoxCount++;
    highlightPreviewRow(urlIndex, 'no_comment_box');
  } else if (result === 'manual_required') {
    manualRequiredCount++;
    highlightPreviewRow(urlIndex, 'manual_required');
  } else if (result === 'submitted_unconfirmed') {
    manualRequiredCount++;
    highlightPreviewRow(urlIndex, 'manual_required');
  } else if (result === 'blocked_illegal') {
    blockedIllegalCount++;
    highlightPreviewRow(urlIndex, 'blocked_illegal');
  } else {
    failCount++;
    highlightPreviewRow(urlIndex, 'fail');
  }

  pendingCount = totalCount - getProcessedCount();
  updateStatsUI();
  renderStats();

  // Text cleanup: previous comment was mojibake.
  saveLocalResults();
  persistBatchRuntimeState();
  if (!options.suppressArchive) {
    saveArchiveRecord(resultEntry).catch((error) => {
      console.warn('[batch] archive save failed:', error);
    });
  }

  // Text cleanup: previous comment was mojibake.
  const processedCount = getProcessedCount();
  console.log('[batch] message', {
    urlIndex,
    result,
    successCount,
    failCount,
    skippedCount,
    manualRequiredCount,
    blockedIllegalCount,
    processedCount,
    totalCount,
    shouldComplete: processedCount >= totalCount
  });
  checkAllCompleted(options);
}

function reportBlogRunStatsIfNeeded(item, result) {
  if (result !== 'success' && result !== 'manual_required') return;

  const payload = buildBlogRunStatsPayload(item, result);
  if (!payload.urlDomain) return;

  try {
    console.info('[batch][api] POST /blog-run-stats', {
      originalUrl: payload.originalUrl,
      urlDomain: payload.urlDomain,
      targetDomain: payload.targetDomain,
      validationResult: payload.validationResult
    });
    fetch(BLOG_RUN_STATS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then((response) => {
      if (!response.ok) {
        console.warn('[batch] message', response.status, payload);
      }
    }).catch((error) => {
      console.warn('[batch] message', error, payload);
    });
  } catch (error) {
    console.warn('[batch] message', error, payload);
  }
}

function buildBlogRunStatsPayload(item, result) {
  const row = Array.isArray(item && item.originalRow) ? item.originalRow : [];
  const originalUrl = (item && item.url) || normalizeUrlForStats(row[1]);
  const urlDomain = normalizeDomainForStats(row[2] || (item && item.sourceDomain) || extractDomain(originalUrl));
  const targetDomain = normalizeDomainForStats(row[3]);

  return {
    pageAs: normalizeStatValue(row[0]),
    originalUrl,
    urlDomain,
    targetDomain,
    type: normalizeStatValue(row[4]),
    externalLinkCount: parseIntegerForStats(row[5]),
    validationResult: (result === 'success' || result === 'success_pending_moderation') ? 1 : 2
  };
}

function normalizeStatValue(value) {
  return String(value || '').trim();
}

function normalizeUrlForStats(value) {
  const text = normalizeStatValue(value);
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function normalizeDomainForStats(value) {
  const text = normalizeStatValue(value);
  if (!text) return '';
  try {
    return new URL(normalizeUrlForStats(text)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return text.replace(/^www\./i, '').toLowerCase();
  }
}

function parseIntegerForStats(value) {
  const parsed = parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Text cleanup: previous comment was mojibake.
function handleTabConfirmed(urlIndex, result, aiContent, errorMessage, evidence = {}) {
  console.log('[batch] handleTabConfirmed >>>', { urlIndex, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage, tabsPendingConfirmBefore: [...tabsPendingConfirm.entries()] });
  logSubmitFlow('confirmed', {
    urlIndex,
    result,
    errorMessage,
    activeTabCount
  });

  // Text cleanup: previous comment was mojibake.
  if (localResults.some((r) => r.originalIndex === urlIndex)) {
    console.log('[batch] handleTabConfirmed: result already exists, skip duplicate handling', urlIndex);
    checkAllCompleted();
  } else {
    // Text cleanup: previous comment was mojibake.
    handleTabResult(urlIndex, result, aiContent, errorMessage, undefined, evidence);
  }

  // Text cleanup: previous comment was mojibake.
  let closedTab = false;
  for (const [tabId, info] of tabsPendingConfirm) {
    if (info.urlIndex === urlIndex) {
      console.log('[batch] message', tabId, 'urlIndex:', urlIndex);
      tabsPendingConfirm.delete(tabId);
      tabsWaitingClose.delete(tabId);
      closedTab = true;
      logSubmitFlow('close_tab_after_confirm', {
        urlIndex,
        tabId,
        result
      });
      chrome.tabs.remove(tabId, () => {});
      break;
    }
  }

  if (!closedTab) {
    for (const [tabId, info] of activeTabs) {
      if (info.urlIndex === urlIndex) {
        console.log('[batch] message', tabId, 'urlIndex:', urlIndex);
        logSubmitFlow('close_active_tab_after_confirm', {
          urlIndex,
          tabId,
          result
        });
        chrome.tabs.remove(tabId, () => {});
        break;
      }
    }
  }

  // Text cleanup: previous comment was mojibake.
  console.log('[batch] handleTabConfirmed <<<');
}

function getProcessedCount() {
  return successCount + failCount + skippedCount + noCommentBoxCount + manualRequiredCount + blockedIllegalCount;
}

function checkAllCompleted(options = {}) {
  const processedCount = getProcessedCount();
  const shouldComplete = !options.suppressCompletion &&
    status === 'running' &&
    totalCount > 0 &&
    processedCount >= totalCount;

  console.log('[batch] checkAllCompleted:', {
    processedCount,
    totalCount,
    activeTabCount,
    status,
    shouldComplete
  });

  if (shouldComplete) {
    onAllCompleted();
  }
}

// Text cleanup: previous comment was mojibake.
function saveLocalResults() {
  chrome.storage.local.set({
    batchLocalResults: {
      batchId,
      totalCount,
      results: localResults.slice(-100) // Keep only the latest 100 records.
    }
  });
}

function buildBatchRuntimeSnapshot() {
  return {
    batchId,
    status,
    totalCount,
    batchStartedAt,
    currentIndex,
    parsedUrls,
    localResults,
    currentPromotionWebsiteUrl,
    successCount,
    failCount,
    skippedCount,
    noCommentBoxCount,
    manualRequiredCount,
    blockedIllegalCount,
    pendingCount,
    updatedAt: Date.now()
  };
}

function persistBatchRuntimeState() {
  const snapshot = buildBatchRuntimeSnapshot();
  chrome.storage.local.set({ [BATCH_RUNTIME_STATE_KEY]: snapshot }, () => {
    console.log('[batch][runtime] saved', {
      batchId: snapshot.batchId,
      status: snapshot.status,
      currentIndex: snapshot.currentIndex,
      resultCount: snapshot.localResults.length
    });
  });
}

function renderParsedUrlPreviewFromState() {
  urlPreviewBody.innerHTML = '';
  parsedUrls.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.dataset.url = item.url;
    if (item.illegalCheck && item.illegalCheck.blocked) {
      tr.classList.add('illegal');
      tr.title = getIllegalSiteBlockMessage(item.illegalCheck);
    }
    tr.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(item.sourceDomain || item.url)}</td><td>${escapeHtml(item.url)}</td>`;
    urlPreviewBody.appendChild(tr);
  });
  if (parsedUrls.length > 0) {
    urlPreview.classList.add('visible');
    fileInfo.classList.add('visible');
    uploadZone.classList.add('has-file');
    fileName.textContent = 'Restored batch';
    fileCount.textContent = `${parsedUrls.length} URL(s), restored`;
  }
}

async function restoreBatchRuntimeState() {
  const data = await new Promise((resolve) => chrome.storage.local.get([BATCH_RUNTIME_STATE_KEY], resolve));
  const snapshot = data[BATCH_RUNTIME_STATE_KEY];
  if (!snapshot || !snapshot.batchId || !Array.isArray(snapshot.parsedUrls)) return false;
  if (Date.now() - Number(snapshot.updatedAt || 0) > 24 * 60 * 60 * 1000) return false;

  batchId = snapshot.batchId;
  status = snapshot.status === 'running' ? 'terminated' : (snapshot.status || 'terminated');
  totalCount = Number(snapshot.totalCount || snapshot.parsedUrls.length || 0);
  batchStartedAt = Number(snapshot.batchStartedAt || 0);
  currentIndex = Number(snapshot.currentIndex || 0);
  parsedUrls = snapshot.parsedUrls;
  localResults = Array.isArray(snapshot.localResults) ? snapshot.localResults : [];
  currentPromotionWebsiteUrl = snapshot.currentPromotionWebsiteUrl || '';
  successCount = Number(snapshot.successCount || 0);
  failCount = Number(snapshot.failCount || 0);
  skippedCount = Number(snapshot.skippedCount || 0);
  noCommentBoxCount = Number(snapshot.noCommentBoxCount || 0);
  manualRequiredCount = Number(snapshot.manualRequiredCount || 0);
  blockedIllegalCount = Number(snapshot.blockedIllegalCount || 0);
  pendingCount = Math.max(0, totalCount - getProcessedCount());
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  activeTabCount = 0;
  isOpeningTab = false;
  isTerminated = status === 'terminated';

  renderParsedUrlPreviewFromState();
  renderStats();
  updateStatsUI();
  updateUI();
  setStatus(status || 'terminated');
  console.log('[batch][runtime] restored', {
    batchId,
    status,
    totalCount,
    resultCount: localResults.length
  });
  return true;
}

async function saveArchiveRecord(resultEntry) {
  if (!resultEntry) return;
  const promotionWebsiteUrl = resultEntry.promotionWebsiteUrl || currentPromotionWebsiteUrl || '';
  const archiveEntry = {
    id: `${batchId || 'batch'}:${resultEntry.originalIndex}:${resultEntry.timestamp || Date.now()}`,
    batchId: batchId || '',
    originalIndex: resultEntry.originalIndex,
    promotionWebsiteUrl,
    promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
    sourceUrl: resultEntry.url || '',
    sourceDomain: resultEntry.sourceDomain || extractDomain(resultEntry.url || ''),
    result: resultEntry.result || 'fail',
    aiContent: resultEntry.aiContent || null,
    errorMessage: resultEntry.errorMessage || null,
    linkVerified: resultEntry.linkVerified,
    matchedHref: resultEntry.matchedHref || '',
    elapsed: resultEntry.elapsed,
    timestamp: resultEntry.timestamp || Date.now()
  };

  await new Promise((resolve) => {
    chrome.storage.local.get([BACKLINK_ARCHIVE_KEY], (data) => {
      const records = Array.isArray(data[BACKLINK_ARCHIVE_KEY]) ? data[BACKLINK_ARCHIVE_KEY] : [];
      const archiveEntryKey = getArchiveMergeKey(archiveEntry);
      const existingIndex = records.findIndex((item) => getArchiveMergeKey(item) === archiveEntryKey);
      if (existingIndex >= 0) {
        records[existingIndex] = { ...records[existingIndex], ...archiveEntry };
      } else {
        records.push(archiveEntry);
      }
      const mergedRecords = mergeArchiveRecords(records);
      records.length = 0;
      records.push(...mergedRecords);
      if (records.length > BACKLINK_ARCHIVE_LIMIT) {
        records.length = BACKLINK_ARCHIVE_LIMIT;
      }
      chrome.storage.local.set({ [BACKLINK_ARCHIVE_KEY]: records }, resolve);
    });
  });
  await renderArchive();
}

function normalizePromotionWebsiteKey(url) {
  const text = String(url || '').trim();
  if (!text) return '__unconfigured__';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    parsed.hash = '';
    return parsed.href.replace(/\/+$/, '').toLowerCase();
  } catch (_) {
    return text.replace(/\/+$/, '').toLowerCase();
  }
}

function normalizeArchiveSourceUrlKey(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.href.toLowerCase();
  } catch (_) {
    return text.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function getArchiveMergeKey(record) {
  const promotionKey = record.promotionWebsiteKey || normalizePromotionWebsiteKey(record.promotionWebsiteUrl);
  const sourceKey = normalizeArchiveSourceUrlKey(record.sourceUrl);
  if (!sourceKey) return `record::${record.id || record.batchId || ''}:${record.originalIndex || ''}:${record.timestamp || ''}`;
  return `${promotionKey}::${sourceKey}`;
}

function mergeArchiveRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = getArchiveMergeKey(record);
    const current = byKey.get(key);
    if (!current || Number(record.timestamp || 0) >= Number(current.timestamp || 0)) {
      byKey.set(key, record);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function sortArchiveRecordsForDisplay(records) {
  const batchLatest = new Map();
  for (const record of records) {
    const batchKey = record.batchId || 'unknown';
    const timestamp = Number(record.timestamp || 0);
    batchLatest.set(batchKey, Math.max(batchLatest.get(batchKey) || 0, timestamp));
  }
  return records.slice().sort((a, b) => {
    const aBatch = a.batchId || 'unknown';
    const bBatch = b.batchId || 'unknown';
    const aLatest = batchLatest.get(aBatch) || 0;
    const bLatest = batchLatest.get(bBatch) || 0;
    if (aLatest !== bLatest) return bLatest - aLatest;
    if (aBatch !== bBatch) return String(bBatch).localeCompare(String(aBatch));
    const aIndex = Number.isFinite(Number(a.originalIndex)) ? Number(a.originalIndex) : Number.MAX_SAFE_INTEGER;
    const bIndex = Number.isFinite(Number(b.originalIndex)) ? Number(b.originalIndex) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return Number(a.timestamp || 0) - Number(b.timestamp || 0);
  });
}

async function getArchiveRecords() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve([]);
      return;
    }
    chrome.storage.local.get([BACKLINK_ARCHIVE_KEY], (data) => {
      const records = Array.isArray(data[BACKLINK_ARCHIVE_KEY]) ? data[BACKLINK_ARCHIVE_KEY] : [];
      resolve(mergeArchiveRecords(records));
    });
  });
}

async function getRuntimeBatchResults() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve([]);
      return;
    }
    chrome.storage.local.get(['batchResults'], (data) => {
      resolve(Array.isArray(data.batchResults) ? data.batchResults : []);
    });
  });
}

async function findExistingPromotionSubmissionForUrl(url) {
  const logic = getBatchResultsLogic();
  if (!logic || typeof logic.findDuplicatePromotionSubmissionRecord !== 'function') {
    return { shouldSkip: false, record: null, reason: '' };
  }
  const archiveRecords = await getArchiveRecords();
  const runtimeResults = await getRuntimeBatchResults();
  return logic.findDuplicatePromotionSubmissionRecord({
    records: [
      ...localResults,
      ...archiveRecords,
      ...runtimeResults
    ],
    url,
    promotionWebsiteUrl: currentPromotionWebsiteUrl
  });
}

async function renderArchive() {
  if (!archiveTableBody || !archiveWebsiteFilter) return;
  const records = await getArchiveRecords();
  archiveHasRecords = records.length > 0;
  const selectedWebsite = archiveWebsiteFilter.value || 'all';
  const selectedResult = archiveResultFilter ? archiveResultFilter.value : 'all';
  const selectedBacklinkStatus = archiveBacklinkStatusFilter ? archiveBacklinkStatusFilter.value : 'all';
  const keyword = archiveKeyword ? archiveKeyword.value.trim().toLowerCase() : '';

  const effectiveWebsite = buildArchiveWebsiteOptions(records, selectedWebsite, {
    preferLatest: !archiveWebsiteSelectionTouched
  });

  const filtered = filterArchiveRecords(records, {
    websiteKey: effectiveWebsite,
    result: selectedResult,
    backlinkStatus: selectedBacklinkStatus,
    keyword
  });

  renderArchiveSummary(filtered, records.length);
  if (activeResultsView === 'archive') {
    renderSummaryCounts(filtered);
  }
  updateResultsVisibility();
  if (archiveCountLabel) {
    archiveCountLabel.textContent = `显示 ${filtered.length} / ${records.length} 条`;
  }
  updateArchiveActionButtons(records, effectiveWebsite);

  archiveTableBody.innerHTML = '';
  if (archiveEmpty) {
    archiveEmpty.style.display = filtered.length === 0 ? 'block' : 'none';
  }
  if (archiveTableWrap) {
    archiveTableWrap.style.display = filtered.length === 0 ? 'none' : 'block';
  }

  const displayRecords = sortArchiveRecordsForDisplay(filtered);
  for (const record of displayRecords.slice(0, 500)) {
    const tr = document.createElement('tr');
    tr.className = `url-${record.result}`;
    const csvIndex = Number.isFinite(Number(record.originalIndex)) ? Number(record.originalIndex) + 1 : '--';
    const websiteLabel = record.promotionWebsiteUrl || 'Unconfigured promotion website';
    const shortWebsite = websiteLabel.length > 34 ? websiteLabel.substring(0, 31) + '...' : websiteLabel;
    const sourceUrl = record.sourceUrl || '';
    const shortSource = sourceUrl.length > 46 ? sourceUrl.substring(0, 43) + '...' : sourceUrl;
    const aiText = record.aiContent || '';
    const shortBatch = record.batchId ? String(record.batchId).slice(0, 8) : '--';
    const timeStr = record.timestamp ? formatTime(new Date(record.timestamp)) : '--';
    const display = getResultDisplayLocal(record);
    const latestBacklinkDisplay = getLatestBacklinkStatusDisplayLocal(record);
    const latestBacklinkTime = record.latestBacklinkCheckedAt ? formatTime(new Date(record.latestBacklinkCheckedAt)) : '--';

    tr.innerHTML = `
      <td style="color:#9ca3af;width:40px;text-align:center;">${escapeHtml(csvIndex)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(websiteLabel)}">${escapeHtml(shortWebsite)}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(sourceUrl)}">${escapeHtml(shortSource)}</td>
      <td><span class="result-badge ${display.cssClass}" title="${escapeHtml(display.categoryText)}">${escapeHtml(display.text)}</span></td>
      <td><span class="result-badge ${latestBacklinkDisplay.cssClass}" title="${escapeHtml(latestBacklinkDisplay.title || record.latestBacklinkReason || '')}">${escapeHtml(latestBacklinkDisplay.text)}</span></td>
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap;" title="${escapeHtml(record.latestBacklinkCheckedAt || '')}">${escapeHtml(latestBacklinkTime)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(record.errorMessage || '')}">${escapeHtml(record.errorMessage || '--')}</td>
      <td class="ai-content-cell" title="${escapeHtml(aiText)}">${escapeHtml(aiText || '--')}</td>
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap;" title="${escapeHtml(record.batchId || '')}">${escapeHtml(shortBatch)}</td>
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap;">${timeStr}</td>
    `;
    attachManualReviewTargetCell(tr.children[2], record, 'archive', tr);
    attachAiContentContextMenu(tr.children[7], record, tr);
    archiveTableBody.appendChild(tr);
  }
}

function filterArchiveRecords(records, filters) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.filterArchiveResultRecords === 'function') {
    return logic.filterArchiveResultRecords(records, filters);
  }
  return Array.isArray(records) ? records : [];
}

function getCurrentArchiveFilters() {
  return {
    websiteKey: archiveWebsiteFilter ? (archiveWebsiteFilter.value || 'all') : 'all',
    result: archiveResultFilter ? (archiveResultFilter.value || 'all') : 'all',
    backlinkStatus: archiveBacklinkStatusFilter ? (archiveBacklinkStatusFilter.value || 'all') : 'all',
    keyword: archiveKeyword ? archiveKeyword.value.trim().toLowerCase() : ''
  };
}

function getFilteredArchiveRecords(records) {
  return filterArchiveRecords(records, getCurrentArchiveFilters());
}

function updateArchiveActionButtons(records, selectedWebsiteKey) {
  const hasRecords = Array.isArray(records) && records.length > 0;
  if (deleteArchiveSiteBtn) {
    deleteArchiveSiteBtn.disabled = !hasRecords || !selectedWebsiteKey || selectedWebsiteKey === 'all';
  }
  if (deleteArchiveAllBtn) {
    deleteArchiveAllBtn.disabled = !hasRecords;
  }
  if (checkArchiveBacklinksBtn) {
    checkArchiveBacklinksBtn.disabled = !hasRecords || archiveBacklinkCheckRunning;
  }
  if (exportArchiveBtn) {
    exportArchiveBtn.disabled = !hasRecords || archiveBacklinkCheckRunning;
  }
}

function getLatestArchiveWebsiteKey(records) {
  const latest = records
    .filter((record) => record && (record.promotionWebsiteKey || record.promotionWebsiteUrl))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
  if (!latest) return 'all';
  return latest.promotionWebsiteKey || normalizePromotionWebsiteKey(latest.promotionWebsiteUrl);
}

function buildArchiveWebsiteOptions(records, selectedWebsite, optionsArg = {}) {
  if (!archiveWebsiteFilter) return 'all';
  const grouped = new Map();
  for (const record of records) {
    const key = record.promotionWebsiteKey || normalizePromotionWebsiteKey(record.promotionWebsiteUrl);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: record.promotionWebsiteUrl || 'Unconfigured promotion website',
        count: 0
      });
    }
    grouped.get(key).count++;
  }

  const options = ['<option value="all">全部推广网站</option>'];
  Array.from(grouped.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((item) => {
      options.push(`<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)} (${item.count})</option>`);
    });
  archiveWebsiteFilter.innerHTML = options.join('');
  const latestWebsite = getLatestArchiveWebsiteKey(records);
  const preferredWebsite = optionsArg.preferLatest && grouped.has(latestWebsite)
    ? latestWebsite
    : selectedWebsite;
  const effectiveWebsite = grouped.has(preferredWebsite) || preferredWebsite === 'all'
    ? preferredWebsite
    : (grouped.has(latestWebsite) ? latestWebsite : 'all');
  archiveWebsiteFilter.value = effectiveWebsite;
  return effectiveWebsite;
}

function renderArchiveSummary(records, totalRecords) {
  if (!archiveSummary) return;
  const total = records.length;
  const summary = getResultSummary(records);
  const success = summary.success + summary.skipped;
  const fail = summary.fail;
  const manual = summary.manual;
  const manualBreakdown = getManualBreakdownText(summary);
  const sourceDomains = new Set(records.map((r) => r.sourceDomain || extractDomain(r.sourceUrl || '')).filter(Boolean)).size;
  const rate = total > 0 ? Math.round((success / total) * 100) : 0;
  archiveSummary.innerHTML = `
    <span>历史总数：<strong>${totalRecords}</strong></span>
    <span>当前筛选：<strong>${total}</strong></span>
    <span>成功/已存在：<strong>${success}</strong></span>
    <span>失败：<strong>${fail}</strong></span>
    <span title="${escapeHtml(manualBreakdown)}">待确认/需手动：<strong>${manual}</strong></span>
    <span>来源域名：<strong>${sourceDomains}</strong></span>
    <span>成功率：<strong>${total > 0 ? rate + '%' : '--'}</strong></span>
  `;
}

async function onAllCompleted() {
  console.log('[batch] message');
  isTerminated = true;
  setStatus('completed');
  stopTimeoutChecker();
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // Text cleanup: previous comment was mojibake.
  const tabIds = Array.from(activeTabs.keys());
  activeTabs.clear();
  activeTabsByIndex.clear();
  activeTabCount = 0;
  for (const tabId of tabIds) {
    try {
      chrome.tabs.remove(tabId, () => {});
    } catch (_) {}
  }

  // Text cleanup: previous comment was mojibake.
  let finalPoints = initialPoints;
  try {
    console.info('[batch][api] GET /get-points final', { userId });
    const resp = await fetch(`${API_BASE}/get-points?userId=${encodeURIComponent(userId)}`);
    const json = await resp.json();
    if (json.success && json.points !== undefined) {
      finalPoints = json.points;
    }
  } catch (_) {}

  const pointsDiff = initialPoints - finalPoints;
  if (pointsDiff > 0 && Math.abs(pointsDiff - successCount) > 2) {
    console.warn(`Points diff (${pointsDiff}) does not match success count (${successCount}); using actual results.`);
  }

  updateStatsUI();
  updateUI();
}

// Text cleanup: previous comment was mojibake.
function startTimeoutChecker() {
  if (timeoutCheckTimer) return;
  timeoutCheckTimer = setInterval(() => {
    if (status !== 'running') {
      stopTimeoutChecker();
      return;
    }
    checkTimeouts();
  }, TIMEOUT_CHECK_INTERVAL);
}

function stopTimeoutChecker() {
  if (timeoutCheckTimer) {
    clearInterval(timeoutCheckTimer);
    timeoutCheckTimer = null;
  }
}

async function checkTimeouts() {
  if (activeTabs.size === 0) {
    stopTimeoutChecker();
    return;
  }
  const now = Date.now();
  const toRemove = [];
  const submitData = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx'], resolve));
  const submitCtx = submitData.batchSubmitCtx;
  for (const [tabId, info] of activeTabs) {
    const isAccepted = !!info.acceptedAt || tabsWaitingClose.has(tabId);
    const successEvidence = submitCtx && submitCtx.successEvidence ? submitCtx.successEvidence : null;
    const graceSeconds = getSubmitVerificationGraceSecondsLocal(successEvidence);
    if (isAccepted && graceSeconds > SUBMIT_CONTEXT_CONFIRMATION_GRACE_SECONDS && submitCtx && submitCtx.batchId === batchId && Number(submitCtx.urlIndex) === Number(info.urlIndex)) {
      logSubmitFlow('verify.wait_extended', {
        urlIndex: info.urlIndex,
        tabId,
        graceSeconds,
        baseGraceSeconds: SUBMIT_CONTEXT_CONFIRMATION_GRACE_SECONDS,
        evidence: successEvidence || {}
      });
    }
    if (isAccepted && shouldFinalizePendingSubmitContextAfterGrace({
      ctx: submitCtx,
      batchId,
      urlIndex: info.urlIndex,
      now,
      graceSeconds
    })) {
      const graceResult = buildSubmitContextGraceResult(submitCtx);
      toRemove.push({
        tabId,
        urlIndex: info.urlIndex,
        isAccepted,
        result: graceResult.result,
        aiContent: graceResult.aiContent,
        errorMessage: graceResult.errorMessage,
        stage: 'submit_context_grace_timeout',
        timeoutSeconds: graceSeconds
      });
      continue;
    }
    const timeoutLimit = computeBatchTimeoutLimit({ configuredSeconds: timeoutSeconds, isAccepted });
    const elapsed = (now - info.startTime) / 1000;
    if (elapsed > timeoutLimit) {
      toRemove.push({
        tabId,
        urlIndex: info.urlIndex,
        isAccepted,
        result: 'fail',
        aiContent: null,
        errorMessage: isAccepted ? 'Accepted task timed out while waiting for AI generation or submit confirmation' : 'Processing timed out',
        stage: 'timeout',
        timeoutSeconds: computeBatchTimeoutLimit({ configuredSeconds: timeoutSeconds, isAccepted })
      });
    }
  }
  for (const { tabId, urlIndex, isAccepted, result, aiContent, errorMessage, stage, timeoutSeconds: effectiveTimeoutSeconds } of toRemove) {
    activeTabs.delete(tabId);
    activeTabsByIndex.delete(urlIndex);
    tabsPendingConfirm.delete(tabId);
    tabsWaitingClose.delete(tabId);
    if (stage === 'submit_context_grace_timeout') {
      chrome.storage.local.remove('batchSubmitCtx', () => {});
    }
    logSubmitFlow(stage || 'timeout', {
      urlIndex,
      tabId,
      isAccepted,
      timeoutSeconds: effectiveTimeoutSeconds
    });
    handleTabResult(urlIndex, result || 'fail', aiContent || null, errorMessage || 'Processing timed out');
    try {
      await new Promise((resolve) => {
        chrome.tabs.remove(tabId, () => resolve());
      });
    } catch (_) {}
  }
}

// ==================== section ====================
function setStatus(s) {
  status = s;
  statusBadge.textContent = {
    idle: 'Idle',
    running: 'Running',
    completed: 'Completed',
    terminated: 'Terminated'
  }[s] || s;
  statusBadge.className = 'status-badge ' + s;
}

function setResultsView(view) {
  activeResultsView = view === 'archive' ? 'archive' : 'current';
  updateResultsVisibility();
  if (activeResultsView === 'archive') {
    renderArchive();
  } else {
    renderStats();
  }
}

function updateResultsVisibility() {
  if (!resultsCard) return;
  const hasCurrentResults = localResults.length > 0;
  const shouldShow = hasCurrentResults || archiveHasRecords || activeResultsView === 'current' || activeResultsView === 'archive';
  resultsCard.classList.toggle('visible', shouldShow);
  if (resultsCurrentTab) resultsCurrentTab.classList.toggle('active', activeResultsView === 'current');
  if (resultsArchiveTab) resultsArchiveTab.classList.toggle('active', activeResultsView === 'archive');
  if (currentResultsPanel) currentResultsPanel.classList.toggle('active', activeResultsView === 'current');
  if (archiveResultsPanel) archiveResultsPanel.classList.toggle('active', activeResultsView === 'archive');
  updateResultActionButtons();
}

function updateResultActionButtons() {
  const isRunning = status === 'running';
  if (exportBtn) {
    exportBtn.disabled = activeResultsView === 'archive' ? !archiveHasRecords : localResults.length === 0;
  }
  if (clearBtn) {
    clearBtn.disabled = isRunning || (localResults.length === 0 && !batchId);
  }
}

function renderSummaryCounts(records) {
  const summary = getResultSummary(records);
  statsTotal.textContent = summary.total;
  statsSuccess.textContent = summary.success;
  statsSkipped.textContent = summary.skipped;
  if (statsManualRequired) statsManualRequired.textContent = summary.manual;
  if (statsManualRequired) statsManualRequired.title = getManualBreakdownText(summary);
  statsNoCommentBox.textContent = summary.noCommentBox;
  statsFail.textContent = summary.fail;
  statsRate.textContent = summary.total > 0 ? `${summary.successRate}%` : '--';
}

function updateUI() {
  const isIdle = status === 'idle';
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isTerminated = status === 'terminated';

  // Text cleanup: previous comment was mojibake.
  startBtn.disabled = isRunning || isCompleted || parsedUrls.length === 0;
  // Text cleanup: previous comment was mojibake.
  startBtn.textContent = isTerminated ? 'Restart' : 'Start batch';

  stopBtn.disabled = isIdle || isTerminated || isCompleted;
  stopBtn.style.display = (isTerminated || isCompleted) ? 'none' : 'inline-flex';

  updateResultActionButtons();

  // Text cleanup: previous comment was mojibake.
  progressSection.style.display = (isIdle) ? 'none' : 'block';
  footerActions.style.display = (isIdle) ? 'none' : 'flex';

  // Text cleanup: previous comment was mojibake.
  if (isIdle) {
    statsTableBody.innerHTML = '';
  } else if (localResults.length > 0) {
    if (activeResultsView !== 'archive') activeResultsView = 'current';
    renderStats();
  }
  updateResultsVisibility();

  // Text cleanup: previous comment was mojibake.
  if (isTerminated) {
    pendingCount = totalCount - getProcessedCount();
    updateStatsUI();
  }
}

function updateStatsUI() {
  const processed = getProcessedCount();
  const percent = totalCount > 0 ? Math.round((processed / totalCount) * 100) : 0;
  progressBar.style.width = percent + '%';
  progressText.textContent = `${processed}/${totalCount} (${percent}%)`;
  successCountEl.textContent = successCount;
  failCountEl.textContent = failCount;
  skippedCountEl.textContent = skippedCount;
  noCommentBoxCountEl.textContent = noCommentBoxCount;
  if (manualRequiredCountEl) manualRequiredCountEl.textContent = manualRequiredCount;
  pendingCountEl.textContent = pendingCount;
}

// ==================== section ====================
function getBatchResultsLogic() {
  if (window.BatchResultsLogic) return window.BatchResultsLogic;
  console.warn('[batch] BatchResultsLogic helper is not loaded');
  return null;
}

function getResultDisplayLocal(resultOrRecord) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.getResultDisplay === 'function') {
    return logic.getResultDisplay(resultOrRecord);
  }
  const value = String(resultOrRecord && typeof resultOrRecord === 'object' ? resultOrRecord.result : resultOrRecord || '').trim();
  return {
    value,
    category: value,
    text: value || '未知',
    categoryText: value || '未知',
    cssClass: value || 'unknown'
  };
}

function getLatestBacklinkStatusDisplayLocal(record) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.getLatestBacklinkStatusDisplay === 'function') {
    return logic.getLatestBacklinkStatusDisplay(record);
  }
  const status = String(record && record.latestBacklinkStatus || '').trim();
  return {
    value: status,
    text: status || '未检测',
    cssClass: status || 'unknown',
    title: record && record.latestBacklinkReason || ''
  };
}

function getResultSummary(records) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.buildResultSummary === 'function') {
    return logic.buildResultSummary(records);
  }
  const rows = Array.isArray(records) ? records : [];
  return {
    total: rows.length,
    success: rows.filter((r) => r.result === 'success' || r.result === 'success_pending_moderation').length,
    skipped: rows.filter((r) => r.result === 'skipped').length,
    manual: rows.filter((r) => r.result === 'manual_required' || r.result === 'submitted_unconfirmed').length,
    manualRequired: rows.filter((r) => r.result === 'manual_required').length,
    unconfirmedAcceptance: 0,
    unconfirmedBacklink: 0,
    unconfirmedTimeout: 0,
    unconfirmedSubmitted: rows.filter((r) => r.result === 'submitted_unconfirmed').length,
    noCommentBox: rows.filter((r) => r.result === 'no_comment_box').length,
    fail: rows.filter((r) => r.result === 'fail' || r.result === 'blocked_illegal').length,
    successRate: rows.length > 0 ? Math.round((rows.filter((r) => r.result === 'success' || r.result === 'success_pending_moderation' || r.result === 'skipped').length / rows.length) * 100) : 0
  };
}

function getManualBreakdownText(summary) {
  const source = summary || {};
  return [
    `需手动处理：${source.manualRequired || 0}`,
    `页面未确认：${source.unconfirmedAcceptance || 0}`,
    `反链未确认：${source.unconfirmedBacklink || 0}`,
    `确认超时：${source.unconfirmedTimeout || 0}`,
    `已提交待确认：${source.unconfirmedSubmitted || 0}`
  ].join('；');
}

function buildManualReviewTargetLocal(record, source) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.buildManualReviewTarget === 'function') {
    return logic.buildManualReviewTarget({ record, source });
  }
  const resultSource = source === 'archive' ? 'archive' : 'current';
  const rawUrl = resultSource === 'archive'
    ? (record && (record.sourceUrl || record.url))
    : (record && (record.url || record.sourceUrl));
  const text = String(rawUrl || '').trim();
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, url: text, source: resultSource, error: 'unsupported_protocol' };
    }
    return { ok: true, url: parsed.href, source: resultSource };
  } catch (_) {
    return { ok: false, url: text, source: resultSource, error: text ? 'invalid_url' : 'missing_url' };
  }
}

function buildManualReviewOpenMessageLocal(record) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.buildManualReviewOpenMessage === 'function') {
    return logic.buildManualReviewOpenMessage({ record, tab: 'manual' });
  }
  return {
    type: 'SHOW_PROMOTE_PANEL',
    tab: 'manual',
    presetAiContent: String(record && record.aiContent || ''),
    presetAiContentSource: 'manual_review'
  };
}

let manualReviewContextMenu = null;
let selectedResultsRow = null;

function selectResultsRow(row) {
  if (selectedResultsRow && selectedResultsRow !== row) {
    selectedResultsRow.classList.remove('results-row-selected');
  }
  selectedResultsRow = row || null;
  if (selectedResultsRow) {
    selectedResultsRow.classList.add('results-row-selected');
  }
}

function copyTextToClipboard(text) {
  const value = String(text || '');
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(value);
  }
  const temp = document.createElement('textarea');
  temp.value = value;
  temp.style.position = 'fixed';
  temp.style.left = '-9999px';
  temp.style.top = '0';
  document.body.appendChild(temp);
  temp.focus();
  temp.select();
  try {
    document.execCommand('copy');
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  } finally {
    document.body.removeChild(temp);
  }
}

function attachAiContentContextMenu(cell, record, row) {
  if (!cell) return;
  cell.style.cursor = 'context-menu';
  cell.dataset.aiContentCopy = 'true';
  cell.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectResultsRow(row);
    copyTextToClipboard(record && record.aiContent || '').catch((err) => {
      console.warn('[batch][manual-review] copy AI content failed', err);
    });
  });
}

function hideManualReviewContextMenu() {
  if (manualReviewContextMenu && manualReviewContextMenu.parentNode) {
    manualReviewContextMenu.parentNode.removeChild(manualReviewContextMenu);
  }
  manualReviewContextMenu = null;
}

function ensureManualReviewContextMenu() {
  hideManualReviewContextMenu();
  const menu = document.createElement('div');
  menu.style.position = 'fixed';
  menu.style.zIndex = '2147483647';
  menu.style.minWidth = '190px';
  menu.style.padding = '6px';
  menu.style.background = '#111827';
  menu.style.border = '1px solid rgba(148,163,184,0.35)';
  menu.style.borderRadius = '8px';
  menu.style.boxShadow = '0 16px 38px rgba(15,23,42,0.28)';
  menu.style.color = '#f9fafb';
  menu.style.fontSize = '13px';
  menu.style.userSelect = 'none';

  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = '打开网页';
  item.style.display = 'block';
  item.style.width = '100%';
  item.style.border = 'none';
  item.style.borderRadius = '6px';
  item.style.padding = '8px 10px';
  item.style.background = 'transparent';
  item.style.color = '#f9fafb';
  item.style.textAlign = 'left';
  item.style.cursor = 'pointer';
  item.addEventListener('mouseenter', () => {
    item.style.background = 'rgba(37,99,235,0.9)';
  });
  item.addEventListener('mouseleave', () => {
    item.style.background = 'transparent';
  });
  menu.appendChild(item);
  document.body.appendChild(menu);
  manualReviewContextMenu = menu;
  return { menu, item };
}

function showManualReviewContextMenu(event, record, source, row) {
  event.preventDefault();
  event.stopPropagation();
  selectResultsRow(row);
  const { menu, item } = ensureManualReviewContextMenu();
  item.onclick = () => {
    hideManualReviewContextMenu();
    openManualReviewTarget(record, source);
  };
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${Math.min(event.clientX, maxLeft)}px`;
  menu.style.top = `${Math.min(event.clientY, maxTop)}px`;
}

function attachManualReviewTargetCell(cell, record, source, row) {
  if (!cell) return;
  cell.style.cursor = 'context-menu';
  cell.dataset.manualReviewTarget = 'true';
  cell.addEventListener('contextmenu', (event) => showManualReviewContextMenu(event, record, source, row));
}

function waitForManualReviewAssistant(tabId, record, attempt = 0) {
  if (!tabId || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') return;
  if (attempt > 30) {
    console.warn('[batch][manual-review] assistant message timeout', { tabId });
    return;
  }
  chrome.tabs.sendMessage(tabId, { type: 'PING' }).then(() => {
    return chrome.tabs.sendMessage(tabId, buildManualReviewOpenMessageLocal(record));
  }).catch(() => {
    setTimeout(() => waitForManualReviewAssistant(tabId, record, attempt + 1), 500);
  });
}

function openManualReviewTarget(record, source) {
  const target = buildManualReviewTargetLocal(record, source);
  if (!target.ok) {
    alert('这个目标页面地址不可打开，请检查结果记录里的 URL。');
    return;
  }
  chrome.tabs.create({ url: target.url, active: true }, (tab) => {
    const createError = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
    if (createError || !tab || !tab.id) {
      alert('打开目标页面失败：' + (createError || '未能创建标签页'));
      return;
    }
    waitForManualReviewAssistant(tab.id, record);
  });
}

document.addEventListener('click', hideManualReviewContextMenu);
document.addEventListener('scroll', hideManualReviewContextMenu, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideManualReviewContextMenu();
});

function downloadCsv(content, filename) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportResults() {
  const logic = getBatchResultsLogic();
  if (!logic) {
    alert('Export helper is not loaded. Please reload the extension.');
    return;
  }

  if (activeResultsView === 'archive') {
    const records = await getArchiveRecords();
    const filters = getCurrentArchiveFilters();
    const filtered = filterArchiveRecords(records, filters);
    if (filtered.length === 0) {
      alert('No archive records to export for the current filter.');
      return;
    }
    const csv = logic.buildArchiveExportCsv({
      websiteKey: filters.websiteKey,
      records: filtered
    });
    downloadCsv(csv.content, csv.filename);
    console.log('[batch][results] exported archive records', {
      selectedWebsite: filters.websiteKey,
      recordCount: csv.recordCount,
      filename: csv.filename
    });
    return;
  }

  if (localResults.length === 0) {
    alert('没有可导出的结果');
    return;
  }

  const csv = logic.buildCurrentBatchExportCsv({
    batchId,
    results: localResults
  });
  if (csv.error) {
    alert('缺少导入数据，无法按原始格式导出');
    return;
  }
  downloadCsv(csv.content, csv.filename);
  console.log('[batch][results] exported current batch records', {
    batchId,
    recordCount: csv.recordCount,
    filename: csv.filename
  });
}

async function exportArchiveResults() {
  const previousView = activeResultsView;
  activeResultsView = 'archive';
  try {
    await exportResults();
  } finally {
    activeResultsView = previousView;
  }
}

function setArchiveBacklinkCheckRunning(running) {
  archiveBacklinkCheckRunning = running;
  const logic = getBatchResultsLogic();
  const controlState = logic && typeof logic.buildBacklinkCheckControlState === 'function'
    ? logic.buildBacklinkCheckControlState({
      hasRecords: archiveHasRecords,
      active: archiveBacklinkCheckState.active,
      paused: archiveBacklinkCheckState.paused,
      stopped: archiveBacklinkCheckState.stopped
    })
    : {
      startDisabled: running || !archiveHasRecords,
      startLabel: running ? '检测中...' : '开始检测',
      pauseDisabled: !running,
      pauseLabel: archiveBacklinkCheckState.paused ? '继续检测' : '暂停',
      stopDisabled: !running,
      retryDisabled: running || !archiveHasRecords,
      controlsDisabled: running,
      exportDisabled: running || !archiveHasRecords
    };
  if (checkArchiveBacklinksBtn) {
    checkArchiveBacklinksBtn.disabled = controlState.startDisabled;
    checkArchiveBacklinksBtn.textContent = controlState.startLabel;
  }
  if (archiveBacklinkConcurrency) archiveBacklinkConcurrency.disabled = controlState.controlsDisabled;
  if (archiveBacklinkRetryDelay) archiveBacklinkRetryDelay.disabled = controlState.controlsDisabled;
  if (pauseArchiveBacklinksBtn) {
    pauseArchiveBacklinksBtn.disabled = controlState.pauseDisabled;
    pauseArchiveBacklinksBtn.textContent = controlState.pauseLabel;
  }
  if (stopArchiveBacklinksBtn) stopArchiveBacklinksBtn.disabled = controlState.stopDisabled;
  if (retryArchiveBacklinksBtn) retryArchiveBacklinksBtn.disabled = controlState.retryDisabled;
  if (exportArchiveBtn) exportArchiveBtn.disabled = controlState.exportDisabled;
}

async function saveArchiveRecords(records) {
  await new Promise((resolve) => {
    chrome.storage.local.set({ [BACKLINK_ARCHIVE_KEY]: mergeArchiveRecords(records) }, resolve);
  });
}

function getArchiveBacklinkConcurrencyLocal() {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.normalizeBacklinkCheckConcurrency === 'function') {
    return logic.normalizeBacklinkCheckConcurrency(archiveBacklinkConcurrency ? archiveBacklinkConcurrency.value : '');
  }
  const value = Number(archiveBacklinkConcurrency ? archiveBacklinkConcurrency.value : 3);
  return Math.min(8, Math.max(1, Number.isFinite(value) ? value : 3));
}

function getArchiveBacklinkRetryDelayMsLocal() {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.normalizeBacklinkRetryDelayMs === 'function') {
    return logic.normalizeBacklinkRetryDelayMs(archiveBacklinkRetryDelay ? archiveBacklinkRetryDelay.value : '');
  }
  const value = Number(archiveBacklinkRetryDelay ? archiveBacklinkRetryDelay.value : 2);
  return Math.min(10000, Math.max(0, Number.isFinite(value) ? Math.round(value * 1000) : 2000));
}

function getArchiveBacklinkProgressText(records) {
  const logic = getBatchResultsLogic();
  if (!logic || typeof logic.buildBacklinkCheckProgress !== 'function') {
    return '';
  }
  const progress = logic.buildBacklinkCheckProgress(records);
  if (typeof logic.buildBacklinkCheckProgressText === 'function') {
    return logic.buildBacklinkCheckProgressText(progress, {
      active: archiveBacklinkCheckState.active,
      paused: archiveBacklinkCheckState.paused,
      stopped: archiveBacklinkCheckState.stopped
    });
  }
  return `外链检测：${progress.completed}/${progress.total}（${progress.percent}%） 成功 ${progress.success}，未发现 ${progress.missing}，失败 ${progress.error}，跳过 ${progress.skipped}，检测中 ${progress.checking}`;
}

function updateArchiveBacklinkProgress(records) {
  if (!archiveBacklinkProgress) return;
  const text = getArchiveBacklinkProgressText(records);
  archiveBacklinkProgress.textContent = text || '外链检测：未开始';
}

function resetArchiveBacklinkCheckState() {
  for (const controller of archiveBacklinkCheckState.running.values()) {
    try { controller.abort(); } catch (_) {}
  }
  archiveBacklinkCheckState = {
    active: false,
    paused: false,
    stopped: false,
    queue: [],
    running: new Map(),
    records: [],
    total: 0,
    startedAt: 0
  };
}

function setArchiveRecordsChecking(records, ids) {
  const idSet = new Set(ids.map(String));
  return (Array.isArray(records) ? records : []).map((record) => {
    if (!record || !idSet.has(String(record.id))) return record;
    return {
      ...record,
      latestBacklinkStatus: 'checking',
      latestBacklinkCheckedAt: '',
      latestBacklinkMatchedHref: '',
      latestBacklinkReason: 'queued_for_backlink_check'
    };
  });
}

function clearArchiveCheckingStatus(records) {
  return (Array.isArray(records) ? records : []).map((record) => {
    if (!record || record.latestBacklinkStatus !== 'checking') return record;
    return {
      ...record,
      latestBacklinkStatus: '',
      latestBacklinkCheckedAt: '',
      latestBacklinkMatchedHref: '',
      latestBacklinkReason: ''
    };
  });
}

async function checkArchiveBacklinkStatus(options = {}) {
  const logic = getBatchResultsLogic();
  if (!logic || typeof logic.mergeBacklinkCheckResults !== 'function') {
    alert('外链检查工具未加载，请刷新扩展后重试。');
    return;
  }

  if (archiveBacklinkCheckState.active) return;
  resetArchiveBacklinkCheckState();

  const records = await getArchiveRecords();
  const filtered = getFilteredArchiveRecords(records);
  if (filtered.length === 0) {
    alert('当前筛选条件下没有可检查的历史记录。');
    return;
  }

  const checkTargets = typeof logic.selectBacklinkCheckTargets === 'function'
    ? logic.selectBacklinkCheckTargets(filtered, { limit: 500 })
    : filtered.slice(0, 500);
  if (checkTargets.length === 0) {
    alert('当前筛选条件下没有可检测的历史记录。');
    return;
  }

  archiveBacklinkCheckState = {
    active: true,
    paused: false,
    stopped: false,
    queue: checkTargets.slice(),
    running: new Map(),
    records: setArchiveRecordsChecking(records, checkTargets.map((record) => record.id)),
    total: checkTargets.length,
    startedAt: Date.now()
  };
  await saveArchiveRecords(archiveBacklinkCheckState.records);
  await renderArchive();
  updateArchiveBacklinkProgress(archiveBacklinkCheckState.records);
  setArchiveBacklinkCheckRunning(true);
  console.info('[batch][archive-check] start', {
    filteredCount: filtered.length,
    checkCount: checkTargets.length,
    concurrency: getArchiveBacklinkConcurrencyLocal(),
    retryDelayMs: getArchiveBacklinkRetryDelayMsLocal(),
    force: options.force === true,
    resetPreviousChecking: true
  });

  pumpArchiveBacklinkQueue();
}

function pumpArchiveBacklinkQueue() {
  if (!archiveBacklinkCheckState.active || archiveBacklinkCheckState.paused || archiveBacklinkCheckState.stopped) {
    setArchiveBacklinkCheckRunning(archiveBacklinkCheckState.active && !archiveBacklinkCheckState.stopped);
    return;
  }

  const concurrency = getArchiveBacklinkConcurrencyLocal();
  while (archiveBacklinkCheckState.running.size < concurrency && archiveBacklinkCheckState.queue.length > 0) {
    const record = archiveBacklinkCheckState.queue.shift();
    runArchiveBacklinkRecordCheck(record);
  }

  if (archiveBacklinkCheckState.running.size === 0 && archiveBacklinkCheckState.queue.length === 0) {
    finishArchiveBacklinkCheck('completed');
  } else {
    setArchiveBacklinkCheckRunning(true);
  }
}

async function runArchiveBacklinkRecordCheck(record) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  archiveBacklinkCheckState.running.set(String(record.id), controller);

  try {
    const response = await fetch(`${API_BASE}/backlink-checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        retryCount: 1,
        retryDelayMs: getArchiveBacklinkRetryDelayMsLocal(),
        records: [{
          id: record.id,
          sourceUrl: record.sourceUrl || record.url || '',
          promotionWebsiteUrl: record.promotionWebsiteUrl || '',
          previousBacklinkStatus: record.latestBacklinkStatus || ''
        }]
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    }

    const logic = getBatchResultsLogic();
    archiveBacklinkCheckState.records = logic.mergeBacklinkCheckResults(
      archiveBacklinkCheckState.records,
      payload.results || []
    );
    await saveArchiveRecords(archiveBacklinkCheckState.records);
    await renderArchive();
    updateArchiveBacklinkProgress(archiveBacklinkCheckState.records);
    console.info('[batch][archive-check] complete', {
      id: record.id,
      checkedCount: (payload.results || []).length
    });
  } catch (error) {
    if (archiveBacklinkCheckState.stopped && error && error.name === 'AbortError') {
      return;
    }
    const fallback = {
      id: record.id,
      latestBacklinkStatus: 'error',
      latestBacklinkCheckedAt: new Date().toISOString(),
      latestBacklinkMatchedHref: '',
      latestBacklinkReason: error && error.message ? error.message : 'unknown_error'
    };
    const logic = getBatchResultsLogic();
    archiveBacklinkCheckState.records = logic.mergeBacklinkCheckResults(archiveBacklinkCheckState.records, [fallback]);
    await saveArchiveRecords(archiveBacklinkCheckState.records);
    await renderArchive();
    updateArchiveBacklinkProgress(archiveBacklinkCheckState.records);
    console.warn('[batch][archive-check] record failed:', {
      id: record.id,
      error: fallback.latestBacklinkReason
    });
  } finally {
    archiveBacklinkCheckState.running.delete(String(record.id));
    pumpArchiveBacklinkQueue();
  }
}

function toggleArchiveBacklinkPause() {
  if (!archiveBacklinkCheckState.active) return;
  archiveBacklinkCheckState.paused = !archiveBacklinkCheckState.paused;
  setArchiveBacklinkCheckRunning(true);
  updateArchiveBacklinkProgress(archiveBacklinkCheckState.records);
  console.info('[batch][archive-check] state', {
    action: archiveBacklinkCheckState.paused ? 'pause' : 'resume',
    total: archiveBacklinkCheckState.total,
    queue: archiveBacklinkCheckState.queue.length,
    running: archiveBacklinkCheckState.running.size
  });
  if (!archiveBacklinkCheckState.paused) pumpArchiveBacklinkQueue();
}

async function stopArchiveBacklinkCheck() {
  if (!archiveBacklinkCheckState.active) return;
  archiveBacklinkCheckState.stopped = true;
  archiveBacklinkCheckState.paused = false;
  for (const controller of archiveBacklinkCheckState.running.values()) {
    try { controller.abort(); } catch (_) {}
  }
  archiveBacklinkCheckState.queue = [];
  archiveBacklinkCheckState.records = clearArchiveCheckingStatus(archiveBacklinkCheckState.records);
  await saveArchiveRecords(archiveBacklinkCheckState.records);
  await renderArchive();
  console.info('[batch][archive-check] state', {
    action: 'stop',
    total: archiveBacklinkCheckState.total,
    queue: 0,
    running: archiveBacklinkCheckState.running.size
  });
  finishArchiveBacklinkCheck('stopped');
}

function finishArchiveBacklinkCheck(reason) {
  archiveBacklinkCheckState.active = false;
  archiveBacklinkCheckState.paused = false;
  archiveBacklinkCheckState.stopped = reason === 'stopped';
  setArchiveBacklinkCheckRunning(false);
  updateArchiveBacklinkProgress(archiveBacklinkCheckState.records);
  updateArchiveActionButtons(archiveBacklinkCheckState.records, getCurrentArchiveFilters().websiteKey);
  console.info('[batch][archive-check] finished', {
    reason,
    total: archiveBacklinkCheckState.total,
    elapsedMs: Date.now() - archiveBacklinkCheckState.startedAt
  });
}

async function clearBatch() {
  if (status === 'running') return;
  const logic = getBatchResultsLogic();
  const currentBatchId = batchId;
  const resultCount = localResults.length;
  if (resultCount === 0 && !currentBatchId) {
    alert('No current batch results to clear.');
    return;
  }
  if (!confirm(`Clear current batch results (${resultCount} record(s))? Uploaded CSV and archive records will be kept.`)) {
    return;
  }

  let runtimeCleanup = null;
  if (logic && currentBatchId) {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(['batchResults', 'batchReportedUrls'], resolve);
    });
    runtimeCleanup = logic.removeCurrentBatchReportedState({
      batchId: currentBatchId,
      batchResults: Array.isArray(data.batchResults) ? data.batchResults : [],
      batchReportedUrls: Array.isArray(data.batchReportedUrls) ? data.batchReportedUrls : []
    });
    await new Promise((resolve) => {
      chrome.storage.local.set({
        batchResults: runtimeCleanup.batchResults,
        batchReportedUrls: runtimeCleanup.batchReportedUrls
      }, resolve);
    });
  }

  batchId = null;
  totalCount = successCount = failCount = skippedCount = noCommentBoxCount = manualRequiredCount = blockedIllegalCount = pendingCount = 0;
  batchStartedAt = 0;
  currentIndex = 0;
  localResults = [];
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  isTerminated = false;
  isOpeningTab = false;
  statsTableBody.innerHTML = '';
  statsTotal.textContent = '0';
  statsSuccess.textContent = '0';
  statsSkipped.textContent = '0';
  if (statsManualRequired) statsManualRequired.textContent = '0';
  statsNoCommentBox.textContent = '0';
  statsFail.textContent = '0';
  statsRate.textContent = '--';
  activeResultsView = archiveHasRecords ? 'archive' : 'current';
  updateResultsVisibility();
  filterDomain.innerHTML = '<option value="all">全部域名</option>';
  filterResult.value = 'all';
  filterTimeRange.value = 'all';
  filterKeyword.value = '';
  setStatus('idle');
  updateUI();
  renderArchive();
  chrome.storage.local.remove(['batchLocalResults', BATCH_RUNTIME_STATE_KEY, BATCH_PENDING_TASK_KEY, 'batchCtx', 'batchSubmitCtx']);
  console.log('[batch][results] cleared current batch', {
    batchId: currentBatchId,
    localResultCount: resultCount,
    removedBatchResultCount: runtimeCleanup ? runtimeCleanup.removedBatchResultCount : 0,
    removedReportedCount: runtimeCleanup ? runtimeCleanup.removedReportedCount : 0
  });
}

function getArchiveWebsiteLabel(records, websiteKey) {
  const match = (Array.isArray(records) ? records : []).find((record) => {
    const key = record.promotionWebsiteKey || normalizePromotionWebsiteKey(record.promotionWebsiteUrl);
    return key === websiteKey;
  });
  return (match && match.promotionWebsiteUrl) || websiteKey || '';
}

async function deleteSelectedArchiveWebsiteRecords() {
  const logic = getBatchResultsLogic();
  if (!logic) {
    alert('Delete helper is not loaded. Please reload the extension.');
    return;
  }
  const selectedWebsite = archiveWebsiteFilter ? (archiveWebsiteFilter.value || 'all') : 'all';
  if (!selectedWebsite || selectedWebsite === 'all') {
    alert('Please select one promotion website first.');
    return;
  }

  const data = await new Promise((resolve) => {
    chrome.storage.local.get([BACKLINK_ARCHIVE_KEY, 'batchResults', 'batchReportedUrls'], resolve);
  });
  const archiveRecords = Array.isArray(data[BACKLINK_ARCHIVE_KEY]) ? data[BACKLINK_ARCHIVE_KEY] : [];
  const batchResults = Array.isArray(data.batchResults) ? data.batchResults : [];
  const batchReportedUrls = Array.isArray(data.batchReportedUrls) ? data.batchReportedUrls : [];
  const websiteLabel = getArchiveWebsiteLabel(archiveRecords, selectedWebsite);
  const matchingArchiveCount = archiveRecords.filter((record) => {
    const key = record.promotionWebsiteKey || normalizePromotionWebsiteKey(record.promotionWebsiteUrl);
    return key === selectedWebsite;
  }).length;

  if (matchingArchiveCount === 0) {
    alert('No records found for the selected promotion website.');
    return;
  }
  if (!confirm(`Delete all records for this promotion website?\n\n${websiteLabel}\n\nArchive records: ${matchingArchiveCount}`)) {
    return;
  }

  const cleanup = logic.deletePromotionWebsiteRecords({
    websiteKey: selectedWebsite,
    archiveRecords,
    batchResults,
    batchReportedUrls
  });
  await new Promise((resolve) => {
    chrome.storage.local.set({
      [BACKLINK_ARCHIVE_KEY]: cleanup.archiveRecords,
      batchResults: cleanup.batchResults,
      batchReportedUrls: cleanup.batchReportedUrls
    }, resolve);
  });

  archiveWebsiteSelectionTouched = false;
  await renderArchive();
  updateResultsVisibility();
  console.log('[batch][results] deleted promotion website records', {
    websiteKey: selectedWebsite,
    websiteLabel,
    removedArchiveCount: cleanup.removedArchiveCount,
    removedBatchResultCount: cleanup.removedBatchResultCount,
    removedReportedCount: cleanup.removedReportedCount
  });
}

async function deleteAllArchiveWebsiteRecords() {
  const logic = getBatchResultsLogic();
  if (!logic) {
    alert('Delete helper is not loaded. Please reload the extension.');
    return;
  }
  const data = await new Promise((resolve) => {
    chrome.storage.local.get([BACKLINK_ARCHIVE_KEY, 'batchResults', 'batchReportedUrls'], resolve);
  });
  const archiveRecords = Array.isArray(data[BACKLINK_ARCHIVE_KEY]) ? data[BACKLINK_ARCHIVE_KEY] : [];
  const batchResults = Array.isArray(data.batchResults) ? data.batchResults : [];
  const batchReportedUrls = Array.isArray(data.batchReportedUrls) ? data.batchReportedUrls : [];
  if (archiveRecords.length === 0 && batchResults.length === 0 && batchReportedUrls.length === 0) {
    alert('No promotion records to delete.');
    return;
  }
  if (!confirm(`Delete ALL promotion website records?\n\nArchive records: ${archiveRecords.length}\nRuntime result records: ${batchResults.length}\n\nThis cannot be undone.`)) {
    return;
  }

  const cleanup = logic.deleteAllPromotionWebsiteRecords({
    archiveRecords,
    batchResults,
    batchReportedUrls
  });
  await new Promise((resolve) => {
    chrome.storage.local.set({
      [BACKLINK_ARCHIVE_KEY]: cleanup.archiveRecords,
      batchResults: cleanup.batchResults,
      batchReportedUrls: cleanup.batchReportedUrls
    }, resolve);
  });

  archiveWebsiteSelectionTouched = false;
  await renderArchive();
  updateResultsVisibility();
  console.log('[batch][results] deleted all promotion website records', {
    removedArchiveCount: cleanup.removedArchiveCount,
    removedBatchResultCount: cleanup.removedBatchResultCount,
    removedReportedCount: cleanup.removedReportedCount
  });
}

// ==================== section ====================

// Text cleanup: previous comment was mojibake.
function findPreviewRowByIndex(urlIndex) {
  const { url } = parsedUrls[urlIndex] || {};
  if (!url) return null;
  const rows = urlPreviewBody.querySelectorAll('tr');
  for (const row of rows) {
    if (row.dataset.url === url) return row;
  }
  return null;
}

function highlightPreviewRow(urlIndex, state) {
  const row = findPreviewRowByIndex(urlIndex);
  if (!row) return;
  row.classList.remove('url-processing', 'url-done-success', 'url-done-fail', 'url-done-skipped', 'url-done-blocked');
  if (state === 'processing') row.classList.add('url-processing');
  else if (state === 'success') row.classList.add('url-done-success');
  else if (state === 'fail') row.classList.add('url-done-fail');
  else if (state === 'skipped' || state === 'manual_required') row.classList.add('url-done-skipped');
  else if (state === 'blocked_illegal') row.classList.add('url-done-blocked');
}

function clearPreviewRow(urlIndex) {
  highlightPreviewRow(urlIndex, null);
}

function buildDomainOptions() {
  const domainMap = new Map();
  for (const r of localResults) {
    const domain = extractDomain(r.url);
    if (domain) domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
  }
  const select = filterDomain;
  select.innerHTML = '<option value="all">全部域名</option>';
  for (const [domain, count] of [...domainMap.entries()].sort((a, b) => b[1] - a[1])) {
    const opt = document.createElement('option');
    opt.value = domain;
    opt.textContent = `${domain} (${count})`;
    select.appendChild(opt);
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function filterTimeBucket(elapsedSecs) {
  const sel = filterTimeRange.value;
  if (sel === 'all') return true;
  if (elapsedSecs == null) return sel === '60+';
  if (sel === '0-5') return elapsedSecs <= 5;
  if (sel === '5-15') return elapsedSecs > 5 && elapsedSecs <= 15;
  if (sel === '15-30') return elapsedSecs > 15 && elapsedSecs <= 30;
  if (sel === '30-60') return elapsedSecs > 30 && elapsedSecs <= 60;
  if (sel === '60+') return elapsedSecs > 60;
  return true;
}

function renderStats() {
  if (localResults.length === 0) {
    if (statsTableWrap) statsTableWrap.style.display = 'none';
    if (currentResultsEmpty) currentResultsEmpty.style.display = 'block';
    if (statsCountLabel) statsCountLabel.textContent = '显示 0 / 0 条';
    if (activeResultsView === 'current') renderSummaryCounts([]);
    updateResultsVisibility();
    return;
  }
  if (statsTableWrap) statsTableWrap.style.display = 'block';
  if (currentResultsEmpty) currentResultsEmpty.style.display = 'none';

  if (activeResultsView === 'current') {
    renderSummaryCounts(localResults);
  }
  updateResultsVisibility();

  buildDomainOptions();

  const resultFilter = filterResult.value;
  const domainFilter = filterDomain.value;
  const kw = filterKeyword.value.trim().toLowerCase();

  const logic = getBatchResultsLogic();
  const filtered = logic && typeof logic.filterBatchResultRecords === 'function'
    ? logic.filterBatchResultRecords(localResults, {
      result: resultFilter,
      domain: domainFilter,
      keyword: kw,
      timeBucket: filterTimeBucket
    })
    : localResults.filter((r) => {
      if (domainFilter !== 'all' && extractDomain(r.url) !== domainFilter) return false;
      if (!filterTimeBucket(r.elapsed)) return false;
      return true;
    });

  statsCountLabel.textContent = `显示 ${filtered.length} / ${localResults.length} 条`;

  // Text cleanup: previous comment was mojibake.
  statsTableBody.innerHTML = '';
  for (const r of filtered) {
    const tr = document.createElement('tr');
    const display = getResultDisplayLocal(r);
    tr.className = 'url-' + display.cssClass;

    const elapsedStr = r.elapsed != null ? r.elapsed + 's' : '--';
    const timeStr = r.timestamp ? formatTime(new Date(r.timestamp)) : '--';
    const domain = extractDomain(r.url);
    const shortUrl = r.url.length > 40 ? r.url.substring(0, 37) + '...' : r.url;

    const aiCell = document.createElement('td');
    if (r.aiContent) {
      aiCell.className = 'ai-content-cell';
      aiCell.textContent = r.aiContent;
      aiCell.title = r.aiContent;
      aiCell.addEventListener('click', () => {
        aiCell.classList.toggle('expanded');
      });
    } else {
      aiCell.textContent = '--';
      aiCell.style.color = '#d1d5db';
    }
    tr.innerHTML = `
      <td style="color:#9ca3af;width:40px;text-align:center;">${r.originalIndex + 1}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.url)}">${escapeHtml(shortUrl)}</td>
      <td><span class="result-badge ${display.cssClass}" title="${escapeHtml(display.categoryText)}">${escapeHtml(display.text)}</span></td>
    `;
    tr.className = `url-${display.cssClass}`;

    const errCell = document.createElement('td');
    if (r.errorMessage) {
      errCell.className = 'error-cell';
      errCell.textContent = r.errorMessage;
      errCell.title = r.errorMessage;
    } else {
      errCell.textContent = '--';
      errCell.style.color = '#d1d5db';
    }
    tr.appendChild(errCell);
    tr.appendChild(aiCell);

    tr.innerHTML += `
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap;">${elapsedStr}</td>
      <td style="font-size:11px;color:#9ca3af;white-space:nowrap;">${timeStr}</td>
    `;
    const renderedAiCell = tr.children[4];
    if (r.aiContent && renderedAiCell) {
      renderedAiCell.addEventListener('click', () => {
        renderedAiCell.classList.toggle('expanded');
      });
    }
    attachAiContentContextMenu(renderedAiCell, r, tr);
    attachManualReviewTargetCell(tr.children[1], r, 'current', tr);

    statsTableBody.appendChild(tr);
  }

  // Text cleanup: previous comment was mojibake.
  statsTableWrap.scrollTop = 0;
}

// ==================== section ====================

/**
 * Text cleanup: previous doc line was mojibake.
 * Text cleanup: previous doc line was mojibake.
 * Text cleanup: previous doc line was mojibake.
 */
function findCommentForm(form) {
  if (!form) {
    console.log('[batch] message');
    return { success: false, missingFields: ['form not found'] };
  }

  console.log('[batch] message', {
    id: form.id,
    className: form.className,
    action: form.action
  });

  // Text cleanup: previous comment was mojibake.
  const formAllInputs = Array.from(form.querySelectorAll('input'));
  const formTextareas = Array.from(form.querySelectorAll('textarea'));
  console.log('[batch] message', formAllInputs.length, 'textarea 鏁伴噺:', formTextareas.length);
  console.log('[batch] message', formAllInputs.map(i => ({
    name: i.name, id: i.id, type: i.type, className: i.className,
    placeholder: i.placeholder, valueLen: (i.value || '').length
  })));

  // Text cleanup: previous comment was mojibake.
  let commentTextarea = null;
  if (formTextareas.length > 0) {
    // Text cleanup: previous comment was mojibake.
    commentTextarea = formTextareas.find(ta => {
      const n = (ta.name || '').toLowerCase();
      const i = (ta.id || '').toLowerCase();
      return n.includes('comment') || i.includes('comment');
    }) || formTextareas[0];
  }
  if (!commentTextarea) {
    // Text cleanup: previous comment was mojibake.
    const ta = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (ta && (ta.form === form || (ta.closest && ta.closest('form') === form))) {
      commentTextarea = ta;
    }
  }

  if (!commentTextarea) {
    console.log('[batch] message');
    return { success: false, missingFields: ['comment textarea not found'] };
  }

  return {
    success: true,
    form: form,
    commentTextarea: commentTextarea,
    formAllInputs: formAllInputs,
    formTextareas: formTextareas
  };
}

/**
 * Text cleanup: previous doc line was mojibake.
 * Text cleanup: previous doc line was mojibake.
 * Text cleanup: previous doc line was mojibake.
 * Text cleanup: previous doc line was mojibake.
 */
function findLikelyCommentTextarea(options) {
  const allowGenericFallback = options && options.allowGenericFallback;
  const allTextareas = Array.from(document.querySelectorAll('textarea'));
  if (allTextareas.length === 0) return null;

  const commentTextareas = [];

  // Text cleanup: previous comment was mojibake.
  const standardSelectors = [
    '#comment',
    'textarea[name="comment"]',
    'textarea#comment',
    'textarea[id="comment"]',
    'textarea[name="comment_content"]',
    'textarea[id="comment_content"]',
    'textarea[name="comments"]',
    'textarea#comments'
  ];

  for (const selector of standardSelectors) {
    try {
      const ta = document.querySelector(selector);
      if (ta && !commentTextareas.includes(ta)) {
        commentTextareas.push(ta);
      }
    } catch (e) {
      // Text cleanup: previous comment was mojibake.
    }
  }

  // Text cleanup: previous comment was mojibake.
  if (commentTextareas.length === 0) {
    allTextareas.forEach((ta) => {
      if (commentTextareas.includes(ta)) return;

      const name = (ta.name || '').toLowerCase();
      const id = (ta.id || '').toLowerCase();
      const placeholder = (ta.placeholder || '').toLowerCase();
      const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
      const text = `${name} ${id} ${placeholder} ${ariaLabel}`;

      const keywords = [
        'comment', 'reply', 'message', 'review', 'feedback', 'opinion',
        'leave a comment', 'write a comment', 'post a comment',
        'cancel reply', 'enter your comment', 'type here'
      ];

      if (keywords.some((k) => text.includes(k))) {
        commentTextareas.push(ta);
      }
    });
  }

  // Text cleanup: previous comment was mojibake.
  if (commentTextareas.length === 0 && allowGenericFallback && allTextareas.length > 0) {
    return allTextareas[0];
  }

  return commentTextareas.length > 0 ? commentTextareas[0] : null;
}

// ==================== section ====================
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getResultText(result) {
  const logic = getBatchResultsLogic();
  if (logic && typeof logic.getResultDisplay === 'function') {
    return logic.getResultDisplay(result).text;
  }
  switch (result) {
    case 'success': return '成功';
    case 'success_pending_moderation': return '提交成功，审核中';
    case 'skipped': return '已存在';
    case 'manual_required': return '需手动处理';
    case 'submitted_unconfirmed': return '待确认';
    case 'no_comment_box': return '无评论框';
    case 'blocked_illegal': return '非法拦截';
    case 'fail': return '失败';
    default: return result;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
