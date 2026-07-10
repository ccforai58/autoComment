# Floating Link Assistant Resource Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a right-side floating browser assistant for semi-automatic backlink submission and a reusable local backlink resource library.

**Architecture:** Add pure Node-tested logic first, then a MySQL-backed Express router, then inject a compact content-script UI into normal pages, and finally add a standalone extension page for searching and exporting the resource library. The browser UI uses browser-safe helper functions inside `content.js`; the pure modules are the tested source of behavior but are not loaded directly as CommonJS content scripts.

**Tech Stack:** Chrome MV3 content scripts, vanilla HTML/CSS/JS, Express routers, MySQL via `api/db.js`, Node `node:test`, existing local backend on `http://127.0.0.1:3000`.

## Global Constraints

- Do not restore Semrush dual CSV import.
- Do not bypass CAPTCHA, login, human verification, Cloudflare, or anti-spam controls.
- Do not save usernames, passwords, cookies, tokens, private links, API keys, or site credentials.
- Default page submit behavior is manual: the plugin fills fields, then the user clicks the page submit button.
- Automatic page submit is optional and configurable.
- AI-generated content is written to editable assistant textareas before page filling.
- The user clicking assistant submit means "fill the page with the current edited content."
- If automatic page submit is enabled, the assistant fills fields and then clicks the page submit button.
- If the same `source_domain + promotion_project_id` already has `success`, block another submit by default and allow manual override.
- Resource library management opens as a separate browser page, not inside the floating panel.
- Keep existing batch CSV workbench behavior working.
- Preserve UTF-8 text and run the mojibake scan before completion.

---

## File Structure

- Create `lib/link-assistant-resource-logic.js`: URL/domain normalization, page classification, topic tag suggestion, submit mode normalization, and duplicate-domain submission decisions.
- Create `lib/link-assistant-fill-logic.js`: field scoring and fill-plan generation for blog comment pages and directory submit pages.
- Create `lib/link-assistant-ui-logic.js`: assistant state defaults, submit intent calculation, and resource payload shaping.
- Create `api/link-assistant.js`: Express router for promotion projects, resources, submission records, duplicate checks, resource editing, and CSV export.
- Modify `server.js`: mount `api/link-assistant.js` under `/api`.
- Modify `content.js`: inject the floating assistant, call backend APIs, generate editable AI content, fill fields, optionally click submit, and record resource/submission state.
- Modify `background.js`: open the standalone resource library page from a runtime message.
- Create `resource-library.html`: standalone extension page for resource management.
- Create `resource-library.js`: search, filter, edit, and export UI logic.
- Create tests:
  - `tests/link-assistant-resource-logic.test.js`
  - `tests/link-assistant-fill-logic.test.js`
  - `tests/link-assistant-ui-logic.test.js`
  - `tests/link-assistant-api.test.js`
- Sync changed extension files to `dist/auto-comment-plugin/` and copy them to `D:\WORK\AI_Work\backlinkautocomment\load-this-extension`.

---

### Task 1: Resource Logic Module

**Files:**
- Create: `lib/link-assistant-resource-logic.js`
- Test: `tests/link-assistant-resource-logic.test.js`

**Interfaces:**
- Produces:
  - `normalizeResourceUrl(value: string) -> string`
  - `normalizeResourceDomain(value: string) -> string`
  - `classifyResourcePage(input: { url: string, title?: string, text?: string, fields?: string[] }) -> string`
  - `suggestTopicTags(input: { url: string, title?: string, text?: string }) -> string[]`
  - `buildDomainPromotionKey(input: { sourceDomain: string, promotionProjectId: number|string }) -> string`
  - `getDuplicateSubmitDecision(input: { domainHasSuccess: boolean, override: boolean }) -> { blocked: boolean, reason: string }`
  - `normalizeSubmitMode(value: string) -> "manual" | "auto" | "confirm"`
- Consumes: no runtime state.

- [ ] **Step 1: Write failing tests**

