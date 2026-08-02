const fs = require('fs');
const path = require('path');
const { buildModelRequestBody, extractModelText } = require('./model-generate');

const ENV_PATH = path.resolve(__dirname, '..', '.env');
const PACKYAPI_PRESET = Object.freeze({
  apiBase: 'https://www.packyapi.com/v1',
  wireApi: 'chat_completions',
  chatPath: '/chat/completions'
});
const health = { checkedAt: '', ok: false, message: 'Not checked', model: '', durationMs: 0 };

function text(value) {
  return String(value == null ? '' : value).trim();
}

function maskApiKey(value) {
  const apiKey = text(value);
  if (!apiKey) return '';
  return apiKey.length <= 8 ? '********' : `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function sanitizeModelError(error, apiKey = '') {
  const key = text(apiKey);
  let message = text(error && error.message ? error.message : error);
  if (key) message = message.split(key).join('[REDACTED]');
  return message.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]').slice(0, 240) || 'Connection failed';
}

function normalizeModelSettings(input = {}, options = {}) {
  const apiBase = text(input.apiBase).replace(/\/+$/, '');
  const wireApi = text(input.wireApi || 'chat_completions').toLowerCase();
  const defaultPath = wireApi === 'responses' ? '/responses' : '/chat/completions';
  const chatPath = text(input.chatPath || defaultPath);
  const model = text(input.model);
  const apiKey = text(input.apiKey || options.fallbackApiKey);
  if (!/^https:\/\//i.test(apiBase)) throw new Error('API address must use HTTPS');
  if (!['chat_completions', 'responses'].includes(wireApi)) throw new Error('Unsupported API mode');
  if (!chatPath.startsWith('/')) throw new Error('Request path must start with /');
  if (!model) throw new Error('Model name is required');
  if (!apiKey) throw new Error('API token is required');
  return { apiBase, wireApi, chatPath, model, apiKey };
}

function getModelSettings() {
  const apiBase = text(process.env.MODEL_API_BASE);
  const wireApi = text(process.env.MODEL_WIRE_API || 'chat_completions').toLowerCase();
  const chatPath = text(process.env.MODEL_CHAT_PATH || (wireApi === 'responses' ? '/responses' : '/chat/completions'));
  const model = text(process.env.MODEL_NAME);
  const apiKey = text(process.env.MODEL_API_KEY);
  return { apiBase, wireApi, chatPath, model, hasApiKey: Boolean(apiKey), maskedApiKey: maskApiKey(apiKey) };
}

function applyRuntimeSettings(settings) {
  process.env.MODEL_API_BASE = settings.apiBase;
  process.env.MODEL_WIRE_API = settings.wireApi;
  process.env.MODEL_CHAT_PATH = settings.chatPath;
  process.env.MODEL_NAME = settings.model;
  process.env.MODEL_API_KEY = settings.apiKey;
}

function updateEnvFile(settings, envPath = ENV_PATH) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const replacements = {
    MODEL_API_BASE: settings.apiBase,
    MODEL_WIRE_API: settings.wireApi,
    MODEL_CHAT_PATH: settings.chatPath,
    MODEL_NAME: settings.model,
    MODEL_API_KEY: settings.apiKey
  };
  let output = current;
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    output = pattern.test(output) ? output.replace(pattern, line) : `${output.replace(/\s*$/, '')}\n${line}\n`;
  }
  const temporaryPath = `${envPath}.tmp`;
  fs.writeFileSync(temporaryPath, output, 'utf8');
  fs.renameSync(temporaryPath, envPath);
}

function saveModelSettings(input, options = {}) {
  const settings = normalizeModelSettings(input, { fallbackApiKey: process.env.MODEL_API_KEY });
  if (options.persist !== false) updateEnvFile(settings, options.envPath);
  applyRuntimeSettings(settings);
  console.info('[model-settings] saved', { apiBase: settings.apiBase, wireApi: settings.wireApi, chatPath: settings.chatPath, model: settings.model, hasApiKey: true });
  return getModelSettings();
}

function endpointFor(settings) {
  return `${settings.apiBase}${settings.chatPath}`;
}

async function testModelConnection(input, options = {}) {
  const settings = normalizeModelSettings(input, { fallbackApiKey: process.env.MODEL_API_KEY });
  const startedAt = Date.now();
  const endpoint = endpointFor(settings);
  console.info('[model-settings] probe_start', { endpoint, wireApi: settings.wireApi, model: settings.model });
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(buildModelRequestBody({
        wireApi: settings.wireApi,
        model: settings.model,
        skillTemplate: 'Reply with OK.',
        userPrompt: 'Ping.'
      }))
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = {
      ok: Boolean(text(extractModelText(await response.json()))),
      message: 'Connected',
      model: settings.model,
      durationMs: Date.now() - startedAt
    };
    health.checkedAt = new Date().toISOString();
    Object.assign(health, result);
    console.info('[model-settings] probe_done', { ok: result.ok, model: result.model, durationMs: result.durationMs });
    return result;
  } catch (error) {
    const result = { ok: false, message: sanitizeModelError(error, settings.apiKey), model: settings.model, durationMs: Date.now() - startedAt };
    health.checkedAt = new Date().toISOString();
    Object.assign(health, result);
    console.warn('[model-settings] probe_failed', { model: result.model, durationMs: result.durationMs, message: result.message });
    return result;
  }
}

function getModelHealth() {
  const settings = getModelSettings();
  return { ...health, configured: settings.hasApiKey && Boolean(settings.apiBase) && Boolean(settings.model) };
}

function refreshModelHealth() {
  const current = getModelSettings();
  if (!current.hasApiKey || !current.apiBase || !current.model) return Promise.resolve(getModelHealth());
  return testModelConnection({ ...current, apiKey: process.env.MODEL_API_KEY });
}

module.exports = {
  PACKYAPI_PRESET,
  getModelSettings,
  getModelHealth,
  maskApiKey,
  normalizeModelSettings,
  refreshModelHealth,
  sanitizeModelError,
  saveModelSettings,
  testModelConnection
};
