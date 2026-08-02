const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  PACKYAPI_PRESET,
  normalizeModelSettings,
  maskApiKey,
  sanitizeModelError,
  saveModelSettings,
  testModelConnection
} = require('../lib/model-settings');

test('PackyAPI preset uses the OpenAI chat completions endpoint', () => {
  assert.deepEqual(PACKYAPI_PRESET, {
    apiBase: 'https://www.packyapi.com/v1',
    wireApi: 'chat_completions',
    chatPath: '/chat/completions'
  });
});

test('normalizeModelSettings validates OpenAI-compatible settings', () => {
  const settings = normalizeModelSettings({
    apiBase: 'https://www.packyapi.com/v1/',
    wireApi: 'chat_completions',
    chatPath: '/chat/completions',
    model: 'deepseek-chat',
    apiKey: 'test-api-token-value'
  });

  assert.equal(settings.apiBase, 'https://www.packyapi.com/v1');
  assert.equal(settings.model, 'deepseek-chat');
  assert.equal(settings.apiKey, 'test-api-token-value');
});

test('maskApiKey and sanitizeModelError never reveal tokens', () => {
  assert.equal(maskApiKey('test-api-token-value'), 'test...alue');
  assert.equal(sanitizeModelError('401 Bearer test-api-token-value failed', 'test-api-token-value'), '401 Bearer [REDACTED] failed');
});

test('testModelConnection sends the matching OpenAI-compatible request body', async () => {
  const requests = [];
  const result = await testModelConnection({
    apiBase: 'https://example.test/v1', wireApi: 'responses', chatPath: '/responses',
    model: 'test-model', apiKey: 'test-api-token-value'
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ output_text: 'OK' }) };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'test-model');
  assert.equal(requests[0].url, 'https://example.test/v1/responses');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    model: 'test-model',
    input: [
      { role: 'system', content: 'Reply with OK.' },
      { role: 'user', content: 'Ping.' }
    ]
  });
  assert.doesNotMatch(result.message, /token/i);
});

test('testModelConnection redacts token from failed probe messages', async () => {
  const result = await testModelConnection({
    apiBase: 'https://example.test/v1', wireApi: 'chat_completions', chatPath: '/chat/completions',
    model: 'test-model', apiKey: 'test-api-token-value'
  }, {
    fetchImpl: async () => { throw new Error('Bearer test-api-token-value rejected'); }
  });

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /test-api-token-value/);
  assert.match(result.message, /\[REDACTED\]/);
});

test('saveModelSettings keeps the existing token when the submitted token is empty', () => {
  const originalKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = 'test-existing-token';
  try {
    const saved = saveModelSettings({
      apiBase: 'https://example.test/v1', wireApi: 'chat_completions', chatPath: '/chat/completions',
      model: 'test-model', apiKey: ''
    }, { persist: false });
    assert.equal(saved.hasApiKey, true);
    assert.equal(process.env.MODEL_API_KEY, 'test-existing-token');
  } finally {
    if (originalKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = originalKey;
  }
});

test('model settings page exposes required controls and homepage entry', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '..', 'model-settings.html'), 'utf8');
  const homepage = fs.readFileSync(path.resolve(__dirname, '..', 'batch.html'), 'utf8');
  for (const id of ['packyPreset', 'apiBase', 'wireApi', 'chatPath', 'model', 'apiKey', 'save', 'test', 'result']) {
    assert.match(page, new RegExp(`id=["']${id}["']`));
  }
  assert.match(homepage, /id=["']modelSettingsBtn["']/);
});