Create `tests/link-assistant-resource-logic.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDomainPromotionKey,
  classifyResourcePage,
  getDuplicateSubmitDecision,
  normalizeResourceDomain,
  normalizeResourceUrl,
  normalizeSubmitMode,
  suggestTopicTags
} = require('../lib/link-assistant-resource-logic');

test('normalizes resource urls and domains', () => {
  assert.equal(normalizeResourceUrl('Example.COM/blog/post/#comments'), 'https://example.com/blog/post');
  assert.equal(normalizeResourceDomain('https://www.Example.com/path'), 'example.com');
});

test('classifies blog comments and directory submit pages', () => {
  assert.equal(classifyResourcePage({
    url: 'https://example.com/blog/post',
    title: 'AI blog post',
    text: 'Leave a comment. Name Email Website Comment',
    fields: ['author', 'email', 'url', 'comment']
  }), 'blog_comment');
  assert.equal(classifyResourcePage({
    url: 'https://dir.example.com/submit',
    title: 'Submit your startup',
    text: 'Add site listing website url description category',
    fields: ['site_name', 'website_url', 'description', 'category']
  }), 'directory');
});

test('suggests stable topic tags', () => {
  assert.deepEqual(suggestTopicTags({
    url: 'https://example.com/ai-design-tools',
    title: 'AI design tools for creators',
    text: 'image video creative software'
  }), ['ai', 'creative', 'design', 'image_video', 'technology']);
});

test('blocks repeat successful source domain for same promotion project by default', () => {
  assert.deepEqual(getDuplicateSubmitDecision({ domainHasSuccess: true, override: false }), {
    blocked: true,
    reason: 'domain_success_exists'
  });
  assert.deepEqual(getDuplicateSubmitDecision({ domainHasSuccess: true, override: true }), {
    blocked: false,
    reason: 'manual_override'
  });
});

test('normalizes submit mode and domain promotion key', () => {
  assert.equal(normalizeSubmitMode(''), 'manual');
  assert.equal(normalizeSubmitMode('auto'), 'auto');
  assert.equal(normalizeSubmitMode('confirm'), 'confirm');
  assert.equal(normalizeSubmitMode('unexpected'), 'manual');
  assert.equal(buildDomainPromotionKey({ sourceDomain: 'Example.COM', promotionProjectId: 42 }), 'example.com::42');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/link-assistant-resource-logic.test.js
```

Expected: FAIL with `Cannot find module '../lib/link-assistant-resource-logic'`.

- [ ] **Step 3: Implement `lib/link-assistant-resource-logic.js`**

Use this complete module:

