const test = require('node:test');
const assert = require('node:assert/strict');
const runtimeLogic = require('../lib/link-assistant-runtime-logic');

const {
  createMemoryLinkAssistantStore,
  createLinkAssistantService,
  filterResourceRowsForQuery,
  toMysqlDateTime
} = require('../api/link-assistant');

test('formats ISO timestamps for MySQL datetime columns', () => {
  assert.equal(toMysqlDateTime('2026-07-15T10:27:08.322Z'), '2026-07-15 10:27:08');
});

test('filterResourceRowsForQuery applies resource library toolbar filters', () => {
  const rows = [
    {
      id: 'match',
      promotionProjectId: 2,
      sourceUrl: 'https://source.test/blog',
      sourceDomain: 'source.test',
      sourceTitle: 'Blog comment about flowers',
      firstDiscoveryTargetUrl: 'https://discover.test/page',
      discoveryTargetUrlsJson: JSON.stringify(['https://discover.test/page']),
      resourceType: 'blog_comment',
      qualityLabel: 'good',
      pageAscore: 20,
      notes: 'garden note',
      submitSource: 'manual_assistant'
    },
    {
      id: 'other-project',
      promotionProjectId: 1,
      sourceUrl: 'https://source.test/blog',
      firstDiscoveryTargetUrl: 'https://discover.test/page',
      resourceType: 'blog_comment',
      qualityLabel: 'good',
      pageAscore: 20
    },
    {
      id: 'other-type',
      promotionProjectId: 2,
      sourceUrl: 'https://directory.test/page',
      firstDiscoveryTargetUrl: 'https://discover.test/page',
      resourceType: 'directory',
      qualityLabel: 'good',
      pageAscore: 20
    }
  ];

  const filtered = filterResourceRowsForQuery(rows, {
    promotionProjectId: '2',
    discoveryTargetUrl: 'https://discover.test/page/',
    resourceType: 'blog_comment',
    qualityLabel: 'good',
    keyword: 'flowers',
    submitSource: 'manual_assistant',
    minPageAscore: '10',
    maxPageAscore: '30'
  });

  assert.deepEqual(filtered.map((row) => row.id), ['match']);
});

test('filterResourceRowsForQuery filters by submit source', () => {
  const rows = [
    { id: 'manual', submitSource: 'manual_assistant' },
    { id: 'batch', submit_source: 'batch_auto' },
    { id: 'custom', submitSource: 'manual_import' },
    { id: 'empty', submitSource: '' }
  ];

  assert.deepEqual(filterResourceRowsForQuery(rows, { submitSource: 'manual_assistant' }).map((row) => row.id), ['manual']);
  assert.deepEqual(filterResourceRowsForQuery(rows, { submitSource: 'batch_auto' }).map((row) => row.id), ['batch']);
  assert.deepEqual(filterResourceRowsForQuery(rows, { submitSource: 'other' }).map((row) => row.id), ['custom', 'empty']);
});

test('batch promotion context locks the project carried by BATCH_HANDLE', () => {
  const context = runtimeLogic.normalizeBatchPromotionContext({
    batchId: 'batch-1',
    urlIndex: 3,
    url: 'https://source.example/post',
    promotionProject: {
      id: 7,
      targetUrl: 'https://nameintoflowers.com/',
      targetDomain: 'nameintoflowers.com',
      keywords: ['name into flowers'],
      pageTitle: 'Name Into Flowers',
      metaDescription: 'Create flower name art',
      h1: 'Flower Names',
      commentAuthor: 'Flower Team',
      contactEmail: 'hello@example.com'
    },
    targetUrl: 'https://ainail.design/'
  });

  assert.equal(context.batchId, 'batch-1');
  assert.equal(context.urlIndex, 3);
  assert.equal(context.promotionProjectId, 7);
  assert.equal(context.promotionWebsiteUrl, 'https://nameintoflowers.com/');
  assert.equal(context.promotionWebsiteKey, 'https://nameintoflowers.com');
  assert.equal(context.targetDomain, 'nameintoflowers.com');
  assert.equal(context.promotionProject.commentAuthor, 'Flower Team');
});

