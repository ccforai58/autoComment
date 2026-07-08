const express = require('express');
const { queryOne } = require('./db');

const router = express.Router();

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function getModelStatus() {
  const hasBase = hasValue(process.env.MODEL_API_BASE);
  const hasName = hasValue(process.env.MODEL_NAME);
  const hasKey = hasValue(process.env.MODEL_API_KEY);
  const ok = hasBase && hasName && hasKey;
  return {
    ok,
    configured: ok,
    message: ok ? 'Configured' : 'Missing model configuration'
  };
}

router.get('/local-status', async (_req, res) => {
  const status = {
    backend: {
      ok: true,
      message: 'OK'
    },
    database: {
      ok: false,
      message: 'Checking'
    },
    model: getModelStatus(),
    timestamp: new Date().toISOString()
  };

  try {
    await queryOne('SELECT 1 AS ok');
    status.database = {
      ok: true,
      message: 'OK'
    };
  } catch (error) {
    status.database = {
      ok: false,
      message: 'Unavailable',
      error: error && error.message ? error.message : String(error)
    };
  }

  res.json(status);
});

module.exports = router;
