const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractModelText,
  generateWithModel
} = require('../lib/model-generate');

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