test('batch AI copy reuse is blocked when promotion website key differs', () => {
  assert.equal(runtimeLogic.canReuseAiCopyForPromotion({
    currentPromotionWebsiteKey: 'https://nameintoflowers.com',
    reusableCopy: {
      text: 'Generated copy for another website',
      promotionWebsiteKey: 'https://ainail.design'
    }
  }), false);

  assert.equal(runtimeLogic.canReuseAiCopyForPromotion({
    currentPromotionWebsiteKey: 'https://nameintoflowers.com',
    reusableCopy: {
      text: 'Generated copy for this website',
      promotionWebsiteKey: 'https://nameintoflowers.com'
    }
  }), true);
});

test('initial manual autofill does not fall back to legacy website while current project is pending', () => {
  const pending = runtimeLogic.selectInitialAutofillProfile({
    currentPromotionProjectId: 8,
    project: null,
    legacyUrl: 'https://ainail.design/',
    userProfile: {
      name: 'Legacy Author',
      email: 'legacy@example.com'
    }
  });

  assert.equal(pending.ready, false);
  assert.equal(pending.website, '');
  assert.equal(pending.name, '');
  assert.equal(pending.email, '');
  assert.equal(pending.source, 'current_project_pending');

  const ready = runtimeLogic.selectInitialAutofillProfile({
    currentPromotionProjectId: 8,
    project: {
      id: 8,
      targetUrl: 'https://nameintoflowers.com/',
      commentAuthor: 'Flower Team',
      contactEmail: 'hello@nameintoflowers.com'
    },
    legacyUrl: 'https://ainail.design/',
    userProfile: {
      name: 'Legacy Author',
      email: 'legacy@example.com'
    }
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.website, 'https://nameintoflowers.com/');
  assert.equal(ready.name, 'Flower Team');
  assert.equal(ready.email, 'hello@nameintoflowers.com');
  assert.equal(ready.source, 'current_project');
});

test('legacy page automation is suppressed for a pending batch task on the current page', () => {
  assert.equal(runtimeLogic.shouldSuppressLegacyPageAutomation({
    currentUrl: 'https://source.example/post?reply=1',
    pendingTask: {
      batchId: 'batch-1',
      url: 'https://source.example/post'
    },
    activeTask: {
      batchId: 'batch-1',
      status: 'running',
      updatedAt: Date.now()
    },
    now: Date.now()
  }), true);

  assert.equal(runtimeLogic.shouldSuppressLegacyPageAutomation({
    currentUrl: 'https://other.example/post',
    pendingTask: {
      batchId: 'batch-1',
      url: 'https://source.example/post'
    },
    activeTask: null,
    now: Date.now()
  }), false);
});

test('manual homepage profile cache uses configurable ttl hours', () => {
  assert.equal(runtimeLogic.normalizeHomepageProfileCacheTtlHours(''), 24);
  assert.equal(runtimeLogic.normalizeHomepageProfileCacheTtlHours('6'), 6);
  assert.equal(runtimeLogic.normalizeHomepageProfileCacheTtlHours('-1'), 24);
  assert.equal(runtimeLogic.normalizeHomepageProfileCacheTtlHours('999'), 168);

  const now = Date.parse('2026-07-20T10:00:00.000Z');
  assert.equal(runtimeLogic.isHomepageProfileCacheFresh({
    cachedAt: '2026-07-19T11:00:00.000Z',
    now,
    ttlHours: 24
  }), true);
  assert.equal(runtimeLogic.isHomepageProfileCacheFresh({
    cachedAt: '2026-07-19T09:00:00.000Z',
    now,
    ttlHours: 24
  }), false);
});

test('homepage metadata profile carries richer fields for manual assistant generation', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-20T08:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(url, 'https://example-promo.test/');
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => 'text/html; charset=utf-8' },
        async text() {
          return `
            <!doctype html>
            <html>
              <head>
                <title>Flower Name Art</title>
                <meta name="description" content="Turn names into flower artwork.">
                <meta name="keywords" content="flower name art, custom floral names">
                <meta property="og:title" content="OG Flower Name Art">
                <meta property="og:description" content="Personalized floral gifts.">
              </head>
              <body>
                <h1>Custom Flower Names</h1>
                <h2>Personalized floral posters</h2>
                <img src="/hero.jpg" alt="flower name poster preview">
                <p>Create a meaningful keepsake by turning a name into a floral illustration for birthdays and home decor.</p>
              </body>
            </html>
          `;
        }
      };
    }
  });

  const metadata = await service.fetchPromotionMetadata({ targetUrl: 'https://example-promo.test/' });

  assert.deepEqual(metadata.h2Texts, ['Personalized floral posters']);
  assert.deepEqual(metadata.imageAlts, ['flower name poster preview']);
  assert.equal(metadata.ogTitle, 'OG Flower Name Art');
  assert.equal(metadata.ogDescription, 'Personalized floral gifts.');
  assert.match(metadata.bodySummary, /meaningful keepsake/);
});

