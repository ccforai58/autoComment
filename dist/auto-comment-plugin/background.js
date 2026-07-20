// 点击扩展图标时，在当前标签页内打开/关闭浮动窗口
let normalizeBatchConfirmMessage;
try {
  ({ normalizeBatchConfirmMessage } = require('./lib/batch-submit-logic'));
} catch (_) {
  normalizeBatchConfirmMessage = function fallbackNormalizeBatchConfirmMessage(message) {
    const source = message && typeof message === 'object' ? message : {};
    const incomingResult = String(source.result || '').trim();
    const confirmedBy = String(source.confirmedBy || '').trim();
    const strictSuccess = (incomingResult === 'success' || incomingResult === 'success_pending_moderation') &&
      confirmedBy === 'submit-confirmed-v3';
    if (strictSuccess) {
      return {
        result: incomingResult,
        errorMessage: source.errorMessage || null,
        isStrictSuccess: true
      };
    }
    if (incomingResult === 'submitted_unconfirmed') {
      return {
        result: 'submitted_unconfirmed',
        errorMessage: source.errorMessage || 'submit triggered but no acceptance signal',
        isStrictSuccess: false
      };
    }
    if (incomingResult && incomingResult !== 'success') {
      return {
        result: incomingResult,
        errorMessage: source.errorMessage || null,
        isStrictSuccess: false
      };
    }
    return {
      result: 'fail',
      errorMessage: source.errorMessage
        ? source.errorMessage
        : (confirmedBy === 'submit-confirmed-v3' ? 'missing explicit success result' : 'missing batch result'),
      isStrictSuccess: false
    };
  };
}

const DEBUG_LOG_API = 'http://127.0.0.1:3000/api/debug-log';
const USER_ID_STORAGE_KEY = 'auto_comment_user_id';
const DEFAULT_LOCAL_USER_ID = 'local-user';

function ensureDefaultUserId() {
  try {
    chrome.storage.sync.get([USER_ID_STORAGE_KEY], (data) => {
      const current = data && typeof data[USER_ID_STORAGE_KEY] === 'string'
        ? data[USER_ID_STORAGE_KEY].trim()
        : '';
      if (current) return;
      chrome.storage.sync.set({ [USER_ID_STORAGE_KEY]: DEFAULT_LOCAL_USER_ID }, () => {
        const error = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
        if (error) {
          console.warn('[background][config] default user id init failed', { error });
          return;
        }
        console.info('[background][config] default user id initialized', { userId: DEFAULT_LOCAL_USER_ID });
      });
    });
  } catch (error) {
    console.warn('[background][config] default user id init exception', {
      message: error && error.message ? error.message : String(error)
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultUserId();
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaultUserId();
});

ensureDefaultUserId();

function sendLocalDebugLog(source, payload) {
  try {
    fetch(DEBUG_LOG_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, payload }),
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('batch.html') });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'OPEN_LINK_ASSISTANT_SETTINGS') {
    const url = chrome.runtime.getURL('link-assistant-settings.html');
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
      if (error) {
        console.warn('[background][manual-assistant] open settings failed', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          error
        });
        sendResponse({ ok: false, error });
        return;
      }
      console.info('[background][manual-assistant] opened promotion settings', {
        senderTabId: sender && sender.tab ? sender.tab.id : null,
        tabId: tab && tab.id ? tab.id : null
      });
      sendResponse({ ok: true, tabId: tab && tab.id ? tab.id : null });
    });
    return true;
  }
  if (message && message.type === 'OPEN_RESOURCE_LIBRARY') {
    const url = chrome.runtime.getURL('resource-library.html');
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
      if (error) {
        console.warn('[background][manual-assistant] open resource library failed', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          error
        });
        sendResponse({ ok: false, error });
        return;
      }
      console.info('[background][manual-assistant] opened resource library', {
        senderTabId: sender && sender.tab ? sender.tab.id : null,
        tabId: tab && tab.id ? tab.id : null
      });
      sendResponse({ ok: true, tabId: tab && tab.id ? tab.id : null });
    });
    return true;
  }
  if (message && message.type === 'OPEN_BATCH_ARCHIVE') {
    const url = chrome.runtime.getURL('batch.html#archive');
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
      if (error) {
        console.warn('[background][manual-assistant] open batch archive failed', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          error
        });
        sendResponse({ ok: false, error });
        return;
      }
      console.info('[background][manual-assistant] opened batch archive', {
        senderTabId: sender && sender.tab ? sender.tab.id : null,
        tabId: tab && tab.id ? tab.id : null
      });
      sendResponse({ ok: true, tabId: tab && tab.id ? tab.id : null });
    });
    return true;
  }
  if (message && message.type === 'OPEN_MANUAL_SUBMISSION_RECORDS') {
    const url = chrome.runtime.getURL('batch.html#manual-records');
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
      if (error) {
        console.warn('[background][manual-assistant] open manual submission records failed', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          error
        });
        sendResponse({ ok: false, error });
        return;
      }
      console.info('[background][manual-assistant] opened manual submission records', {
        senderTabId: sender && sender.tab ? sender.tab.id : null,
        tabId: tab && tab.id ? tab.id : null
      });
      sendResponse({ ok: true, tabId: tab && tab.id ? tab.id : null });
    });
    return true;
  }
});

