const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUploadDraft,
  isSameUploadDraft,
  isRestorableUploadDraft,
  buildUploadDraftViewState,
  selectUploadDraftForRestore
} = require('../lib/batch-upload-draft');

function createDraftInput(overrides = {}) {
  return {
    promotionKey: 'https://promo.test',
    importType: 'csv',
    fileName: 'sources.csv',
    fileFingerprint: 'csv:sources.csv:100:200',
    parsedUrls: [{ url: 'https://source.test/post', sourceDomain: 'source.test' }],
    display: { fileCountText: '1 URL(s)' },
    ...overrides
  };
}

test('same file fingerprint keeps the existing upload draft', () => {
  const current = buildUploadDraft(createDraftInput());
  const candidate = buildUploadDraft(createDraftInput({
    parsedUrls: [{ url: 'https://other.test/post', sourceDomain: 'other.test' }]
  }));

  assert.equal(isSameUploadDraft(current, candidate), true);
});

test('different file fingerprint replaces the prior draft candidate', () => {
  const current = buildUploadDraft(createDraftInput());
  const candidate = buildUploadDraft(createDraftInput({
    fileName: 'new-sources.csv',
    fileFingerprint: 'csv:new-sources.csv:120:300'
  }));

  assert.equal(isSameUploadDraft(current, candidate), false);
});

test('only a matching, non-empty versioned draft can be restored', () => {
  const draft = buildUploadDraft(createDraftInput());

  assert.equal(isRestorableUploadDraft(draft, 'https://promo.test'), true);
  assert.equal(isRestorableUploadDraft(draft, 'https://other-promo.test'), false);
  assert.equal(isRestorableUploadDraft({ ...draft, parsedUrls: [] }, 'https://promo.test'), false);
  assert.equal(isRestorableUploadDraft({ ...draft, version: 0 }, 'https://promo.test'), false);
});

test('restored upload draft always produces an idle view state', () => {
  const draft = buildUploadDraft(createDraftInput({ importType: 'semrush' }));
  const state = buildUploadDraftViewState(draft);

  assert.equal(state.status, 'idle');
  assert.equal(state.importType, 'semrush');
  assert.deepEqual(state.parsedUrls, draft.parsedUrls);
  assert.equal(state.display.fileCountText, '1 URL(s)');
});

test('restores the draft bound to the active promotion project first', () => {
  const projectDraft = buildUploadDraft(createDraftInput({ promotionProjectId: 'project-a' }));
  const latestDraft = buildUploadDraft(createDraftInput({
    promotionProjectId: 'project-b',
    fileName: 'project-b.csv'
  }));

  const selection = selectUploadDraftForRestore({
    projectDraft,
    latestDraft,
    currentPromotionProjectId: 'project-a',
    currentPromotionKey: 'https://promo.test'
  });

  assert.equal(selection.draft.fileName, 'sources.csv');
  assert.equal(selection.source, 'project');
  assert.equal(selection.requiresConfirmation, false);
});

test('uses the latest draft when the active promotion project is temporarily unavailable', () => {
  const latestDraft = buildUploadDraft(createDraftInput({ promotionProjectId: 'project-a' }));

  const selection = selectUploadDraftForRestore({
    latestDraft,
    currentPromotionProjectId: '',
    currentPromotionKey: ''
  });

  assert.equal(selection.draft.fileName, 'sources.csv');
  assert.equal(selection.source, 'latest');
  assert.equal(selection.requiresConfirmation, false);
});

test('requires confirmation before restoring a latest draft for a different active project', () => {
  const latestDraft = buildUploadDraft(createDraftInput({ promotionProjectId: 'project-a' }));

  const selection = selectUploadDraftForRestore({
    latestDraft,
    currentPromotionProjectId: 'project-b',
    currentPromotionKey: 'https://other-promo.test'
  });

  assert.equal(selection.draft.fileName, 'sources.csv');
  assert.equal(selection.requiresConfirmation, true);
});
