# Batch Submit Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把批量外链提交改成实用型两阶段流程：先稳定填写并触发提交，再以提交后的最新网页源码中是否出现指向推广网站的 `<a href>` 作为 `success` 的唯一最高标准。

**Architecture:** 保持现有 Chrome Extension MV3 架构，不大拆 `content.js` / `batch.js`。新增和扩展 `lib/batch-submit-logic.js` 中的纯函数，让链接验真、结果分类、批处理快照都可以用 Node 测试覆盖；`content.js` 负责 DOM 填写、快速点击、提交后源码验链；`batch.js` 负责持久化运行态并从 storage 恢复；`background.js` 负责统一结果落盘和转发。

**Tech Stack:** Chrome Extension Manifest V3, browser DOM APIs, `chrome.storage.local`, Node.js built-in test runner, PowerShell on Windows.

## Global Constraints

- 本插件定位为本地免费运行工具，不引入生产支付、扣点或购买 CSV 逻辑。
- 不保存账号、密码、Cookie、Token、API Key、私密 URL 或完整页面源码。
- 新增诊断日志优先使用 ASCII，避免传播已有 mojibake。
- 只有提交后的最新网页源码中存在指向推广网址的 `<a href>` 链接时，结果才是 `success`。
- 触发提交但源码未找到正向链接时，结果必须是 `submitted_unconfirmed`，不能伪装成 `success`。
- 计划文档和后续设计文档使用中文。
- 手动编辑含中文文件时使用 `apply_patch`；同步构建产物和加载目录可用 `Copy-Item`。

---

## File Structure

- `autoComment/lib/batch-submit-logic.js`
  - 纯逻辑模块。新增推广网址标准化、HTML 链接提取、源码验链、最终结果分类、批处理快照归并函数。

- `autoComment/tests/batch-submit-logic.test.js`
  - 扩展现有 Node 测试，覆盖源码验链、纯文本 URL 不算成功、`submitted_unconfirmed` 分类、批处理恢复快照。

- `autoComment/content.js`
  - 使用纯函数做提交后源码验链。
  - 把 `performClick` 改成快速触发提交，不在每个 fallback 内长等。
  - 把 `observeSubmitOutcome` 改成短观察 + 验链优先。
  - 目标页面刷新后根据任务阶段恢复，而不是重新开始或丢任务。

- `autoComment/background.js`
  - 保存 `linkVerified`、`matchedHref`、`promotionWebsiteUrl` 等非敏感结果字段。
  - 继续规范化 `BATCH_HANDLE_CONFIRM`，保证无验链成功不能变成 `success`。

- `autoComment/batch.js`
  - 持久化批处理运行态。
  - batch 页面刷新后恢复 CSV 列表、结果、当前进度、计数。
  - 对 `submitted_unconfirmed` 使用独立计数或归入 manual/pending 类，不当作成功。

- `autoComment/dist/auto-comment-plugin/`
  - 同步扩展运行文件。

- `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\`
  - 同步浏览器实际加载目录。

---

### Task 1: 源码验链纯函数

**Files:**
- Modify: `autoComment/lib/batch-submit-logic.js`
- Modify: `autoComment/tests/batch-submit-logic.test.js`

**Interfaces:**
- Produces: `normalizePromotionTarget(url: string): { raw: string, normalizedUrl: string, hostname: string, pathname: string, valid: boolean }`
- Produces: `extractAnchorHrefs(html: string): string[]`
- Produces: `verifyBacklinkInHtml(html: string, promotionUrl: string): { linkVerified: boolean, matchedHref: string, promotionHost: string, candidateCount: number, hostMatchedCount: number, pathMatched: boolean, reason: string }`
- Consumes: Existing `module.exports` in `lib/batch-submit-logic.js`

- [ ] **Step 1: Write failing tests for backlink verification**

Append to `autoComment/tests/batch-submit-logic.test.js`:

```js
test('verifyBacklinkInHtml succeeds when anchor href points to promotion host', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<html><body><a href="https://Example.com/">Visit</a></body></html>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, true);
  assert.equal(result.promotionHost, 'example.com');
  assert.equal(result.matchedHref, 'https://Example.com/');
  assert.equal(result.candidateCount, 1);
});

test('verifyBacklinkInHtml ignores plain text URLs without anchor href', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<html><body>https://example.com is mentioned as text</body></html>';
  const result = verifyBacklinkInHtml(html, 'https://example.com');

  assert.equal(result.linkVerified, false);
  assert.equal(result.reason, 'no_matching_anchor_href');
});

test('verifyBacklinkInHtml accepts http and https protocol differences', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="http://example.com/path/page">Example</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com/path');

  assert.equal(result.linkVerified, true);
  assert.equal(result.pathMatched, true);
});

