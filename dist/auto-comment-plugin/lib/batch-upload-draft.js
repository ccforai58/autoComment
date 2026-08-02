(function initBatchUploadDraft(root) {
  'use strict';

  const DRAFT_VERSION = 1;

  function safeText(value) {
    return String(value == null ? '' : value).trim();
  }

  function buildUploadDraft(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      version: DRAFT_VERSION,
      promotionProjectId: safeText(source.promotionProjectId),
      promotionKey: safeText(source.promotionKey),
      importType: safeText(source.importType),
      fileName: safeText(source.fileName),
      fileFingerprint: safeText(source.fileFingerprint),
      parsedUrls: Array.isArray(source.parsedUrls) ? source.parsedUrls : [],
      display: source.display && typeof source.display === 'object' ? source.display : {},
      savedAt: Number(source.savedAt) || Date.now()
    };
  }

  function isSameUploadDraft(current, candidate) {
    if (!current || !candidate) return false;
    const currentFingerprint = safeText(current.fileFingerprint);
    const candidateFingerprint = safeText(candidate.fileFingerprint);
    return !!currentFingerprint &&
      currentFingerprint === candidateFingerprint &&
      safeText(current.promotionKey) === safeText(candidate.promotionKey) &&
      safeText(current.importType) === safeText(candidate.importType);
  }

  function isRestorableUploadDraft(draft, promotionKey) {
    return !!draft &&
      Number(draft.version) === DRAFT_VERSION &&
      safeText(draft.promotionKey) === safeText(promotionKey) &&
      Array.isArray(draft.parsedUrls) &&
      draft.parsedUrls.length > 0;
  }

  function buildUploadDraftViewState(draft) {
    return {
      status: 'idle',
      importType: safeText(draft && draft.importType),
      fileName: safeText(draft && draft.fileName),
      parsedUrls: Array.isArray(draft && draft.parsedUrls) ? draft.parsedUrls : [],
      display: draft && draft.display && typeof draft.display === 'object' ? draft.display : {}
    };
  }

  function hasRestorableItems(draft) {
    return !!draft &&
      Number(draft.version) === DRAFT_VERSION &&
      Array.isArray(draft.parsedUrls) &&
      draft.parsedUrls.length > 0;
  }

  function selectUploadDraftForRestore({ projectDraft, urlDraft, latestDraft, currentPromotionProjectId, currentPromotionKey } = {}) {
    const currentProjectId = safeText(currentPromotionProjectId);
    const currentKey = safeText(currentPromotionKey);
    const candidates = [
      { draft: projectDraft, source: 'project' },
      { draft: urlDraft, source: 'url' },
      { draft: latestDraft, source: 'latest' }
    ];
    const selected = candidates.find((candidate) => hasRestorableItems(candidate.draft));
    if (!selected) return { draft: null, source: '', requiresConfirmation: false };

    const draftProjectId = safeText(selected.draft.promotionProjectId);
    const draftKey = safeText(selected.draft.promotionKey);
    const projectMismatch = !!(currentProjectId && draftProjectId && currentProjectId !== draftProjectId);
    const keyMismatch = !draftProjectId && !!(currentKey && draftKey && currentKey !== draftKey);
    return {
      ...selected,
      requiresConfirmation: projectMismatch || keyMismatch
    };
  }

  const api = {
    DRAFT_VERSION,
    buildUploadDraft,
    isSameUploadDraft,
    isRestorableUploadDraft,
    buildUploadDraftViewState,
    selectUploadDraftForRestore
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoCommentBatchUploadDraft = api;
}(typeof window !== 'undefined' ? window : globalThis));
