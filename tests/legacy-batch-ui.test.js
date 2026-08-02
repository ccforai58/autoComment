const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('batch page keeps timeout control but removes legacy automation and points UI', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(page, /id=["']timeoutInput["']/);
  assert.match(script, /TIMEOUT_STORAGE_KEY/);
  for (const identifier of ['batchAutoOpenPanel', 'batchAutoGenerate', 'batchAutoSubmit', 'pointsBalance', 'costHint']) {
    assert.doesNotMatch(script, new RegExp(identifier));
    assert.doesNotMatch(page, new RegExp(identifier));
  }
  assert.match(script, /if \(statusBadge\) \{/);
});

test('content script explicitly disables legacy page-load and auto-submit settings', () => {
  const script = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  for (const identifier of ['getAutoOpenQwenPanelSetting', 'getAutoGenerateQwenOnPageLoadSetting', 'getAutoSubmitCommentSetting']) {
    assert.match(script, new RegExp(`function ${identifier}\\(\\) \\{[\\s\\S]{0,160}return Promise\\.resolve\\(false\\)`));
  }
});

test('progress-only floating panel does not repeat its header title in the body', () => {
  const script = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const progressPaneBlock = script.match(/const progressPane = document\.createElement\('div'\);[\s\S]*?panel\.appendChild\(progressPane\);/);

  assert.ok(progressPaneBlock);
  assert.doesNotMatch(progressPaneBlock[0], /progressTitle/);
});

test('distributed content script keeps the progress panel title-free', () => {
  const script = fs.readFileSync(path.join(root, 'dist', 'auto-comment-plugin', 'content.js'), 'utf8');
  const progressPaneBlock = script.match(/const progressPane = document\.createElement\('div'\);[\s\S]*?panel\.appendChild\(progressPane\);/);

  assert.ok(progressPaneBlock);
  assert.doesNotMatch(progressPaneBlock[0], /progressTitle/);
});

test('distributed plugin includes the current batch interval runtime', () => {
  const distRoot = path.join(root, 'dist', 'auto-comment-plugin');
  const batchScript = fs.readFileSync(path.join(distRoot, 'batch.js'), 'utf8');

  assert.match(batchScript, /shouldScheduleAutoSubmitInterval\(result\)/);
  assert.ok(fs.existsSync(path.join(distRoot, 'lib', 'batch-auto-submit-guard.js')));
  assert.ok(fs.existsSync(path.join(distRoot, 'lib', 'batch-task-manager.js')));
  assert.ok(fs.existsSync(path.join(distRoot, 'lib', 'batch-upload-draft.js')));
});

test('batch page loads upload draft logic before batch runtime code', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');

  assert.match(page, /<script src="lib\/batch-upload-draft\.js"><\/script>[\s\S]*<script src="batch\.js"><\/script>/);
});

test('batch runtime persists, restores, and clears pending upload drafts', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(script, /BATCH_UPLOAD_DRAFT_PREFIX/);
  assert.match(script, /function saveUploadDraft\(/);
  assert.match(script, /function restoreUploadDraft\(/);
  assert.match(script, /function clearUploadDraft\(/);
  assert.match(script, /await restoreUploadDraft\(\)/);
  assert.match(script, /await saveUploadDraft\(/);
  assert.match(script, /await clearUploadDraft\(\)/);
});

test('invalid CSV parsing leaves the prior pending upload intact', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.doesNotMatch(
    script,
    /if \(colUrl === -1\) \{[\s\S]{0,220}await resetFile\(\)/
  );
});

test('ordinary CSV import clears its file selection after handling', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');
  const parseCsvBlock = script.match(/async function parseCSV\([\s\S]*?async function processSemrushFile/);

  assert.ok(parseCsvBlock);
  assert.match(parseCsvBlock[0], /if \(fileInput\) fileInput\.value = '';/);
});

test('batch page exposes configurable auto-submit guard controls and compact progress activity', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');

  for (const id of ['autoSubmitCheckpoint', 'autoSubmitIntervalEnabled', 'autoSubmitIntervalMin', 'autoSubmitIntervalMax', 'progressActivity']) {
    assert.match(page, new RegExp(`id=["']${id}["']`));
  }
  assert.match(page, /lib\/batch-auto-submit-guard\.js/);
});

test('batch page shows the current promotion daily auto-submit progress', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(page, /id=["']dailyAutoSubmitProgress["']/);
  assert.match(script, /function refreshDailyAutoSubmitProgress\(/);
  assert.match(script, /getTodayAutoSubmitCount\(\)/);
});

test('batch runtime supports disabling the random interval and preserving its wait state', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(script, /AUTO_SUBMIT_GUARD_SETTINGS_KEY/);
  assert.match(script, /function loadAutoSubmitGuardSettings\(/);
  assert.match(script, /function scheduleNextAutoSubmit\(/);
  assert.match(script, /autoSubmitIntervalEnabled\.checked/);
  assert.match(script, /nextAutoSubmitAt/);
  assert.match(script, /progressActivity\.textContent/);
  const handleResultBlock = script.match(/function handleTabResult\([\s\S]*?function handleTabConfirmed/);
  assert.ok(handleResultBlock);
  assert.match(handleResultBlock[0], /shouldScheduleAutoSubmitInterval\(result\)/);
});

test('imported file information uses separate filename and result rows', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');

  assert.match(page, /class=["']file-details["']/);
  assert.match(page, /class=["']file-name["'][\s\S]*class=["']file-count["']/);
  assert.match(page, /\.file-info\s*\{[\s\S]{0,180}align-items:\s*flex-start/);
  assert.match(page, /\.file-details\s*\{[\s\S]{0,180}min-width:\s*0/);
  assert.match(page, /\.file-name\s*\{[\s\S]{0,220}overflow:\s*hidden/);
});

test('batch runtime stores drafts by promotion project with a latest-draft fallback', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(script, /BATCH_UPLOAD_DRAFT_PROJECT_PREFIX/);
  assert.match(script, /BATCH_UPLOAD_DRAFT_LATEST_KEY/);
  assert.match(script, /promotionProjectId/);
  assert.match(script, /selectUploadDraftForRestore/);
  assert.match(script, /requiresConfirmation/);
});

test('batch page provides a task list backed by independent task snapshots', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  assert.match(page, /id=["']taskList["']/);
  assert.match(page, /id=["']taskListEmpty["']/);
  assert.match(page, /lib\/batch-task-manager\.js/);
  assert.match(script, /BATCH_TASK_REGISTRY_KEY/);
  assert.match(script, /function renderTaskList\(/);
  assert.match(script, /function restoreTaskSnapshot\(/);
  assert.match(script, /function deleteStoredTask\(/);
});

test('deleting a task also clears its runtime restore snapshots', () => {
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');
  const deleteTaskBlock = script.match(/async function deleteStoredTask\([\s\S]*?async function loadUserId/);

  assert.ok(deleteTaskBlock);
  assert.match(deleteTaskBlock[0], /selectCurrentBatchStorageKeysForRemoval/);
  assert.match(deleteTaskBlock[0], /BATCH_RUNTIME_STATE_BY_PROMOTION_KEY/);
});

test('batch page separates workbench, tasks, submission records, and resources', () => {
  const page = fs.readFileSync(path.join(root, 'batch.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'batch.js'), 'utf8');

  for (const id of ['navWorkbench', 'navTasks', 'navSubmissions', 'navResources']) {
    assert.match(page, new RegExp(`id=["']${id}["']`));
  }
  assert.match(page, /data-app-view=["']workbench["']/);
  assert.match(page, /data-app-view=["']tasks["']/);
  assert.match(page, /data-app-view=["']submissions["']/);
  assert.match(script, /function setAppView\(/);
  assert.doesNotMatch(page, /历史归档/);
});
