const test = require('node:test');
const assert = require('node:assert/strict');

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
      notes: 'garden note'
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
    minPageAscore: '10',
    maxPageAscore: '30'
  });

  assert.deepEqual(filtered.map((row) => row.id), ['match']);
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
  assert.equal(resources[0].backlinkStatus, '');
  assert.equal(resources[0].promotionProjectId, '');
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
