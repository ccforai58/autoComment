# AI 模型配置页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a homepage-linked, secure local configuration page for OpenAI-compatible models with PackyAPI defaults, real connectivity testing, and startup availability diagnostics.

**Architecture:** Create a pure model-settings service to parse, validate, mask, persist, and probe model configuration. Expose it through an Express router and have generation and local-status consume the same runtime settings. Add a standalone extension page that calls only the local backend and never reads a plaintext token.

**Tech Stack:** Node.js, Express, dotenv, Chrome extension HTML/CSS/JavaScript, Node test runner.

## Global Constraints

- Save the token only to local ignored `.env`; never return, log, or persist it in extension storage.
- Support generic OpenAI-compatible `chat_completions` and `responses` requests.
- PackyAPI preset defaults to `https://www.packyapi.com/v1` and `/chat/completions`.
- Use real, short model requests for manual tests and asynchronous startup diagnostics.
- Preserve all existing `MODEL_*` environment-variable compatibility and generation behavior.

---

### Task 1: Add pure model-settings service and tests

**Files:**
- Create: `lib/model-settings.js`
- Create: `tests/model-settings.test.js`

**Interfaces:**
- Produces: `getModelSettings()`, `saveModelSettings(input)`, `testModelConnection(options)`, `getModelHealth()`, `refreshModelHealth()`.

- [ ] Write failing tests for PackyAPI defaults, token masking, invalid settings, chat/responses request bodies, and safe error summaries.
- [ ] Run `node --test tests/model-settings.test.js` and confirm failures for missing module.
- [ ] Implement environment parsing, `.env` atomic update, runtime update, and probe requests with sanitized logs.
- [ ] Run `node --test tests/model-settings.test.js` and confirm pass.

### Task 2: Add backend API and startup diagnostics

**Files:**
- Create: `api/model-settings.js`
- Modify: `api/local-status.js`
- Modify: `server.js`
- Test: `tests/model-settings.test.js`

**Interfaces:**
- `GET /api/model-settings` returns masked configuration and health.
- `PUT /api/model-settings` saves settings without echoing the token.
- `POST /api/model-settings/test` runs a live probe.

- [ ] Add failing router tests for masked reads, save validation, and probe result responses.
- [ ] Implement routes, mount router, and trigger background health refresh after server listen.
- [ ] Extend `/api/local-status` with actual model health without blocking database status.
- [ ] Run `node --test tests/model-settings.test.js` and confirm pass.

### Task 3: Add homepage entry and configuration page

**Files:**
- Create: `model-settings.html`
- Create: `model-settings.js`
- Create: `model-settings.css`
- Modify: `index.html`
- Test: `tests/model-settings.test.js`

**Interfaces:**
- Homepage link opens `model-settings.html`.
- Page loads masked settings, saves user edits, and displays live test result.

- [ ] Add static-page assertions for the homepage entry and configuration controls.
- [ ] Implement accessible configuration form, PackyAPI preset action, token-presence indicator, save action, and test action.
- [ ] Run focused tests and inspect the page through Playwright.

### Task 4: Validate local stack and real connectivity

**Files:**
- No source-file changes.

- [ ] Run `npm test` and confirm all tests pass.
- [ ] Restart `npm run local:stack:stop` then `npm run local:stack:start`.
- [ ] Verify `GET /health`, `GET /api/local-status`, and masked `GET /api/model-settings`.
- [ ] Through Playwright, open the homepage, follow the configuration entry, and verify the page renders without exposing the token.
