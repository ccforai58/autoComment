# AI 评论提示词三段式增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every blog-comment generation request require a natural, language-aware value affirmation, substantive follow-up viewpoint, and contextually connected promoted-link insertion.

**Architecture:** Define the comment-specific requirements once in `api/generate-copy.js` and append them after either the default or a user-supplied skill template whenever the request produces a blog comment. Keep the existing link-format rule as a separate appended block. Tests exercise the exported prompt-builder path to prove custom and default templates receive the rules while non-blog manual requests do not.

**Tech Stack:** Node.js, Express, Node built-in test runner.

## Global Constraints

- Match the current page's main language.
- Space-delimited languages use approximately 30 words for value affirmation and 50 words for the follow-up viewpoint.
- Chinese, Japanese, Korean, Thai, Lao, and Burmese use approximately 50--70 characters and 100--140 characters respectively.
- The promoted link must be introduced through a specific direct or secondary association found in the provided page and promoted-site content; do not invent facts or use vague bridging.
- Preserve existing unique HTML anchor, anchor-keyword, deduplication, and href-newline requirements.
- Apply only to blog comments, including batch generation and blog-comment manual-assistant requests.

---

### Task 1: Cover comment-only prompt augmentation

**Files:**
- Modify: `tests/generate-copy.test.js`
- Modify: `api/generate-copy.js`

**Interfaces:**
- Consumes: `getDefaultSkillTemplateV2()` and `appendRequiredOutputRules(skillTemplate)` in `api/generate-copy.js`.
- Produces: `appendRequiredOutputRules(skillTemplate, options)` that appends link rules and comment-structure rules only when `options.requireCommentStructure` is true.

- [ ] **Step 1: Write the failing tests**

Add tests through exported helpers that assert the augmented blog prompt contains these exact fragments and preserves a supplied custom template:

```js
assert.match(template, /Start by affirming the article's value/);
assert.match(template, /approximately 30 words/);
assert.match(template, /approximately 50 words/);
assert.match(template, /50 to 70 characters/);
assert.match(template, /specific direct connection/);
assert.match(template, /specific secondary connection/);
assert.match(template, /Do not use vague bridges/);
assert.match(template, /Custom instruction/);
```

Add a non-blog manual-mode assertion that its template does not contain `Start by affirming the article's value`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/generate-copy.test.js`

Expected: FAIL because the comment-structure fragments are not present.

- [ ] **Step 3: Add a dedicated comment-structure rule block**

In `api/generate-copy.js`, add a `COMMENT_STRUCTURE_RULE` constant containing:

```js
const COMMENT_STRUCTURE_RULE = [
  '',
  'Comment structure requirements:',
  'Start by affirming the article\'s value using a specific topic, insight, method, example, or reader benefit from the current page.',
  'Then add one substantive follow-up viewpoint, suggestion, or extension and integrate the promoted website as a useful resource within that second part.',
  'For space-delimited languages, make the value affirmation approximately 30 words and the follow-up viewpoint approximately 50 words.',
  'For Chinese, Japanese, Korean, Thai, Lao, and Burmese, make the value affirmation approximately 50 to 70 characters and the follow-up viewpoint approximately 100 to 140 characters.',
  'Prefer a specific direct connection between the article and promoted website. If their primary topics differ, find and state a specific secondary connection grounded in their supplied content, such as writing method, content structure, user experience, page speed, visual presentation, workflow, creative inspiration, case presentation, or audience need.',
  'Do not use vague bridges such as "worth learning" or "very helpful", and do not invent facts, capabilities, results, or claims for either website.',
  'The HTML anchor must be naturally embedded in the second part, not added as a detached link.'
].join('\\n');
```

Change `appendRequiredOutputRules` to receive `{ requireCommentStructure = false }` and append `COMMENT_STRUCTURE_RULE` only when true. Pass `requireCommentStructure: shouldRequireHtmlAnchor` at the current call site, because `shouldRequireHtmlAnchor` is true exactly for batch comments and manual blog comments.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test tests/generate-copy.test.js`

Expected: PASS with all prompt and model-generation tests passing.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`

Expected: PASS with no regressions in anchor or manual-assistant behavior.

### Task 2: Restart and validate the local backend

**Files:**
- No source-file changes.

**Interfaces:**
- Consumes: `npm run local:stack:stop`, `npm run local:stack:start`, and `GET /health`.
- Produces: running backend on `http://127.0.0.1:3000` that uses the revised prompt when Chrome sends a generation request.

- [ ] **Step 1: Restart the local stack**

Run:

```powershell
npm run local:stack:stop
npm run local:stack:start
```

Expected: MySQL is healthy and the start script reports `AutoComment local stack is ready.`

- [ ] **Step 2: Verify the API health endpoint**

Run:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 5
```

Expected: JSON with `status` set to `ok`.

- [ ] **Step 3: Validate the Chrome extension reload state**

Open `chrome://extensions`, identify the loaded extension whose root is the project `autoComment` directory, and select Reload. Use the extension on a page with available content to trigger one comment generation; confirm the returned comment has article-specific praise, a follow-up viewpoint, and one natural anchor.
