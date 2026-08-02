const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cancelModelRequest,
  extractModelText,
  generateWithModel,
  generateWithModelQueued
} = require('../lib/model-generate');
const {
  stripGeneratedCopyMarkdownFences,
  validateGeneratedComment
} = require('../lib/generated-copy-cleanup');
const { buildUserPrompt } = require('../lib/generate-copy-prompt');
const { buildSkillTemplate } = require('../lib/comment-prompt-rules');
const { parseManualAssistantJson } = require('../lib/manual-assistant-json');
const fs = require('node:fs');
const path = require('node:path');

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

test('extractModelText ignores Responses API reasoning and keeps the final message', () => {
  const text = extractModelText({
    output: [
      {
        type: 'reasoning',
        summary: [{ text: 'We need plan the response and include an anchor.' }]
      },
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'This is the final publishable comment.' }]
      }
    ]
  });

  assert.equal(text, 'This is the final publishable comment.');
});

test('parseManualAssistantJson restores a literal href newline in a manual blog comment', () => {
  const parsed = parseManualAssistantJson([
    '{',
    '  "commentText": "Useful note with <a href=\\"https://example.com/',
    '\\">natural anchor</a> included."',
    '}'
  ].join('\n'));

  assert.equal(parsed.commentText, 'Useful note with <a href="https://example.com/\n">natural anchor</a> included.');
});

test('stripGeneratedCopyMarkdownFences removes wrapper fence without changing href newline', () => {
  const text = '```html\nHelpful note with <a href="https://example.com/\n">natural anchor</a> inside.\n```';

  const cleaned = stripGeneratedCopyMarkdownFences(text);

  assert.equal(cleaned, 'Helpful note with <a href="https://example.com/\n">natural anchor</a> inside.');
  assert.match(cleaned, /href="https:\/\/example\.com\/\n">/);
});

test('validateGeneratedComment rejects model planning text instead of a publishable comment', () => {
  const result = validateGeneratedComment([
    'We need answer in Swedish.',
    'Need craft comment 100 words approx.',
    'Need include link exactly once as an HTML anchor.'
  ].join(' '));

  assert.deepEqual(result, { valid: false, reason: 'meta_instruction_output' });
});

test('validateGeneratedComment accepts a natural Swedish comment', () => {
  const result = validateGeneratedComment('Texten visar fint hur musik kan hjälpa oss att omtolka minnen och identitet över tid.');

  assert.deepEqual(result, { valid: true, reason: '' });
});

test('blog comment templates require a connected two-part comment structure', () => {
  const defaultTemplate = buildSkillTemplate('Default instruction.', {
    requireHtmlAnchor: true,
    requireCommentStructure: true
  });
  const customTemplate = buildSkillTemplate('Custom instruction.', {
    requireHtmlAnchor: true,
    requireCommentStructure: true
  });

  assert.match(defaultTemplate, /Start by affirming the article's value/);
  assert.match(defaultTemplate, /approximately 30 words/);
  assert.match(defaultTemplate, /approximately 50 words/);
  assert.match(defaultTemplate, /50 to 70 characters/);
  assert.match(defaultTemplate, /specific direct connection/);
  assert.match(defaultTemplate, /specific secondary connection/);
  assert.match(defaultTemplate, /Do not use vague bridges/);
  assert.match(defaultTemplate, /naturally embedded in the second part/);
  assert.match(customTemplate, /Custom instruction\./);
  assert.match(customTemplate, /Start by affirming the article's value/);
  assert.match(defaultTemplate, /Never output planning, instructions, or an explanation/);
});

test('non-blog manual templates omit comment structure requirements', () => {
  const template = buildSkillTemplate('Directory field instruction.', {
    requireHtmlAnchor: false,
    requireCommentStructure: false
  });

  assert.match(template, /Directory field instruction\./);
  assert.doesNotMatch(template, /Start by affirming the article's value/);
});

test('extension lets the backend apply the current standard comment prompt', () => {
  const contentScript = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

  assert.doesNotMatch(contentScript, /skillTemplate:\s*QWEN_SKILL_TEMPLATE/);
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

test('manual blog comment JSON prompt encodes the required href newline', () => {
  const prompt = buildUserPrompt({
    manualMode: true,
    manualPageType: 'blog_comment'
  });

  assert.match(prompt, /JSON escape sequence \\n/);
});