test('fetching promotion metadata extracts page fields for settings autofill', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-16T08:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(url, 'https://ainail.design/');
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => 'text/html; charset=utf-8' },
        async text() {
          return `
            <!doctype html>
            <html>
              <head>
                <title>AI Nail Design Generator</title>
                <meta name="description" content="Create nail art ideas with AI.">
                <meta name="keywords" content="AI nail, nail design, manicure ideas">
              </head>
              <body>
                <h1>AI Nail Ideas</h1>
              </body>
            </html>
          `;
        }
      };
    }
  });

  const metadata = await service.fetchPromotionMetadata({ targetUrl: 'ainail.design' });

  assert.equal(metadata.targetUrl, 'https://ainail.design/');
  assert.equal(metadata.targetDomain, 'ainail.design');
  assert.deepEqual(metadata.keywords, ['AI nail', 'nail design', 'manicure ideas']);
  assert.equal(metadata.pageTitle, 'AI Nail Design Generator');
  assert.equal(metadata.metaDescription, 'Create nail art ideas with AI.');
  assert.equal(metadata.h1, 'AI Nail Ideas');
  assert.equal(metadata.fetchStatus, 'success');
  assert.equal(metadata.fetchError, '');
  assert.equal(metadata.fetchedAt, '2026-07-16T08:00:00.000Z');
});

