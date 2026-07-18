const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(repoRoot, '..');

function readManifest(relativePath) {
  const manifestPath = path.join(repoRoot, relativePath, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function readWorkspaceManifest(relativePath) {
  const manifestPath = path.join(workspaceRoot, relativePath, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function getContentScripts(manifest) {
  return manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].js
    ? manifest.content_scripts[0].js
    : [];
}

test('extension manifests load link assistant helpers before content script', () => {
  const manifests = [
    readManifest('.'),
    readManifest('dist/auto-comment-plugin'),
    readWorkspaceManifest('load-this-extension')
  ];

  for (const manifest of manifests) {
    const scripts = getContentScripts(manifest);
    const runtimeIndex = scripts.indexOf('lib/link-assistant-runtime-logic.js');
    const detectorIndex = scripts.indexOf('lib/link-assistant-form-detector.js');
    const contentIndex = scripts.indexOf('content.js');

    assert.ok(runtimeIndex >= 0, 'runtime helper is listed');
    assert.ok(detectorIndex >= 0, 'form detector helper is listed');
    assert.ok(contentIndex >= 0, 'content script is listed');
    assert.ok(runtimeIndex < contentIndex, 'runtime helper loads before content.js');
    assert.ok(detectorIndex < contentIndex, 'form detector helper loads before content.js');
  }
});
