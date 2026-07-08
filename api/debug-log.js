const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();

const DEFAULT_LOG_PATH = path.join(__dirname, '..', 'output', 'debug', 'extension-debug.jsonl');
const SENSITIVE_KEY_RE = /password|pass|secret|token|cookie|authorization|api[-_]?key|apikey|credential/i;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 80;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function sanitizeDebugString(value) {
  const redacted = String(value).replace(URL_RE, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      let changed = false;
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_KEY_RE.test(key)) {
          parsed.searchParams.set(key, '[REDACTED]');
          changed = true;
        }
      }
      return changed ? parsed.toString() : rawUrl;
    } catch (_) {
      return rawUrl;
    }
  });
  return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]` : redacted;
}

function sanitizeDebugValue(value, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return sanitizeDebugString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeDebugValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      result[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeDebugValue(child, depth + 1);
    }
    return result;
  }
  return String(value);
}

async function appendDebugLog(payload, filePath = process.env.DEBUG_LOG_PATH || DEFAULT_LOG_PATH) {
  const sanitized = sanitizeDebugValue(payload || {});
  const entry = {
    time: new Date().toISOString(),
    ...sanitized
  };
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

router.post('/debug-log', async (req, res) => {
  try {
    await appendDebugLog(req.body || {});
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[debug-log] write failed:', error);
    res.status(500).json({
      success: false,
      error: 'DEBUG_LOG_WRITE_FAILED',
      message: error.message
    });
  }
});

router.sanitizeDebugValue = sanitizeDebugValue;
router.appendDebugLog = appendDebugLog;
router.DEFAULT_LOG_PATH = DEFAULT_LOG_PATH;

module.exports = router;