test('saving a submission does not insert resource pages before backlink verification', async () => {
  const calls = [];
  let nextId = 1;
  const store = {
    async ensureTables() {},
    async listProjects() { return []; },
    async saveProject(project, now) {
      return { ...project, id: nextId++, createdAt: now, updatedAt: now };
    },
    async getProject() { return null; },
    async deleteProject() { return false; },
    async upsertResourcePage() {
      calls.push('upsertResourcePage');
      throw new Error('resource page should not be upserted during submission save');
    },
    async saveSubmission(submission, now) {
      return { ...submission, id: nextId++, createdAt: now, updatedAt: now };
    },
    async getSubmission() { return null; },
    async updateSubmissionBacklinkCheck() { return null; },
    async upsertVerifiedBacklink() { return null; },
    async listResources() { return []; },
    async patchResourcePage() { return null; },
    async deleteResourcePage() { return false; }
  };
  const service = createLinkAssistantService({
    store,
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const submission = await service.saveSubmission({
    targetUrl: 'https://ainail.design/',
    sourceUrl: 'https://example.com/post',
    submitResult: 'success'
  });

  assert.equal(submission.sourceUrl, 'https://example.com/post');
  assert.equal(submission.resourcePageId, null);
  assert.deepEqual(calls, []);
});

test('manual assistant submission metadata is preserved in raw payload', async () => {
  let savedSubmission = null;
  let nextId = 1;
  const store = {
    async ensureTables() {},
    async listProjects() { return []; },
    async saveProject(project, now) {
      return { ...project, id: nextId++, createdAt: now, updatedAt: now };
    },
    async getProject() { return null; },
    async deleteProject() { return false; },
    async upsertResourcePage() {
      throw new Error('resource page should not be upserted during submission save');
    },
    async saveSubmission(submission, now) {
      savedSubmission = { ...submission, id: nextId++, createdAt: now, updatedAt: now };
      return { ...savedSubmission };
    },
    async getSubmission() { return savedSubmission ? { ...savedSubmission } : null; },
    async updateSubmissionBacklinkCheck() { return null; },
    async upsertVerifiedBacklink() { return null; },
    async listResources() { return []; },
    async patchResourcePage() { return null; },
    async deleteResourcePage() { return false; }
  };
  const service = createLinkAssistantService({
    store,
    now: () => new Date('2026-07-18T08:00:00.000Z')
  });

  await service.saveSubmission({
    targetUrl: 'https://ainail.design/',
    sourceUrl: 'https://example.com/submit',
    submitResult: 'submitted_unconfirmed',
    submitSource: 'manual_assistant',
    submitMode: 'manual',
    pageType: 'directory_submission',
    detectorVersion: 'manual-assistant-detector-2026-07-18-v1',
    submissionSourceUrl: 'https://example.com/submit',
    detectedExistingBacklink: true,
    existingBacklinkHref: 'https://ainail.design/'
  });

  assert.equal(savedSubmission.rawPayload.submitSource, 'manual_assistant');
  assert.equal(savedSubmission.submitSource, 'manual_assistant');
  assert.equal(savedSubmission.rawPayload.submitMode, 'manual');
  assert.equal(savedSubmission.rawPayload.pageType, 'directory_submission');
  assert.equal(savedSubmission.rawPayload.detectorVersion, 'manual-assistant-detector-2026-07-18-v1');
  assert.equal(savedSubmission.rawPayload.submissionSourceUrl, 'https://example.com/submit');
  assert.equal(savedSubmission.rawPayload.detectedExistingBacklink, true);
});

test('manual resource save creates resource pool entry without verified backlink', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-18T08:00:00.000Z')
  });

  const saved = await service.saveResourcePage({
    sourceUrl: 'https://directory.example/submit',
    sourceTitle: 'Submit AI tools',
    resourceType: 'directory_submission',
    qualityLabel: 'high',
    pageAscore: 37,
    externalLinks: 1200,
    notes: 'manual resource pool entry',
    submitSource: 'manual_assistant'
  });

  assert.equal(saved.sourceUrl, 'https://directory.example/submit');
  assert.equal(saved.resourceType, 'directory_submission');
  assert.equal(saved.qualityLabel, 'high');

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].sourceUrl, 'https://directory.example/submit');
  assert.equal(resources[0].resourceType, 'directory_submission');
  assert.equal(resources[0].submitSource, 'manual_assistant');
  assert.equal(resources[0].backlinkStatus, '');
  assert.equal(resources[0].promotionProjectId, '');
});

test('manual resource save keeps promotion project fields for resource filtering', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-18T08:00:00.000Z')
  });

  const project = await service.savePromotionProject({
    targetUrl: 'https://ainail.design/',
    keywords: ['AI nail']
  });
  await service.saveResourcePage({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    targetDomain: project.targetDomain,
    sourceUrl: 'https://directory.example/submit',
    sourceTitle: 'Submit AI tools',
    resourceType: 'directory_submission',
    submitSource: 'manual_assistant'
  });

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(String(resources[0].promotionProjectId), String(project.id));
  assert.equal(resources[0].targetUrl, 'https://ainail.design/');
  assert.equal(resources[0].targetDomain, 'ainail.design');
  assert.equal(filterResourceRowsForQuery(resources, { promotionProjectId: project.id }).length, 1);
  assert.equal(filterResourceRowsForQuery(resources, { promotionProjectId: '999' }).length, 0);
});

test('successful backlink check upserts one verified resource', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const project = await service.savePromotionProject({
    targetUrl: 'https://ainail.design/',
    keywords: ['AI nail']
  });

  const submission = await service.saveSubmission({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    sourceUrl: 'https://example.com/post#comments',
    sourceTitle: 'Example post',
    resourceType: 'blog_comment',
    discoveryTargetUrl: 'https://semrush.example/discovery',
    submitResult: 'success'
  });

  const synced = await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/',
    latestBacklinkReason: 'matching_anchor_href_found'
  });

  assert.equal(synced.syncedToResourceLibrary, true);

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].sourceUrl, 'https://example.com/post#comments');
  assert.equal(resources[0].sourceDomain, 'example.com');
  assert.equal(resources[0].targetUrl, 'https://ainail.design/');
  assert.equal(resources[0].backlinkStatus, 'success');
  assert.equal(resources[0].firstVerifiedAt, '2026-07-15T10:01:00.000Z');
  assert.equal(resources[0].lastVerifiedAt, '2026-07-15T10:01:00.000Z');
});