```js
const RESOURCE_TYPES = Object.freeze({
  BLOG_COMMENT: 'blog_comment',
  DIRECTORY: 'directory',
  MEDIA_ARTICLE: 'media_article',
  COMMUNITY_FORUM: 'community_forum',
  RESOURCE_PAGE: 'resource_page',
  OTHER: 'other'
});

const SUBMIT_MODES = Object.freeze({ MANUAL: 'manual', AUTO: 'auto', CONFIRM: 'confirm' });

function normalizeResourceUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch (_) {
    return text;
  }
}

function normalizeResourceDomain(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return text.replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function lowerJoin(parts) {
  return parts.map((part) => String(part || '')).join(' ').toLowerCase();
}

function classifyResourcePage(input = {}) {
  const fields = Array.isArray(input.fields) ? input.fields.join(' ') : '';
  const text = lowerJoin([input.url, input.title, input.text, fields]);
  if (/\b(comment|reply|leave a comment|commentform|wpdiscuz)\b/.test(text)) return RESOURCE_TYPES.BLOG_COMMENT;
  if (/\b(submit|add site|add your site|listing|directory|website url|site name|category)\b/.test(text)) return RESOURCE_TYPES.DIRECTORY;
  if (/\b(news|media|press|magazine|journal|article)\b/.test(text)) return RESOURCE_TYPES.MEDIA_ARTICLE;
  if (/\b(forum|community|discussion|thread)\b/.test(text)) return RESOURCE_TYPES.COMMUNITY_FORUM;
  if (/\b(resources?|tools?|links?|awesome)\b/.test(text)) return RESOURCE_TYPES.RESOURCE_PAGE;
  return RESOURCE_TYPES.OTHER;
}

function suggestTopicTags(input = {}) {
  const text = lowerJoin([input.url, input.title, input.text]);
  const tags = new Set();
  const add = (tag, pattern) => { if (pattern.test(text)) tags.add(tag); };
  add('ai', /\b(ai|artificial intelligence|llm|prompt|generator)\b/);
  add('technology', /\b(tech|software|saas|app|platform|api)\b/);
  add('design', /\b(design|designer|figma|ux|ui|illustration)\b/);
  add('creative', /\b(creative|creator|art|comic|manga|anime)\b/);
  add('image_video', /\b(image|video|photo|avatar|animation)\b/);
  add('entertainment', /\b(entertainment|movie|music|comic|anime)\b/);
  add('business', /\b(business|startup|company|enterprise)\b/);
  add('marketing', /\b(marketing|growth|seo|brand)\b/);
  add('education', /\b(education|course|learning|school)\b/);
  add('finance', /\b(finance|payment|invoice|crypto)\b/);
  if (!tags.size) tags.add('other');
  return [...tags].sort();
}

function buildDomainPromotionKey(input = {}) {
  return `${normalizeResourceDomain(input.sourceDomain)}::${String(input.promotionProjectId || '').trim()}`;
}

function getDuplicateSubmitDecision(input = {}) {
  if (input.domainHasSuccess && !input.override) return { blocked: true, reason: 'domain_success_exists' };
  if (input.domainHasSuccess && input.override) return { blocked: false, reason: 'manual_override' };
  return { blocked: false, reason: 'no_domain_success' };
}

function normalizeSubmitMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === SUBMIT_MODES.AUTO || mode === SUBMIT_MODES.CONFIRM || mode === SUBMIT_MODES.MANUAL
    ? mode
    : SUBMIT_MODES.MANUAL;
}

module.exports = {
  RESOURCE_TYPES,
  SUBMIT_MODES,
  buildDomainPromotionKey,
  classifyResourcePage,
  getDuplicateSubmitDecision,
  normalizeResourceDomain,
  normalizeResourceUrl,
  normalizeSubmitMode,
  suggestTopicTags
};
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node --test tests/link-assistant-resource-logic.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/link-assistant-resource-logic.js tests/link-assistant-resource-logic.test.js
git commit -m "feat: add link assistant resource logic"
```

---

### Task 2: Fill Plan Logic

**Files:**
- Create: `lib/link-assistant-fill-logic.js`
- Test: `tests/link-assistant-fill-logic.test.js`

**Interfaces:**
- Produces:
  - `scoreFieldForRole(field: object, role: string) -> number`
  - `buildBlogCommentFillPlan(input: { fields: object[], profile: object, comment: string }) -> Array<{ fieldIndex: number, value: string, role: string }>`
  - `buildDirectoryFillPlan(input: { fields: object[], project: object, description: string }) -> Array<{ fieldIndex: number, value: string, role: string }>`
  - `buildFieldSnapshotFromDom(document: Document) -> object[]`
  - `chooseSubmitButton(document: Document) -> HTMLElement|null`

- [ ] **Step 1: Write failing tests**

Create `tests/link-assistant-fill-logic.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBlogCommentFillPlan,
  buildDirectoryFillPlan,
  scoreFieldForRole
} = require('../lib/link-assistant-fill-logic');

test('buildBlogCommentFillPlan maps common comment fields', () => {
  const fields = [
    { tag: 'textarea', name: 'comment', id: 'comment', placeholder: 'Comment' },
    { tag: 'input', type: 'text', name: 'author', id: 'author', placeholder: 'Name' },
    { tag: 'input', type: 'email', name: 'email', id: 'email', placeholder: 'Email' },
    { tag: 'input', type: 'url', name: 'url', id: 'url', placeholder: 'Website' }
  ];
  assert.deepEqual(buildBlogCommentFillPlan({
    fields,
    profile: { name: 'Alice', email: 'alice@example.com', website: 'https://product.test' },
    comment: 'Great post <a href="https://product.test">AI tool</a>\n'
  }), [
    { fieldIndex: 0, role: 'comment', value: 'Great post <a href="https://product.test">AI tool</a>\n' },
    { fieldIndex: 1, role: 'name', value: 'Alice' },
    { fieldIndex: 2, role: 'email', value: 'alice@example.com' },
    { fieldIndex: 3, role: 'website', value: 'https://product.test' }
  ]);
});

test('buildDirectoryFillPlan maps common directory fields', () => {
  const fields = [
    { tag: 'input', type: 'text', name: 'site_name', id: 'site_name', placeholder: 'Site name' },
    { tag: 'input', type: 'url', name: 'website_url', id: 'website_url', placeholder: 'Website URL' },
    { tag: 'input', type: 'email', name: 'contact_email', id: 'email', placeholder: 'Email' },
    { tag: 'textarea', name: 'description', id: 'description', placeholder: 'Description' }
  ];
  assert.deepEqual(buildDirectoryFillPlan({
    fields,
    project: { productName: 'AniMaker', website: 'https://product.test', email: 'hello@product.test' },
    description: 'Create comics with AI.'
  }), [
    { fieldIndex: 0, role: 'product_name', value: 'AniMaker' },
    { fieldIndex: 1, role: 'website', value: 'https://product.test' },
    { fieldIndex: 2, role: 'email', value: 'hello@product.test' },
    { fieldIndex: 3, role: 'description', value: 'Create comics with AI.' }
  ]);
});

test('scoreFieldForRole favors explicit role names', () => {
  assert.equal(scoreFieldForRole({ name: 'comment' }, 'comment') > scoreFieldForRole({ name: 'email' }, 'comment'), true);
  assert.equal(scoreFieldForRole({ type: 'email' }, 'email') > scoreFieldForRole({ type: 'text' }, 'email'), true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/link-assistant-fill-logic.test.js
```

