(function initBatchAutoSubmitGuard(root) {
  'use strict';

  const COUNTED_RESULTS = new Set(['success', 'success_pending_moderation', 'submitted_unconfirmed']);

  function shouldScheduleAutoSubmitInterval(result) {
    return COUNTED_RESULTS.has(String(result || '').trim());
  }

  function isCountedAutoSubmitResult(record) {
    const source = record && typeof record === 'object' ? record : {};
    return String(source.submitSource || source.submit_source || '') === 'batch_auto' &&
      COUNTED_RESULTS.has(String(source.result || source.submitResult || source.submit_result || ''));
  }

  function getLocalDayKey(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function countTodayAutoSubmissions(records, { promotionWebsiteKey, now = Date.now() } = {}) {
    const today = getLocalDayKey(now);
    return (Array.isArray(records) ? records : []).filter((record) =>
      isCountedAutoSubmitResult(record) &&
      String(record.promotionWebsiteKey || record.promotion_website_key || '') === String(promotionWebsiteKey || '') &&
      getLocalDayKey(record.timestamp || record.createdAt || record.created_at) === today
    ).length;
  }

  function getConfirmationCheckpoint(count, checkpointSize) {
    const safeCount = Math.max(0, Number(count) || 0);
    const safeSize = Math.max(1, Math.floor(Number(checkpointSize) || 0));
    return safeCount > 0 && safeCount % safeSize === 0 ? safeCount : 0;
  }

  function validateAutoSubmitGuardSettings({ enabled, minMinutes, maxMinutes, timeoutSeconds } = {}) {
    if (!enabled) return { valid: true, minMinutes: Number(minMinutes) || 0, maxMinutes: Number(maxMinutes) || 0 };
    const min = Number(minMinutes);
    const max = Number(maxMinutes);
    const timeout = Number(timeoutSeconds);
    const minimumAllowed = Math.floor(Math.max(0, timeout) / 60) + 1;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < minimumAllowed || max < min) {
      return { valid: false, minimumAllowedMinutes: minimumAllowed };
    }
    return { valid: true, minMinutes: min, maxMinutes: max, minimumAllowedMinutes: minimumAllowed };
  }

  function createRandomWaitMs({ minMinutes, maxMinutes, random = Math.random } = {}) {
    const min = Math.max(0, Math.ceil(Number(minMinutes) || 0));
    const max = Math.max(min, Math.floor(Number(maxMinutes) || min));
    const value = min + Math.floor(Math.max(0, Math.min(0.999999999, Number(random()))) * (max - min + 1));
    return value * 60 * 1000;
  }

  const api = { isCountedAutoSubmitResult, countTodayAutoSubmissions, getConfirmationCheckpoint, validateAutoSubmitGuardSettings, createRandomWaitMs, shouldScheduleAutoSubmitInterval };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoCommentBatchAutoSubmitGuard = api;
}(typeof window !== 'undefined' ? window : globalThis));