test('verifyBacklinkInHtml requires specific path prefix when promotion URL has a path', () => {
  const { verifyBacklinkInHtml } = require('../lib/batch-submit-logic');
  const html = '<a href="https://example.com/other">Other</a>';
  const result = verifyBacklinkInHtml(html, 'https://example.com/target');

  assert.equal(result.linkVerified, false);
  assert.equal(result.hostMatchedCount, 1);
  assert.equal(result.reason, 'host_matched_path_mismatched');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: FAIL with `verifyBacklinkInHtml is not a function`.

- [ ] **Step 3: Implement minimal pure functions**

Add to `autoComment/lib/batch-submit-logic.js` before `module.exports`:

```js
function normalizePromotionTarget(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    parsed.hash = '';
    const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    return {
      raw,
      normalizedUrl: `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}`,
      hostname: parsed.hostname.toLowerCase(),
      pathname,
      valid: true
    };
  } catch (_) {
    return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
  }
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractAnchorHrefs(html) {
  const source = String(html || '');
  const hrefs = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match;
  while ((match = anchorRe.exec(source)) !== null) {
    const href = decodeHtmlAttribute(match[1] || match[2] || match[3] || '').trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function parseHrefAgainstPromotion(href, promotionTarget) {
  try {
    const base = promotionTarget.normalizedUrl || `https://${promotionTarget.hostname}/`;
    const parsed = new URL(href, base);
    parsed.hash = '';
    return {
      href,
      hostname: parsed.hostname.toLowerCase(),
      pathname: (parsed.pathname || '/').replace(/\/+$/, '') || '/'
    };
  } catch (_) {
    return null;
  }
}