Expected: FAIL with `Cannot find module '../lib/link-assistant-fill-logic'`.

- [ ] **Step 3: Implement fill logic**

Create `lib/link-assistant-fill-logic.js`. It must export exactly the five functions listed in this task's interface, use unique fields for each role, prefer `textarea` for `comment` and `description`, prefer `type=email` for `email`, and prefer `type=url` for `website`.

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node --test tests/link-assistant-fill-logic.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/link-assistant-fill-logic.js tests/link-assistant-fill-logic.test.js
git commit -m "feat: add link assistant fill planning"
```

---

### Task 3: Assistant UI State Logic

**Files:**
- Create: `lib/link-assistant-ui-logic.js`
- Test: `tests/link-assistant-ui-logic.test.js`

**Interfaces:**
- Produces:
  - `buildInitialAssistantState(input: object) -> object`
  - `shouldAutoGenerateContent(state: object) -> boolean`
  - `buildSubmitIntent(state: object) -> { shouldGenerate: boolean, shouldFill: boolean, shouldAutoSubmit: boolean, shouldConfirmBeforeSubmit: boolean }`
  - `buildCreatedResourcePayload(input: object) -> object`

- [ ] **Step 1: Write failing tests**

Create `tests/link-assistant-ui-logic.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCreatedResourcePayload,
  buildInitialAssistantState,
  buildSubmitIntent,
  shouldAutoGenerateContent
} = require('../lib/link-assistant-ui-logic');

test('initial state defaults to AI generation and manual page submit', () => {
  const state = buildInitialAssistantState({ url: 'https://example.com/post', pageType: 'blog_comment' });
  assert.equal(state.aiGenerateMode, 'default');
  assert.equal(state.submitMode, 'manual');
  assert.equal(shouldAutoGenerateContent(state), true);
});

test('submit intent fills first and only auto-clicks page submit in auto mode', () => {
  assert.deepEqual(buildSubmitIntent({ submitMode: 'manual', commentText: 'ready' }), {
    shouldGenerate: false,
    shouldFill: true,
    shouldAutoSubmit: false,
    shouldConfirmBeforeSubmit: false
  });
  assert.deepEqual(buildSubmitIntent({ submitMode: 'auto', commentText: 'ready' }), {
    shouldGenerate: false,
    shouldFill: true,
    shouldAutoSubmit: true,
    shouldConfirmBeforeSubmit: false
  });
  assert.deepEqual(buildSubmitIntent({ submitMode: 'confirm', commentText: 'ready' }), {
    shouldGenerate: false,
    shouldFill: true,
    shouldAutoSubmit: false,
    shouldConfirmBeforeSubmit: true
  });
});

test('submit intent asks generation when content is empty', () => {
  assert.equal(buildSubmitIntent({ submitMode: 'manual', commentText: '', descriptionText: '' }).shouldGenerate, true);
});

