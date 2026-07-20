const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cancelModelRequest,
  extractModelText,
  generateWithModel,
  generateWithModelQueued
} = require('../lib/model-generate');
const {
  stripGeneratedCopyMarkdownFences
} = require('../lib/generated-copy-cleanup');
const { buildUserPrompt } = require('../lib/generate-copy-prompt');

test('generateWithModel falls back to chat completions when responses output is empty', async () => {
  const calls = [];
  const fakeFetch = async (endpoint, options) => {
    calls.push({ endpoint, body: JSON.parse(options.body) });

    if (endpoint.endsWith('/responses')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          output: []
        })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'A friendly generated comment with a useful website reference.'
            }
          }
        ]
      })
    };
  };

  const text = await generateWithModel('system prompt', 'user prompt', {
    fetchImpl: fakeFetch,
    allowChatFallback: true,
    emptyResponseRetries: 0,
    modelConfig: {
      endpoint: 'https://api.example.test/v1/responses',
      apiKey: 'test-key',
      model: 'test-model',
      wireApi: 'responses'
    }
  });

  assert.equal(text, 'A friendly generated comment with a useful website reference.');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpoint, 'https://api.example.test/v1/responses');
  assert.equal(calls[1].endpoint, 'https://api.example.test/v1/chat/completions');
  assert.deepEqual(calls[1].body.messages, [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'user prompt' }
  ]);
});

test('generateWithModel does not fall back to chat completions by default for empty responses output', async () => {
  const calls = [];
  const fakeFetch = async (endpoint, options) => {
    calls.push({ endpoint, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        output: []
      })
    };
  };

  await assert.rejects(
    () => generateWithModel('system prompt', 'user prompt', {
      fetchImpl: fakeFetch,
      emptyResponseRetries: 0,
      modelConfig: {
        endpoint: 'https://api.example.test/v1/responses',
        apiKey: 'test-key',
        model: 'test-model',
        wireApi: 'responses'
      }
    }),
    /chat fallback is disabled/
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'https://api.example.test/v1/responses');
});

test('generateWithModel retries transient model failures before reusing cached copy', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { code: 'upstream_error' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output_text: 'Fresh generated copy.'
      })
    };
  };

  const text = await generateWithModel('system prompt', 'user prompt', {
    fetchImpl: fakeFetch,
    transientRetries: 2,
    transientRetryBaseDelayMs: 0,
    emptyResponseRetries: 0,
    modelConfig: {
      endpoint: 'https://api.example.test/v1/responses',
      apiKey: 'test-key',
      model: 'test-model',
      wireApi: 'responses'
    }
  });

  assert.equal(text, 'Fresh generated copy.');
  assert.equal(calls, 3);
});

test('generateWithModelQueued serializes concurrent model calls', async () => {
  let active = 0;
  let maxActive = 0;
  const fakeFetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: 'Queued generated copy.' })
    };
  };
  const options = {
    fetchImpl: fakeFetch,
    minRequestIntervalMs: 0,
    emptyResponseRetries: 0,
    modelConfig: {
      endpoint: 'https://api.example.test/v1/responses',
      apiKey: 'test-key',
      model: 'test-model',
      wireApi: 'responses'
    }
  };

  await Promise.all([
    generateWithModelQueued('system prompt', 'user prompt', options),
    generateWithModelQueued('system prompt', 'user prompt', options)
  ]);

  assert.equal(maxActive, 1);
});

test('cancelModelRequest aborts an active queued model request', async () => {
  let signalSeen = null;
  const fakeFetch = async (endpoint, options) => {
    signalSeen = options.signal;
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  };
  const promise = generateWithModelQueued('system prompt', 'user prompt', {
    requestId: 'test-cancel-active',
    fetchImpl: fakeFetch,
    minRequestIntervalMs: 0,
    emptyResponseRetries: 0,
    modelConfig: {
      endpoint: 'https://api.example.test/v1/responses',
      apiKey: 'test-key',
      model: 'test-model',
      wireApi: 'responses'
    }
  });

  while (!signalSeen) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const result = cancelModelRequest('test-cancel-active', 'test_cancel');
  assert.equal(result.status, 'canceled');
  await assert.rejects(promise, /aborted|canceled/);
});

test('extractModelText supports chat message content arrays', () => {
  const text = extractModelText({
    choices: [
      {
        message: {
          content: [
            { type: 'text', text: 'First part.' },
            { type: 'text', text: 'Second part.' }
          ]
        }
      }
    ]
  });

  assert.equal(text, 'First part.\nSecond part.');
});

test('stripGeneratedCopyMarkdownFences removes wrapper fence without changing href newline', () => {
  const text = '```html\nHelpful note with <a href="https://example.com/\n">natural anchor</a> inside.\n```';

  const cleaned = stripGeneratedCopyMarkdownFences(text);

  assert.equal(cleaned, 'Helpful note with <a href="https://example.com/\n">natural anchor</a> inside.');
  assert.match(cleaned, /href="https:\/\/example\.com\/\n">/);
});

test('manual assistant prompt includes homepage profile and field specs', () => {
  const prompt = buildUserPrompt({
    websiteUrl: 'https://directory.example/submit',
    title: 'Submit a startup',
    description: 'Directory submission page',
    bodyText: 'Add your website to our directory.',
    promotionWebsiteUrl: 'https://nameintoflowers.com/',
    promotionWebsiteContent: 'Title: Name Into Flowers',
    manualMode: true,
    manualPageType: 'directory_submission',
    homepageProfile: {
      pageTitle: 'Name Into Flowers',
      bodySummary: 'Create custom floral name artwork.'
    },
    manualFieldSpecs: [
      { fieldId: 'mf_title_1234', role: 'title', label: 'Website name' },
      { role: 'description', label: 'Short description' },
      { role: 'website', label: 'URL' }
    ]
  });

  assert.match(prompt, /Return one JSON object/);
  assert.match(prompt, /Promoted homepage profile/);
  assert.match(prompt, /Create custom floral name artwork/);
  assert.match(prompt, /Website name/);
  assert.match(prompt, /fieldId=mf_title_1234/);
  assert.match(prompt, /fieldValuesById/);
  assert.match(prompt, /shortDescription/);
});