function verifyBacklinkInHtml(html, promotionUrl) {
  const promotion = normalizePromotionTarget(promotionUrl);
  const hrefs = extractAnchorHrefs(html);
  if (!promotion.valid) {
    return {
      linkVerified: false,
      matchedHref: '',
      promotionHost: '',
      candidateCount: hrefs.length,
      hostMatchedCount: 0,
      pathMatched: false,
      reason: 'invalid_promotion_url'
    };
  }

  let hostMatchedCount = 0;
  for (const href of hrefs) {
    const parsed = parseHrefAgainstPromotion(href, promotion);
    if (!parsed || parsed.hostname !== promotion.hostname) continue;
    hostMatchedCount++;
    const needsPath = promotion.pathname && promotion.pathname !== '/';
    const pathMatched = !needsPath || parsed.pathname === promotion.pathname || parsed.pathname.startsWith(`${promotion.pathname}/`);
    if (pathMatched) {
      return {
        linkVerified: true,
        matchedHref: href,
        promotionHost: promotion.hostname,
        candidateCount: hrefs.length,
        hostMatchedCount,
        pathMatched: true,
        reason: 'matching_anchor_href_found'
      };
    }
  }

  return {
    linkVerified: false,
    matchedHref: '',
    promotionHost: promotion.hostname,
    candidateCount: hrefs.length,
    hostMatchedCount,
    pathMatched: false,
    reason: hostMatchedCount > 0 ? 'host_matched_path_mismatched' : 'no_matching_anchor_href'
  };
}
```

Update `module.exports`:

```js
module.exports = {
  BATCH_SUCCESS_CONFIRMATION_MARKER,
  buildBatchConfirmPayload,
  buildPreSubmitRecoveryPayload,
  normalizeBatchConfirmMessage,
  classifySubmitEvidence,
  classifyRestoredSubmitEvidence,
  normalizePromotionTarget,
  extractAnchorHrefs,
  verifyBacklinkInHtml
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: PASS for all tests in `tests/batch-submit-logic.test.js`.

- [ ] **Step 5: Review checkpoint**

Run:

```powershell
git diff -- lib/batch-submit-logic.js tests/batch-submit-logic.test.js
```

Expected: Diff only adds pure link verification logic and tests.

---

### Task 2: 验链优先的结果分类

**Files:**
- Modify: `autoComment/lib/batch-submit-logic.js`
- Modify: `autoComment/tests/batch-submit-logic.test.js`

**Interfaces:**
- Consumes: `verifyBacklinkInHtml(html, promotionUrl)`
- Produces: `classifyPostSubmitResult(input: object): { result: string, reason: string, confidence: string, linkVerification: object }`
- `input` shape:
  - `html: string`
  - `promotionUrl: string`
  - `submitTriggered: boolean`
  - `explicitError: string`
  - `manualRequired: boolean`
  - `successMessageFound: boolean`
  - `textareaCleared: boolean`
  - `navigationObserved: boolean`

- [ ] **Step 1: Write failing classification tests**

Append to `autoComment/tests/batch-submit-logic.test.js`:

```js
test('classifyPostSubmitResult returns success only when backlink anchor is found', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<a href="https://promo.test/">Promo</a>',
    promotionUrl: 'https://promo.test',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'success');
  assert.equal(result.linkVerification.linkVerified, true);
});

test('classifyPostSubmitResult returns submitted_unconfirmed for moderation message without backlink', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '<p>Your comment is awaiting moderation.</p>',
    promotionUrl: 'https://promo.test',
    submitTriggered: true,
    successMessageFound: true
  });

  assert.equal(result.result, 'submitted_unconfirmed');
  assert.equal(result.reason, 'submit_evidence_without_backlink');
});

test('classifyPostSubmitResult returns manual_required before ordinary failure', () => {
  const { classifyPostSubmitResult } = require('../lib/batch-submit-logic');
  const result = classifyPostSubmitResult({
    html: '',
    promotionUrl: 'https://promo.test',
    submitTriggered: true,
    manualRequired: true,
    explicitError: 'submit failed: captcha'
  });

  assert.equal(result.result, 'manual_required');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: FAIL with `classifyPostSubmitResult is not a function`.

- [ ] **Step 3: Implement post-submit classifier**

Add to `autoComment/lib/batch-submit-logic.js`:

```js
function classifyPostSubmitResult(input) {
  const source = isObject(input) ? input : {};
  const linkVerification = verifyBacklinkInHtml(source.html || '', source.promotionUrl || '');
  if (linkVerification.linkVerified) {
    return {
      result: 'success',
      reason: 'backlink_anchor_found',
      confidence: 'strong',
      linkVerification
    };
  }

  const explicitError = String(source.explicitError || '').trim();
  const manualRequired = !!source.manualRequired || /captcha|recaptcha|hcaptcha|turnstile|human verification|security check|cloudflare/i.test(explicitError);
  if (manualRequired) {
    return {
      result: 'manual_required',
      reason: explicitError || 'manual verification required',
      confidence: 'strong',
      linkVerification
    };
  }

  if (explicitError) {
    return {
      result: 'fail',
      reason: explicitError,
      confidence: 'strong',
      linkVerification
    };
  }

  const hasSubmitEvidence = !!(
    source.submitTriggered ||
    source.successMessageFound ||
    source.textareaCleared ||
    source.navigationObserved
  );
  if (hasSubmitEvidence) {
    return {
      result: 'submitted_unconfirmed',
      reason: 'submit_evidence_without_backlink',
      confidence: source.successMessageFound ? 'medium' : 'weak',
      linkVerification
    };
  }

  return {
    result: 'fail',
    reason: 'submit_not_triggered',
    confidence: 'strong',
    linkVerification
  };
}
```

Update `module.exports` to include `classifyPostSubmitResult`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Run:

```powershell
git diff -- lib/batch-submit-logic.js tests/batch-submit-logic.test.js
```

Expected: `success` now depends on link verification, not success text alone.

---

### Task 3: 快速点击，不让点击函数长时间阻塞

**Files:**
- Modify: `autoComment/content.js`
- Test: `node --check content.js`

**Interfaces:**
- Consumes: Existing `clickCommentSubmitButton()`
- Modifies: `performClick(button): Promise<{ success: boolean, button?: Element, submitResult: string, submitMethod: string, error?: string }>`
- Produces: `submitResult` values: `'clicked' | 'ajax' | 'navigating' | 'pagehide' | 'timeout'`

- [ ] **Step 1: Record current blocking behavior in notes**

Before editing, inspect the current function:

```powershell
$i=1; Get-Content content.js | ForEach-Object { if ($i -ge 3060 -and $i -le 3245) { '{0}: {1}' -f $i, $_ }; $i++ }
```

Expected: current `performClick` calls `triggerAndWaitForSubmit` for each fallback and can wait around 12 seconds per method.

- [ ] **Step 2: Replace inner click waiting strategy**

In `autoComment/content.js`, inside `performClick(button)`, replace the `triggerAndWaitForSubmit` helper and fallback calls with this pattern:

```js
    async function waitBrieflyForSubmitSignal(timeoutMs = 1800) {
      const watcher = startSubmitOrNavigateWatcher(timeoutMs);
      const result = await watcher.promise;
      return result === 'timeout' || result === 'cancelled' ? 'clicked' : result;
    }

    async function runClickAttempt(label, triggerFn) {
      const watcher = startSubmitOrNavigateWatcher(1800);
      try {
        await triggerFn();
        recordFormSubmit();
        const submitResult = await watcher.promise;
        const normalizedResult = submitResult === 'timeout' || submitResult === 'cancelled'
          ? 'clicked'
          : submitResult;
        console.log('[AutoComment][submit-click] attempt completed', {
          label,
          submitResult: normalizedResult
        });
        return {
          success: true,
          button,
          submitResult: normalizedResult,
          submitMethod: label
        };
      } catch (err) {
        watcher.cancel();
        throw err;
      }
    }
```

Then make each fallback return immediately after a successful trigger:

```js
        const result = await runClickAttempt('synthetic-pointer-click', async () => {
          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          button.dispatchEvent(new MouseEvent('mousedown', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
          await new Promise(resolve => setTimeout(resolve, 40));
          button.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
          await new Promise(resolve => setTimeout(resolve, 20));
          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          button.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
        });
        return result;
```

For fallback `button.click()`:

```js
          const result = await runClickAttempt('button-click', async () => {
            button.click();
          });
          return result;
```

For fallback `form.requestSubmit(button)`:

```js
            const result = await runClickAttempt('request-submit', async () => {
              if (!tryRequestSubmit(formEl, button)) {
                throw new Error('requestSubmit unavailable or failed');
              }
            });
            return result;
```

For fallback `form.submit()`:

```js
              return await runClickAttempt('form-submit', async () => {
                formEl.submit();
              });
```

- [ ] **Step 3: Add click stage logs in `handleBatchTask`**

Ensure `handleBatchTask` logs click start before calling `clickCommentSubmitButton()`:

```js
      logBatchSubmit('submit.click_start', {
        commentLength: aiContent ? aiContent.length : 0,
        formId: form && form.id ? form.id : '',
        textareaId: ta && ta.id ? ta.id : '',
        textareaName: ta && ta.name ? ta.name : ''
      });
```

Update existing `submit.click_done` log to include `submitMethod`:

```js
      logBatchSubmit('submit.click_done', {
        success: !!(clickResult && clickResult.success),
        submitResult: clickResult && clickResult.submitResult ? clickResult.submitResult : '',
        submitMethod: clickResult && clickResult.submitMethod ? clickResult.submitMethod : '',
        error: clickResult && clickResult.error ? clickResult.error : ''
      });
```

- [ ] **Step 4: Syntax check**

Run:

```powershell
node --check content.js
```

Expected: exit code 0.

- [ ] **Step 5: Review checkpoint**

Run:

```powershell
Select-String -Path content.js -Pattern "triggerAndWaitForSubmit|runClickAttempt|submit.click_start|submit.click_done" -Context 2,4
```

Expected: no long per-fallback `triggerAndWaitForSubmit` path remains in `performClick`; `submit.click_start` and `submit.click_done` are present.

---

### Task 4: content.js 接入提交后源码验链

**Files:**
- Modify: `autoComment/content.js`
- Modify: `autoComment/dist/auto-comment-plugin/content.js` after verification
- Modify: `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\content.js` after verification
- Test: `node --check content.js`

**Interfaces:**
- Consumes: `classifyPostSubmitResult` logic mirrored locally or imported through existing browser-safe local function pattern.
- Produces local functions:
  - `getCurrentPageHtmlForVerification(): Promise<string>`
  - `verifyBacklinkInHtmlLocal(html: string, promotionUrl: string): object`
  - `classifyPostSubmitResultLocal(input: object): object`

- [ ] **Step 1: Add browser-local link verification functions**

In `autoComment/content.js`, near existing `classifySubmitEvidenceLocal`, add browser-local equivalents. Use ASCII logs and do not log full HTML:

```js
  function normalizePromotionTargetLocal(url) {
    const raw = String(url || '').trim();
    if (!raw) return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      parsed.hash = '';
      const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      return {
        raw,
        normalizedUrl: `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}`,
        hostname: parsed.hostname.toLowerCase(),
        pathname,
        valid: true
      };
    } catch (_) {
      return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
    }
  }

  function extractAnchorHrefsLocal(html) {
    const source = String(html || '');
    const hrefs = [];
    const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
    let match;
    while ((match = anchorRe.exec(source)) !== null) {
      const href = String(match[1] || match[2] || match[3] || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
      if (href) hrefs.push(href);
    }
    return hrefs;
  }

  function verifyBacklinkInHtmlLocal(html, promotionUrl) {
    const promotion = normalizePromotionTargetLocal(promotionUrl);
    const hrefs = extractAnchorHrefsLocal(html);
    if (!promotion.valid) {
      return { linkVerified: false, matchedHref: '', promotionHost: '', candidateCount: hrefs.length, hostMatchedCount: 0, pathMatched: false, reason: 'invalid_promotion_url' };
    }
    let hostMatchedCount = 0;
    for (const href of hrefs) {
      let parsed;
      try {
        parsed = new URL(href, promotion.normalizedUrl || `https://${promotion.hostname}/`);
      } catch (_) {
        continue;
      }
      const hostMatches = parsed.hostname.toLowerCase() === promotion.hostname;
      if (!hostMatches) continue;
      hostMatchedCount++;
      const hrefPath = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      const needsPath = promotion.pathname && promotion.pathname !== '/';
      const pathMatched = !needsPath || hrefPath === promotion.pathname || hrefPath.startsWith(`${promotion.pathname}/`);
      if (pathMatched) {
        return { linkVerified: true, matchedHref: href, promotionHost: promotion.hostname, candidateCount: hrefs.length, hostMatchedCount, pathMatched: true, reason: 'matching_anchor_href_found' };
      }
    }
    return { linkVerified: false, matchedHref: '', promotionHost: promotion.hostname, candidateCount: hrefs.length, hostMatchedCount, pathMatched: false, reason: hostMatchedCount > 0 ? 'host_matched_path_mismatched' : 'no_matching_anchor_href' };
  }
```

- [ ] **Step 2: Add latest HTML helper**

Add near submit observation helpers:

```js
  async function getCurrentPageHtmlForVerification() {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const domHtml = document.documentElement ? document.documentElement.outerHTML : '';
    try {
      const response = await fetch(location.href, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store'
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
        const fetchedHtml = await response.text();
        if (fetchedHtml && fetchedHtml.length >= domHtml.length * 0.5) {
          return fetchedHtml;
        }
      }
    } catch (error) {
      console.log('[AutoComment][verify-link] fetch latest html failed; using DOM html', {
        error: error && error.message ? error.message : String(error)
      });
    }
    return domHtml;
  }
```

- [ ] **Step 3: Replace success classification in `observeSubmitOutcome`**

Modify `observeSubmitOutcome(clickResult, expectedText, textarea, beforeUrl)` so it returns link-aware outcome. At the end of observation, before returning, gather HTML and promotion URL:

```js
    const promotionWebsiteUrl = await getWebsiteUrl();
    logBatchSubmit('verify.link_start', {
      promotionHost: normalizePromotionTargetLocal(promotionWebsiteUrl).hostname
    });
    const latestHtml = await getCurrentPageHtmlForVerification();
    const linkVerification = verifyBacklinkInHtmlLocal(latestHtml, promotionWebsiteUrl);
    logBatchSubmit('verify.link_done', {
      linkVerified: linkVerification.linkVerified,
      promotionHost: linkVerification.promotionHost,
      candidateCount: linkVerification.candidateCount,
      hostMatchedCount: linkVerification.hostMatchedCount,
      pathMatched: linkVerification.pathMatched,
      matchedHref: linkVerification.matchedHref,
      reason: linkVerification.reason
    });
```

Then return:

```js
    if (linkVerification.linkVerified) {
      return {
        result: 'success',
        reason: 'backlink_anchor_found',
        confidence: 'strong',
        linkVerification
      };
    }

    const last = lastEvidence || {
      triggerResult: clickResult && clickResult.submitResult ? clickResult.submitResult : 'timeout'
    };
    const hadSubmitEvidence = !!(
      last.triggerResult && last.triggerResult !== 'timeout' && last.triggerResult !== 'cancelled' ||
      last.successMessageFound ||
      last.textareaCleared ||
      last.navigationObserved
    );
    if (hadSubmitEvidence) {
      return {
        result: 'submitted_unconfirmed',
        reason: 'submit_evidence_without_backlink',
        confidence: last.successMessageFound ? 'medium' : 'weak',
        linkVerification
      };
    }

    return {
      result: 'fail',
      reason: 'submit_not_triggered',
      confidence: 'strong',
      linkVerification
    };
```

Keep explicit error / manual required early returns before this final verification, but do not return `success` from success text alone.

- [ ] **Step 4: Include link verification in result payloads**

In `handleBatchTask`, after `const submitOutcome = await observeSubmitOutcome(...)`, include link fields in logs:

```js
      logBatchSubmit('submit.final_outcome', {
        triggerResult: clickResult.submitResult || '',
        finalResult,
        reason: submitOutcome.reason,
        confidence: submitOutcome.confidence,
        linkVerified: !!(submitOutcome.linkVerification && submitOutcome.linkVerification.linkVerified),
        matchedHref: submitOutcome.linkVerification ? submitOutcome.linkVerification.matchedHref : ''
      });
```

When building `payload = buildBatchConfirmPayloadLocal(...)`, add:

```js
          linkVerified: !!(submitOutcome.linkVerification && submitOutcome.linkVerification.linkVerified),
          matchedHref: submitOutcome.linkVerification ? submitOutcome.linkVerification.matchedHref : '',
          linkVerification: submitOutcome.linkVerification || null,
```

- [ ] **Step 5: Syntax check**

Run:

```powershell
node --check content.js
```

Expected: exit code 0.

- [ ] **Step 6: Sync after passing syntax check**

Run:

```powershell
Copy-Item -LiteralPath content.js -Destination dist\auto-comment-plugin\content.js -Force
Copy-Item -LiteralPath content.js -Destination D:\WORK\AI_Work\backlinkautocomment\load-this-extension\content.js -Force
```

Expected: no output and no error.

---

### Task 5: background.js 持久化验链结果

**Files:**
- Modify: `autoComment/background.js`
- Modify: `autoComment/dist/auto-comment-plugin/background.js`
- Modify: `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\background.js`
- Test: `node --check background.js`

**Interfaces:**
- Consumes `BATCH_HANDLE_CONFIRM` payload fields:
  - `linkVerified: boolean`
  - `matchedHref: string`
  - `linkVerification: object | null`
- Persists same fields in `batchResults`.
- Forwards same fields in `BATCH_CONFIRMED`.

- [ ] **Step 1: Update `persistBatchReport` destructuring**

In `autoComment/background.js`, update the `persistBatchReport(message)` destructuring to include:

```js
const {
  batchId,
  urlIndex,
  url: pageUrl = '',
  result,
  aiContent,
  errorMessage,
  promotionWebsiteUrl = '',
  promotionWebsiteKey = '',
  copyPromotionWebsiteKey = '',
  confirmedBy = '',
  confirmedAt = null,
  linkVerified = false,
  matchedHref = '',
  linkVerification = null
} = message;
```

- [ ] **Step 2: Store link fields in entry**

Add these fields to `entry`:

```js
    linkVerified: !!linkVerified,
    matchedHref: matchedHref || '',
    linkVerification: linkVerification || null,
```

- [ ] **Step 3: Forward link fields to batch page**

In the `chrome.runtime.sendMessage({ type: 'BATCH_CONFIRMED', ... })` payload, add:

```js
          linkVerified: !!message.linkVerified,
          matchedHref: message.matchedHref || '',
          linkVerification: message.linkVerification || null
```

- [ ] **Step 4: Syntax check**

Run:

```powershell
node --check background.js
```

Expected: exit code 0.

- [ ] **Step 5: Sync background script**

Run:

```powershell
Copy-Item -LiteralPath background.js -Destination dist\auto-comment-plugin\background.js -Force
Copy-Item -LiteralPath background.js -Destination D:\WORK\AI_Work\backlinkautocomment\load-this-extension\background.js -Force
```

Expected: no output and no error.

---

### Task 6: batch.js 持久化运行态和刷新恢复

**Files:**
- Modify: `autoComment/lib/batch-submit-logic.js`
- Modify: `autoComment/tests/batch-submit-logic.test.js`
- Modify: `autoComment/batch.js`
- Modify: `autoComment/dist/auto-comment-plugin/batch.js`
- Modify: `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\batch.js`

**Interfaces:**
- Produces pure helper:
  - `mergeBatchRuntimeState(previous: object, patch: object): object`
- Produces batch storage key in `batch.js`:
  - `BATCH_RUNTIME_STATE_KEY = 'batch_runtime_state_v1'`
- Runtime snapshot shape:
  - `batchId: string`
  - `status: string`
  - `totalCount: number`
  - `currentIndex: number`
  - `parsedUrls: Array<{ url: string, sourceDomain?: string, originalRow?: object }>`
  - `localResults: Array<object>`
  - `currentPromotionWebsiteUrl: string`
  - `updatedAt: number`

- [ ] **Step 1: Write failing pure helper tests**

Append to `autoComment/tests/batch-submit-logic.test.js`:

```js
test('mergeBatchRuntimeState replaces results by originalIndex', () => {
  const { mergeBatchRuntimeState } = require('../lib/batch-submit-logic');
  const previous = {
    batchId: 'batch-1',
    localResults: [{ originalIndex: 0, result: 'fail' }]
  };
  const next = mergeBatchRuntimeState(previous, {
    localResults: [{ originalIndex: 0, result: 'success' }, { originalIndex: 1, result: 'submitted_unconfirmed' }]
  });

  assert.equal(next.localResults.length, 2);
  assert.equal(next.localResults[0].result, 'success');
  assert.equal(next.localResults[1].result, 'submitted_unconfirmed');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: FAIL with `mergeBatchRuntimeState is not a function`.

- [ ] **Step 3: Implement merge helper**

Add to `autoComment/lib/batch-submit-logic.js`:

```js
function mergeBatchRuntimeState(previous, patch) {
  const base = isObject(previous) ? previous : {};
  const update = isObject(patch) ? patch : {};
  const merged = { ...base, ...update };
  const byIndex = new Map();
  for (const item of Array.isArray(base.localResults) ? base.localResults : []) {
    if (item && item.originalIndex !== undefined) byIndex.set(item.originalIndex, item);
  }
  for (const item of Array.isArray(update.localResults) ? update.localResults : []) {
    if (item && item.originalIndex !== undefined) {
      byIndex.set(item.originalIndex, { ...(byIndex.get(item.originalIndex) || {}), ...item });
    }
  }
  merged.localResults = Array.from(byIndex.values()).sort((a, b) => Number(a.originalIndex) - Number(b.originalIndex));
  merged.updatedAt = update.updatedAt || Date.now();
  return merged;
}
```

Export `mergeBatchRuntimeState`.

- [ ] **Step 4: Run pure tests and verify GREEN**

Run:

```powershell
npm test -- tests/batch-submit-logic.test.js
```

Expected: PASS.

- [ ] **Step 5: Add runtime storage helpers in `batch.js`**

Near storage constants in `autoComment/batch.js`, add:

```js
const BATCH_RUNTIME_STATE_KEY = 'batch_runtime_state_v1';
```

Add helpers near `saveLocalResults()`:

```js
function buildBatchRuntimeSnapshot() {
  return {
    batchId,
    status,
    totalCount,
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
```

- [ ] **Step 6: Call runtime persistence at state changes**

Add `persistBatchRuntimeState();` after these existing points:

```js
// at the end of startBatch(), after status/UI initialization and before openNextTabSync()
persistBatchRuntimeState();

// at the end of handleTabResult(), after saveLocalResults()
persistBatchRuntimeState();

// in stopBatch(), after updateUI()
persistBatchRuntimeState();

// in resumeBatch(), after setStatus('running') and updateUI()
persistBatchRuntimeState();
```

- [ ] **Step 7: Restore runtime state on batch page load**

Add function in `batch.js`:

```js
async function restoreBatchRuntimeState() {
  const data = await new Promise((resolve) => chrome.storage.local.get([BATCH_RUNTIME_STATE_KEY], resolve));
  const snapshot = data[BATCH_RUNTIME_STATE_KEY];
  if (!snapshot || !snapshot.batchId || !Array.isArray(snapshot.parsedUrls)) return false;
  if (Date.now() - Number(snapshot.updatedAt || 0) > 24 * 60 * 60 * 1000) return false;

  batchId = snapshot.batchId;
  status = snapshot.status === 'running' ? 'terminated' : snapshot.status;
  totalCount = Number(snapshot.totalCount || snapshot.parsedUrls.length || 0);
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

  renderUrlPreview();
  renderStats();
  updateStatsUI();
  updateUI();
  setStatus(status || 'terminated');
  console.log('[batch][runtime] restored', { batchId, status, totalCount, resultCount: localResults.length });
  return true;
}
```

Call it from the page initialization path after DOM/event setup and before normal empty-state UI finalization:

```js
restoreBatchRuntimeState().catch((error) => {
  console.warn('[batch][runtime] restore failed:', error);
});
```

- [ ] **Step 8: Syntax check**

Run:

```powershell
node --check batch.js
```

Expected: exit code 0.

- [ ] **Step 9: Sync batch script**

Run:

```powershell
Copy-Item -LiteralPath batch.js -Destination dist\auto-comment-plugin\batch.js -Force
Copy-Item -LiteralPath batch.js -Destination D:\WORK\AI_Work\backlinkautocomment\load-this-extension\batch.js -Force
```

Expected: no output and no error.

---

### Task 7: 目标页恢复规则调整

**Files:**
- Modify: `autoComment/content.js`
- Test: `node --check content.js`

**Interfaces:**
- Consumes existing storage keys:
  - `batchSubmitCtx`
  - `batch_pending_task`
- Behavior:
  - If `batchSubmitCtx.result === 'submitted_unconfirmed'`, restore does link verification first.
  - If link is found, report `success`.
  - If no link and no error, report `submitted_unconfirmed`.
  - If pending task has not submitted, continue `handleBatchTask`.

- [ ] **Step 1: Update restore outcome to verify backlink**

In `confirmRestoredBatchSubmit(ctx)`, replace success-message-only restoration with link verification:

```js
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const promotionUrl = ctx.promotionWebsiteUrl || await getWebsiteUrl();
    const html = await getCurrentPageHtmlForVerification();
    const linkVerification = verifyBacklinkInHtmlLocal(html, promotionUrl);
    const explicitError = detectCommentSubmitError();
    const successMessageFound = !!detectSubmitSuccessMessage();
    const restoredOutcome = linkVerification.linkVerified
      ? { result: 'success', reason: 'backlink_anchor_found_after_restore', confidence: 'strong', linkVerification }
      : classifyRestoredSubmitEvidenceLocal({
          explicitError,
          successMessageFound,
          commentAppeared: false
        });
    if (!linkVerification.linkVerified && restoredOutcome.result === 'success') {
      restoredOutcome.result = 'submitted_unconfirmed';
      restoredOutcome.reason = 'restored_success_evidence_without_backlink';
      restoredOutcome.confidence = 'medium';
      restoredOutcome.linkVerification = linkVerification;
    }
```

Ensure `buildBatchConfirmPayloadLocal` receives:

```js
        result: restoredOutcome.result,
        errorMessage: restoredOutcome.result === 'success' ? null : restoredOutcome.reason,
        linkVerified: linkVerification.linkVerified,
        matchedHref: linkVerification.matchedHref,
        linkVerification
```

- [ ] **Step 2: Keep pending task restart only for not-yet-submitted tasks**

In `tryStartPendingBatchTaskFromStorage()`, before calling `handleBatchTask`, check `batchSubmitCtx`:

```js
    const submitData = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx'], resolve));
    const submitCtx = submitData.batchSubmitCtx;
    if (submitCtx && submitCtx.batchId === pending.batchId && submitCtx.urlIndex === pending.urlIndex) {
      console.log('[content] pending task has submit context; restore submit confirmation instead of restarting');
      await confirmRestoredBatchSubmit(submitCtx);
      return;
    }
```

- [ ] **Step 3: Syntax check**

Run:

```powershell
node --check content.js
```

Expected: exit code 0.

- [ ] **Step 4: Sync content script**

Run:

```powershell
Copy-Item -LiteralPath content.js -Destination dist\auto-comment-plugin\content.js -Force
Copy-Item -LiteralPath content.js -Destination D:\WORK\AI_Work\backlinkautocomment\load-this-extension\content.js -Force
```

Expected: no output and no error.

---

### Task 8: Full verification and local handoff

**Files:**
- Verify: `autoComment/content.js`
- Verify: `autoComment/background.js`
- Verify: `autoComment/batch.js`
- Verify: `autoComment/lib/batch-submit-logic.js`
- Verify: `autoComment/tests/*.test.js`
- Verify: `autoComment/dist/auto-comment-plugin/*`
- Verify: `D:\WORK\AI_Work\backlinkautocomment\load-this-extension\*`

**Interfaces:**
- No new interfaces. This task verifies the complete change set and prepares user testing.

- [ ] **Step 1: Run all automated tests**

Run:

```powershell
npm test
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
node --check content.js
node --check batch.js
node --check background.js
node --check D:\WORK\AI_Work\backlinkautocomment\load-this-extension\content.js
node --check D:\WORK\AI_Work\backlinkautocomment\load-this-extension\batch.js
node --check D:\WORK\AI_Work\backlinkautocomment\load-this-extension\background.js
```

Expected: all commands exit 0.

- [ ] **Step 3: Run mojibake scan**

Run:

```powershell
node scripts\scan-mojibake.js
```

Expected: `No common mojibake patterns found.`

- [ ] **Step 4: Confirm extension files are synced**

Run:

```powershell
Compare-Object (Get-FileHash content.js).Hash (Get-FileHash D:\WORK\AI_Work\backlinkautocomment\load-this-extension\content.js).Hash
Compare-Object (Get-FileHash batch.js).Hash (Get-FileHash D:\WORK\AI_Work\backlinkautocomment\load-this-extension\batch.js).Hash
Compare-Object (Get-FileHash background.js).Hash (Get-FileHash D:\WORK\AI_Work\backlinkautocomment\load-this-extension\background.js).Hash
```

Expected: no differences printed.

- [ ] **Step 5: Manual browser test**

Ask the user to refresh the extension in Chrome, then run a two-row CSV:

```text
https://chhs.news.niu.edu/2025/01/15/niu-school-of-nursing-adds-hispanic-student-nurses-alianza-hsna-to-support-students/
https://www.papertraildesign.com/diy-guess-who-template/
```

Expected observations:

- First URL should not hang indefinitely at `submit.before_click`.
- If captcha or challenge appears, result becomes `manual_required`.
- PaperTrailDesign should reach `submit.click_done`, then `verify.link_done`.
- If submitted but backlink is not visible in source, result is `submitted_unconfirmed`.
- If backlink anchor appears in source, result is `success`.

- [ ] **Step 6: Review debug logs after manual test**

Run:

```powershell
Get-Content output\debug\extension-debug.jsonl -Tail 240
```

Expected: Each tested URL includes:

```text
task.start
form.scan or form.initial_scan/form.final_scan
ai.generate_done
fill.comment_done
submit.click_start
submit.click_done
verify.link_start
verify.link_done
submit.final_outcome
```

---

## Self-Review

- Spec coverage:
  - 源码 `<a href>` 验链：Task 1, Task 2, Task 4, Task 7。
  - 快速点击不卡死：Task 3。
  - batch 页面刷新恢复：Task 6。
  - 目标页面刷新恢复：Task 7。
  - background 落盘和转发验链字段：Task 5。
  - 同步加载目录和验证：Task 8。

- Placeholder scan:
  - 本计划不包含 `TBD`、`TODO`、`待定`。
  - 每个任务都有具体文件、接口、命令、期望结果。

- Type consistency:
  - `verifyBacklinkInHtml`、`classifyPostSubmitResult`、`mergeBatchRuntimeState` 都在 `lib/batch-submit-logic.js` 定义并导出。
  - content 侧使用 browser-local 同名逻辑，避免 Manifest V3 content script 直接依赖 CommonJS。
  - `linkVerification` 字段从 content -> background -> batch 持续传递。