test('resource payload normalizes tags and labels', () => {
  assert.deepEqual(buildCreatedResourcePayload({
    sourceUrl: 'https://Example.com/post#comments',
    sourceDomain: 'www.Example.com',
    resourceType: 'blog_comment',
    qualityLabel: 'excellent',
    topicTags: ['ai', 'design'],
    title: 'Useful post'
  }), {
    sourceUrl: 'https://example.com/post',
    sourceDomain: 'example.com',
    resourceType: 'blog_comment',
    qualityLabel: 'excellent',
    topicTags: ['ai', 'design'],
    title: 'Useful post'
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/link-assistant-ui-logic.test.js
```

Expected: FAIL with `Cannot find module '../lib/link-assistant-ui-logic'`.

- [ ] **Step 3: Implement UI logic**

Create `lib/link-assistant-ui-logic.js`. It must import `normalizeResourceUrl`, `normalizeResourceDomain`, and `normalizeSubmitMode` from `lib/link-assistant-resource-logic.js`, return manual submit mode by default, and treat empty editable content as a generation-required submit intent.

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node --test tests/link-assistant-resource-logic.test.js tests/link-assistant-ui-logic.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/link-assistant-ui-logic.js tests/link-assistant-ui-logic.test.js
git commit -m "feat: add link assistant ui state logic"
```

---

### Task 4: Link Assistant API

**Files:**
- Create: `api/link-assistant.js`
- Modify: `server.js`
- Test: `tests/link-assistant-api.test.js`

**Interfaces:**
- Consumes:
  - `execute(sql, params)`, `query(sql, params)`, and `queryOne(sql, params)` from `api/db.js`
  - result vocabulary from existing batch flow: `success`, `success_pending_moderation`, `submitted_unconfirmed`, `manual_required`, `fail`
- Produces:
  - `GET /api/link-assistant/projects`
  - `POST /api/link-assistant/projects`
  - `GET /api/link-assistant/resources`
  - `POST /api/link-assistant/resources`
  - `PATCH /api/link-assistant/resources/:id`
  - `GET /api/link-assistant/duplicate-check?sourceDomain=...&promotionProjectId=...`
  - `POST /api/link-assistant/submissions`
  - `GET /api/link-assistant/export.csv`

- [ ] **Step 1: Write API tests**

Create `tests/link-assistant-api.test.js` with a mocked `api/db.js`. The test must mount the router under `/api` in an Express app, then verify project upsert, resource upsert, duplicate-check blocking, duplicate submission rejection unless `overrideDuplicate` is true, resource patching, and UTF-8 CSV export with BOM.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test tests/link-assistant-api.test.js
```

Expected: FAIL with `Cannot find module '../api/link-assistant'`.

- [ ] **Step 3: Implement database tables and routes**

Create `api/link-assistant.js`. It must define `ensureTables()` and create these tables with `utf8mb4`: `link_promotion_projects`, `link_resources`, and `link_submission_records`. Use prefix indexes for `website_url(191)` and `source_url(191)` to avoid MySQL key length errors. Normalize domains and URLs with `lib/link-assistant-resource-logic.js`, store `topic_tags` as JSON strings, and reject duplicate successful-domain submissions with HTTP 409 unless `overrideDuplicate: true`.

- [ ] **Step 4: Mount router in `server.js`**

Add after existing API routers:

```js
app.use('/api', require('./api/link-assistant'));
```

- [ ] **Step 5: Run API tests and syntax checks**

Run:

```powershell
node --check api/link-assistant.js
node --check server.js
node --test tests/link-assistant-api.test.js
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add api/link-assistant.js server.js tests/link-assistant-api.test.js
git commit -m "feat: add link assistant resource api"
```

---

### Task 5: Floating Assistant Content Script

**Files:**
- Modify: `content.js`
- Modify: `manifest.json` only if additional extension assets are added

**Interfaces:**
- Consumes:
  - `GET /api/link-assistant/projects`
  - `POST /api/generate-copy`
  - `POST /api/link-assistant/resources`
  - `GET /api/link-assistant/duplicate-check`
  - `POST /api/link-assistant/submissions`
- Produces:
  - Right-side collapsed assistant button
  - Editable AI comment and product-description textareas
  - Manual, auto, and confirm submit modes
  - Browser-safe field snapshot, fill plan, submit button selection, and resource saving helpers inside `content.js`

- [ ] **Step 1: Add compact assistant shell**

In `content.js`, add an idempotent `ensureLinkAssistantRoot()` that appends a compact panel containing these exact ids: `aclAssistantRoot`, `aclAssistantToggle`, `aclAssistantPanel`, `aclAssistantClose`, `aclProjectSelect`, `aclNameInput`, `aclEmailInput`, `aclWebsiteInput`, `aclCommentText`, `aclDescriptionText`, `aclSubmitMode`, `aclQualityLabel`, `aclResourceType`, `aclGenerateBtn`, `aclSubmitBtn`, `aclSaveResourceBtn`, `aclOpenLibraryBtn`, and `aclStatus`. Style it so the collapsed button stays near the right edge, uses minimal width, and the panel width is about 320px.

- [ ] **Step 2: Add browser-safe helper functions**

Inside `content.js`, add local functions named `aclNormalizeDomain`, `aclNormalizeUrl`, `aclClassifyPage`, `aclSuggestTopicTags`, `aclBuildFieldSnapshot`, `aclBuildBlogFillPlan`, `aclBuildDirectoryFillPlan`, `aclApplyFillPlan`, and `aclChooseSubmitButton`. Do not `require()` the CommonJS `lib/*` modules from the content script.

- [ ] **Step 3: Add API helper**

Add `aclFetch(path, options)` that uses `(window.AUTO_COMMENT_API_BASE || 'http://127.0.0.1:3000/api')`, sends JSON, parses JSON, and throws when `response.ok` is false or `body.success === false`.

- [ ] **Step 4: Generate content into editable textareas**

Call existing `POST /api/generate-copy` with:

```js
{
  userId: 'local-link-assistant',
  websiteUrl: location.href,
  title: document.title,
  description: '',
  bodyText: document.body ? document.body.innerText.slice(0, 5000) : '',
  promotionWebsiteUrl: project.website_url,
  promotionWebsiteContent: project.product_description || project.product_name || ''
}
```

Read the generated result from `payload.text || ''`. The backend already applies the anchor newline rule through `ensurePromotionAnchor`.

- [ ] **Step 5: Implement fill and submit behavior**

When `#aclSubmitBtn` is clicked: generate first if relevant content is empty; check duplicate status; block duplicate successful-domain submissions unless an explicit override checkbox is checked; build a fill plan from current edited content; fill page fields; save `submitted_unconfirmed` in manual mode; confirm before clicking in confirm mode; click immediately in auto mode; save `manual_required` when auto or confirm mode cannot find a submit button.

- [ ] **Step 6: Wire resource save and library open buttons**

`#aclSaveResourceBtn` must call `POST /api/link-assistant/resources` with normalized URL/domain, resource type, quality label, title, and topic tags. `#aclOpenLibraryBtn` must call:

```js
chrome.runtime.sendMessage({ type: 'OPEN_RESOURCE_LIBRARY' });
```

- [ ] **Step 7: Run checks**

Run:

```powershell
node --check content.js
npm test
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```powershell
git add content.js manifest.json
git commit -m "feat: add floating link assistant"
```

---

### Task 6: Resource Library Browser Page

**Files:**
- Create: `resource-library.html`
- Create: `resource-library.js`
- Modify: `background.js`
- Modify: `content.js` only for the open-library button if it was not completed in Task 5

**Interfaces:**
- Consumes:
  - `GET /api/link-assistant/resources`
  - `PATCH /api/link-assistant/resources/:id`
  - `GET /api/link-assistant/export.csv`
- Produces:
  - Browser page `resource-library.html`
  - Runtime message handler `OPEN_RESOURCE_LIBRARY`

- [ ] **Step 1: Create `resource-library.html`**

Create a standalone HTML page with these exact element ids: `keywordInput`, `typeFilter`, `qualityFilter`, `refreshBtn`, `exportCsvBtn`, and `resourceRows`. Include `extension-config.js` and `resource-library.js` at the end of the body.

- [ ] **Step 2: Create `resource-library.js`**

Implement `apiGet(path)`, `apiPatch(path, body)`, `parseTags(value)`, `getFilteredResources()`, `render()`, `loadResources()`, and `updateResource(id, patch)`. The table must show URL/title, domain, resource type, quality label, topic tags, notes, and updated time. Resource type, quality label, topic tags, and notes must be editable inline and saved through `PATCH /api/link-assistant/resources/:id`.

- [ ] **Step 3: Add background message handler**

Modify `background.js`:

```js
if (message && message.type === 'OPEN_RESOURCE_LIBRARY') {
  chrome.tabs.create({ url: chrome.runtime.getURL('resource-library.html') });
  sendResponse({ success: true });
  return true;
}
```

- [ ] **Step 4: Run checks**

Run:

```powershell
node --check resource-library.js
node --check background.js
node --check content.js
npm test
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add resource-library.html resource-library.js background.js content.js
git commit -m "feat: add link resource library page"
```

---

### Task 7: Dist Sync and Manual Verification

**Files:**
- Modify: `dist/auto-comment-plugin/*`
- Copy outside repo: `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\*`

**Interfaces:**
- Consumes all files produced by Tasks 1-6.
- Produces a browser-loadable extension copy.

- [ ] **Step 1: Copy updated extension files to dist**

Run:

```powershell
Copy-Item -LiteralPath content.js -Destination dist\auto-comment-plugin\content.js -Force
Copy-Item -LiteralPath background.js -Destination dist\auto-comment-plugin\background.js -Force
Copy-Item -LiteralPath manifest.json -Destination dist\auto-comment-plugin\manifest.json -Force
Copy-Item -LiteralPath resource-library.html -Destination dist\auto-comment-plugin\resource-library.html -Force
Copy-Item -LiteralPath resource-library.js -Destination dist\auto-comment-plugin\resource-library.js -Force
```

Expected: command exits 0.

- [ ] **Step 2: Copy dist files to loaded extension directory**

Run:

```powershell
Copy-Item -LiteralPath dist\auto-comment-plugin\* -Destination D:\WORK\AI_Work\backlinkautocomment\load-this-extension -Recurse -Force
```

Expected: command exits 0. This directory is outside the repo, so do not include it in `git add`.

- [ ] **Step 3: Run final checks**

Run:

```powershell
node scripts\scan-mojibake.js
npm test
```

Expected: mojibake scan reports no common mojibake patterns and all tests pass.

- [ ] **Step 4: Restart backend**

Run:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force }
Start-Sleep -Seconds 1
Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory 'D:\WORK\AI_Work\backlinkautocomment\autoComment' -WindowStyle Hidden
Start-Sleep -Seconds 3
Invoke-RestMethod -Uri http://127.0.0.1:3000/health -TimeoutSec 5
```

Expected: response contains `status: ok`.

- [ ] **Step 5: Manual browser verification**

In Chrome: open `chrome://extensions`, reload the unpacked extension from `D:\WORK\AI_Work\backlinkautocomment\load-this-extension`, open a normal webpage, confirm the collapsed right-side assistant button appears, expand it, confirm submit mode defaults to manual page submit after fill, generate content, edit the textarea, click `Fill / Submit`, confirm fields are filled without auto-clicking the page submit button, open the resource library, and verify search, filters, inline edits, and CSV export.

- [ ] **Step 6: Commit tracked dist files**

```powershell
git add dist\auto-comment-plugin
git commit -m "chore: sync floating assistant extension build"
```

---

## Self-Review Notes

- Spec coverage:
  - Floating right-side assistant: Task 5.
  - Default AI generation with editable text: Tasks 3 and 5.
  - Default manual page submit and optional auto/confirm modes: Tasks 3 and 5.
  - Blog comment and directory page support: Tasks 2 and 5.
  - Resource library accumulation with quality/topic/type labels: Tasks 1, 4, 5, and 6.
  - Duplicate prevention for `source_domain + promotion_project_id` after success: Tasks 1, 4, and 5.
  - Separate browser resource page with search, filters, edit, and export: Task 6.
  - Existing AI anchor newline behavior: Task 5 calls existing `/api/generate-copy`, which already uses `ensurePromotionAnchor`.
  - Dist and loaded-extension sync: Task 7.
- Placeholder scan: no unresolved placeholder wording is expected in task steps.
- Type consistency: route names, function names, submit modes, and submission results are consistent across tasks.
