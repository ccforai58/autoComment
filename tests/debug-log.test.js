const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  sanitizeDebugValue,
  appendDebugLog
} = require('../api/debug-log');

test('sanitizeDebugValue redacts sensitive keys deeply', () => {
  const sanitized = sanitizeDebugValue({
    ok: true,
    password: 'secret',
    nested: {
      token: 'abc',
      value: 'visible'
    },
    list: [
      { apiKey: 'key' },
      { message: 'hello' }
    ]
  });

  assert.equal(sanitized.ok, true);
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
  assert.equal(sanitized.nested.value, 'visible');
  assert.equal(sanitized.list[0].apiKey, '[REDACTED]');
  assert.equal(sanitized.list[1].message, 'hello');
});

test('sanitizeDebugValue redacts sensitive URL query parameters inside strings', () => {
  const sanitized = sanitizeDebugValue({
    message: 'Generated copy links to https://example.test/path?token=abc123&utm_source=test&api_key=secret-key and continues.'
  });

  assert.equal(
    sanitized.message,
    'Generated copy links to https://example.test/path?token=%5BREDACTED%5D&utm_source=test&api_key=%5BREDACTED%5D and continues.'
  );
});

test('appendDebugLog writes one JSON line with sanitized payload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-comment-debug-log-'));
  const file = path.join(dir, 'extension-debug.jsonl');

  await appendDebugLog({
    source: 'content',
    stage: 'submit.final_outcome',
    password: 'secret',
    details: { result: 'fail' }
  }, file);

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.source, 'content');
  assert.equal(parsed.stage, 'submit.final_outcome');
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.details.result, 'fail');
  assert.match(parsed.time, /^\d{4}-\d{2}-\d{2}T/);
});