/**
 * 将批量结果写入 storage（本地存储，由 batch.js 轮询读取）
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'LINK_ASSISTANT_API_REQUEST') {
    (async () => {
      const startedAt = Date.now();
      try {
        const apiBase = String(message.apiBase || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');
        const path = String(message.path || '');
        if (!/^https?:\/\/(127\.0\.0\.1|localhost):3000\/api$/i.test(apiBase)) {
          throw new Error('unsupported_api_base');
        }
        if (!path.startsWith('/')) {
          throw new Error('invalid_api_path');
        }
        const options = message.options && typeof message.options === 'object' ? message.options : {};
        const headers = options.headers && typeof options.headers === 'object' ? { ...options.headers } : {};
        const response = await fetch(`${apiBase}${path}`, {
          method: options.method || 'GET',
          headers,
          body: options.body
        });
        const text = await response.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_) {}
        console.info('[background][link-assistant-api] request complete', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          path,
          method: options.method || 'GET',
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - startedAt
        });
        sendResponse({
          success: true,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          json,
          text: json ? '' : text
        });
      } catch (error) {
        console.warn('[background][link-assistant-api] request failed', {
          senderTabId: sender && sender.tab ? sender.tab.id : null,
          path: message && message.path ? String(message.path) : '',
          message: error && error.message ? error.message : String(error),
          durationMs: Date.now() - startedAt
        });
        sendResponse({
          success: false,
          ok: false,
          status: 0,
          error: error && error.message ? error.message : String(error)
        });
      }
    })();
    return true;
  }
});

async function persistBatchReport(message) {
  const { batchId, urlIndex, url: pageUrl = '', result, aiContent, errorMessage, promotionWebsiteUrl = '', promotionWebsiteKey = '', copyPromotionWebsiteKey = '', confirmedBy = '', confirmedAt = null, linkVerified = false, matchedHref = '', linkVerification = null } = message;
  console.log('[background] persistBatchReport >>>', { batchId, urlIndex, url: pageUrl, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage, time: new Date().toISOString() });

  const data = await chrome.storage.local.get(['batchResults', 'batchReportedUrls']);
  const results = Array.isArray(data.batchResults) ? data.batchResults : [];
  const entry = {
    batchId,
    urlIndex,
    url: pageUrl,
    result,
    aiContent,
    errorMessage,
    promotionWebsiteUrl,
    promotionWebsiteKey,
    copyPromotionWebsiteKey,
    linkVerified: !!linkVerified,
    matchedHref: matchedHref || '',
    linkVerification: linkVerification || null,
    timestamp: Date.now()
  };
  if ((result === 'success' || result === 'success_pending_moderation') && confirmedBy === 'submit-confirmed-v3') {
    entry.confirmedBy = confirmedBy;
    entry.confirmedAt = confirmedAt || entry.timestamp;
  }
  const existingIndex = results.findIndex((item) => item.batchId === batchId && item.urlIndex === urlIndex);
  if (existingIndex >= 0) {
    results[existingIndex] = { ...results[existingIndex], ...entry };
  } else {
    results.push(entry);
  }
  if (results.length > 100) results.shift();

  let reported = data.batchReportedUrls || [];
  if (!Array.isArray(reported)) reported = [];
  const urlKey = `${batchId}:${urlIndex}`;
  if (!reported.includes(urlKey)) {
    reported.push(urlKey);
    if (reported.length > 500) reported.shift();
  }

  await chrome.storage.local.set({ batchResults: results, batchReportedUrls: reported });
  console.log('[background] persistBatchReport <<< 写入完成, 当前results长度:', results.length, 'time:', new Date().toISOString());
}

// content.js 确认评论已提交（标签页可能刷新，context 丢失，background 仍活着）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'BATCH_HANDLE_CONFIRM') {
    console.log('[background] 收到 BATCH_HANDLE_CONFIRM >>>', { batchId: message.batchId, urlIndex: message.urlIndex, url: message.url, aiContentLen: message.aiContent ? message.aiContent.length : 0, sender: sender.tab ? sender.tab.id : 'N/A', time: new Date().toISOString() });
    (async () => {
      try {
        const normalized = normalizeBatchConfirmMessage
          ? normalizeBatchConfirmMessage(message)
          : {
              result: message.result || 'fail',
              errorMessage: message.errorMessage || null,
              isStrictSuccess: message.result === 'success' && message.confirmedBy === 'submit-confirmed-v3'
            };
        const normalizedResult = normalized.result;
        const normalizedError = normalized.errorMessage;
        const normalizeLog = {
          batchId: message.batchId,
          urlIndex: message.urlIndex,
          incomingResult: message.result || '',
          normalizedResult,
          isStrictSuccess: normalized.isStrictSuccess,
          errorMessage: normalizedError
        };
        console.log('[background][batch-confirm][normalize]', normalizeLog);
        sendLocalDebugLog('background', { stage: 'batch-confirm.normalize', ...normalizeLog });
        await persistBatchReport({
          batchId: message.batchId,
          urlIndex: message.urlIndex,
          url: message.url || '',
          result: normalizedResult,
          aiContent: message.aiContent || null,
          promotionWebsiteUrl: message.promotionWebsiteUrl || '',
          promotionWebsiteKey: message.promotionWebsiteKey || '',
          copyPromotionWebsiteKey: message.copyPromotionWebsiteKey || '',
          errorMessage: normalizedError,
          confirmedBy: message.confirmedBy || '',
          confirmedAt: message.confirmedAt || null,
          linkVerified: !!message.linkVerified,
          matchedHref: message.matchedHref || '',
          linkVerification: message.linkVerification || null
        });
        console.log('[background] persistBatchReport 完成，准备发送 BATCH_CONFIRMED');

        // 关键：先通知 batch.js（popup）落盘已完成，batch.js 等到确认后才关闭标签页
        // 再转发给 popup（batch.js），确保 batch.js 收到后再关 tab
        chrome.runtime.sendMessage({
          type: 'BATCH_CONFIRMED',
          urlIndex: message.urlIndex,
          result: normalizedResult,
          aiContent: message.aiContent || null,
          errorMessage: normalizedError,
          promotionWebsiteUrl: message.promotionWebsiteUrl || '',
          promotionWebsiteKey: message.promotionWebsiteKey || '',
          copyPromotionWebsiteKey: message.copyPromotionWebsiteKey || '',
          linkVerified: !!message.linkVerified,
          matchedHref: message.matchedHref || '',
          linkVerification: message.linkVerification || null
        }).then(() => {
          console.log('[background] BATCH_CONFIRMED 发送成功');
        }).catch((e) => {
          if (e.message && e.message.includes('message channel closed')) {
            console.log('[background] BATCH_CONFIRMED 发送失败（接收方已关闭），忽略');
          } else {
            console.error('[background] BATCH_CONFIRMED 发送失败:', e);
          }
        });

        sendResponse({ ok: true });
        console.log('[background] BATCH_HANDLE_CONFIRM <<< sendResponse({ok:true})');
      } catch (e) {
        console.error('[background] BATCH_HANDLE_CONFIRM 错误:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

// 批量任务结果：content / batch 页 -> background 持久化
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'BATCH_REPORT_RESULT') {
    console.log('[background] 收到 BATCH_REPORT_RESULT >>>', { batchId: message.batchId, urlIndex: message.urlIndex, result: message.result, sender: sender.tab ? sender.tab.id : 'N/A', time: new Date().toISOString() });
    (async () => {
      try {
        await persistBatchReport(message);
        console.log('[background] BATCH_REPORT_RESULT <<< sendResponse({ok:true})');
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[background] BATCH_REPORT_RESULT 错误:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
