const express = require('express');
const { getModelHealth, getModelSettings, refreshModelHealth, saveModelSettings, testModelConnection } = require('../lib/model-settings');

const router = express.Router();

router.get('/model-settings', (_req, res) => res.json({ success: true, settings: getModelSettings(), health: getModelHealth() }));
router.put('/model-settings', (req, res) => {
  try { return res.json({ success: true, settings: saveModelSettings(req.body || {}), health: getModelHealth() }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});
router.post('/model-settings/test', async (req, res) => {
  const current = getModelSettings();
  const input = { ...current, ...(req.body || {}) };
  if (!input.apiKey && process.env.MODEL_API_KEY) input.apiKey = process.env.MODEL_API_KEY;
  const result = await testModelConnection(input);
  return res.status(result.ok ? 200 : 502).json({ success: result.ok, result });
});
router.post('/model-settings/refresh', async (_req, res) => res.json({ success: true, result: await refreshModelHealth() }));

module.exports = router;