test('successful backlink check stores Semrush page ascore in resource library', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const project = await service.savePromotionProject({ targetUrl: 'https://ainail.design/' });
  const submission = await service.saveSubmission({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    sourceUrl: 'https://example.com/post',
    submitResult: 'success'
  });

  await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/',
    pageAscore: 42,
    externalLinks: 88,
    lastSeen: '2026-07-14'
  });

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].pageAscore, 42);
  assert.equal(resources[0].externalLinks, 88);
  assert.equal(resources[0].lastSeen, '2026-07-14');
});

test('successful backlink check stores original Semrush row data in resource library', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const project = await service.savePromotionProject({ targetUrl: 'https://ainail.design/' });
  const submission = await service.saveSubmission({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    sourceUrl: 'https://example.com/post',
    discoveryTargetUrl: 'https://discover.example/page',
    submitResult: 'success',
    semrushHeaders: ['Target url', 'Source url', 'Page ascore', 'Anchor'],
    semrushRow: ['https://discover.example/page', 'https://example.com/post', '42', 'old anchor']
  });

  await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/'
  });

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0].semrushHeaders, ['Target url', 'Source url', 'Page ascore', 'Anchor']);
  assert.deepEqual(resources[0].semrushRow, ['https://discover.example/page', 'https://example.com/post', '42', 'old anchor']);
});

test('non-success backlink check updates submission but does not enter resource library', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const project = await service.savePromotionProject({ targetUrl: 'https://ainail.design/' });
  const submission = await service.saveSubmission({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    sourceUrl: 'https://missing.example/post'
  });

  const synced = await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'missing',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkReason: 'no_matching_anchor_href'
  });

  assert.equal(synced.syncedToResourceLibrary, false);
  assert.equal((await service.listResources()).length, 0);
});

test('repeated successful checks update existing verified resource instead of duplicating it', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const project = await service.savePromotionProject({ targetUrl: 'https://ainail.design/' });
  const submission = await service.saveSubmission({
    promotionProjectId: project.id,
    targetUrl: project.targetUrl,
    sourceUrl: 'https://example.com/post'
  });

  await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/'
  });
  await service.saveBacklinkCheckResult({
    submissionId: submission.id,
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:05:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/'
  });

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].firstVerifiedAt, '2026-07-15T10:01:00.000Z');
  assert.equal(resources[0].lastVerifiedAt, '2026-07-15T10:05:00.000Z');
});

test('successful backlink check can recreate a missing submission before syncing the resource', async () => {
  const service = createLinkAssistantService({
    store: createMemoryLinkAssistantStore(),
    now: () => new Date('2026-07-15T10:00:00.000Z')
  });

  const synced = await service.saveBacklinkCheckResult({
    submissionId: 999,
    promotionProjectId: 123,
    targetUrl: 'https://ainail.design/',
    sourceUrl: 'https://example.com/post#comments',
    sourceTitle: 'Example post',
    sourceDomain: 'example.com',
    discoveryTargetUrl: 'https://semrush.example/discovery',
    latestBacklinkStatus: 'success',
    latestBacklinkCheckedAt: '2026-07-15T10:01:00.000Z',
    latestBacklinkMatchedHref: 'https://ainail.design/',
    latestBacklinkReason: 'matching_anchor_href_found'
  });

  assert.equal(synced.syncedToResourceLibrary, true);

  const resources = await service.listResources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].sourceUrl, 'https://example.com/post#comments');
  assert.equal(resources[0].targetUrl, 'https://ainail.design/');
  assert.equal(resources[0].backlinkStatus, 'success');
});
