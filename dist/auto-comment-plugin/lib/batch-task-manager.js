(function initBatchTaskManager(root) {
  'use strict';

  const TASK_STATUS = new Set(['idle', 'running', 'terminated', 'completed']);
  const CHECKABLE_RESULTS = new Set([
    'success',
    'success_pending_moderation',
    'submitted_unconfirmed',
    'submitted_unconfirmed_acceptance',
    'submitted_unconfirmed_backlink',
    'submitted_unconfirmed_timeout',
    'submitted_unconfirmed_pending'
  ]);

  function safeText(value) {
    return String(value == null ? '' : value).trim();
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function getProcessedCount(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const fromResults = safeNumber(source.localResultCount || (Array.isArray(source.localResults) ? source.localResults.length : 0));
    return Math.min(safeNumber(source.totalCount), fromResults);
  }

  function buildTaskSummary(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const totalCount = safeNumber(source.totalCount);
    const processedCount = getProcessedCount(source);
    const rawStatus = safeText(source.status);
    return {
      batchId: safeText(source.batchId),
      status: TASK_STATUS.has(rawStatus) ? rawStatus : 'terminated',
      totalCount,
      processedCount,
      pendingCount: Math.max(0, totalCount - processedCount),
      successCount: safeNumber(source.successCount),
      failCount: safeNumber(source.failCount),
      skippedCount: safeNumber(source.skippedCount),
      manualRequiredCount: safeNumber(source.manualRequiredCount),
      currentPromotionProjectId: safeText(source.currentPromotionProjectId),
      currentPromotionWebsiteKey: safeText(source.currentPromotionWebsiteKey),
      currentPromotionWebsiteUrl: safeText(source.currentPromotionWebsiteUrl),
      createdAt: safeNumber(source.createdAt || source.batchStartedAt || source.updatedAt),
      updatedAt: safeNumber(source.updatedAt)
    };
  }

  function selectTaskForRestore({ tasks, currentPromotionProjectId, currentPromotionKey } = {}) {
    const projectId = safeText(currentPromotionProjectId);
    const promotionKey = safeText(currentPromotionKey);
    const rows = Array.isArray(tasks) ? tasks.filter((task) => task && safeText(task.batchId)) : [];
    const matching = rows.filter((task) => (
      (projectId && safeText(task.currentPromotionProjectId) === projectId) ||
      (!projectId && promotionKey && safeText(task.currentPromotionWebsiteKey) === promotionKey)
    ));
    return matching.sort((left, right) => safeNumber(right.updatedAt) - safeNumber(left.updatedAt))[0] || null;
  }

  function getTaskStartEligibility(tasks, currentTaskId) {
    const running = (Array.isArray(tasks) ? tasks : []).find((task) => (
      task && safeText(task.status) === 'running' && safeText(task.batchId) !== safeText(currentTaskId)
    ));
    return running
      ? { allowed: false, runningTaskId: safeText(running.batchId) }
      : { allowed: true, runningTaskId: '' };
  }

  function canDeleteTask(task) {
    return !!(task && safeText(task.batchId) && safeText(task.status) !== 'running');
  }

  function selectBacklinkCheckableRecords(records) {
    return (Array.isArray(records) ? records : []).filter((record) => (
      record && CHECKABLE_RESULTS.has(safeText(record.result))
    ));
  }

  const api = {
    buildTaskSummary,
    selectTaskForRestore,
    getTaskStartEligibility,
    canDeleteTask,
    selectBacklinkCheckableRecords
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoCommentBatchTaskManager = api;
}(typeof window !== 'undefined' ? window : globalThis));
