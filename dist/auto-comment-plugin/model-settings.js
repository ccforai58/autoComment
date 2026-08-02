const API_BASE = 'http://127.0.0.1:3000/api/model-settings';

const fields = {
  apiBase: document.getElementById('apiBase'),
  wireApi: document.getElementById('wireApi'),
  chatPath: document.getElementById('chatPath'),
  model: document.getElementById('model'),
  apiKey: document.getElementById('apiKey')
};
const health = document.getElementById('health');
const result = document.getElementById('result');
const tokenState = document.getElementById('tokenState');
const saveButton = document.getElementById('save');
const testButton = document.getElementById('test');

function formSettings() {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
}

function setResult(message, type = '') {
  result.textContent = message;
  result.className = `result ${type}`.trim();
}

function setHealth(data) {
  const message = data && data.message ? data.message : '尚未检测';
  const checkedAt = data && data.checkedAt ? `（检测时间：${new Date(data.checkedAt).toLocaleString()}）` : '';
  health.textContent = `${message}${checkedAt}`;
  health.className = `status ${data && data.ok ? 'ok' : 'error'}`;
}

function setBusy(isBusy) {
  saveButton.disabled = isBusy;
  testButton.disabled = isBusy;
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || data.result?.message || `请求失败（${response.status}）`);
  return data;
}

function applySettings(settings) {
  for (const [key, field] of Object.entries(fields)) if (key !== 'apiKey') field.value = settings[key] || '';
  tokenState.textContent = settings.hasApiKey
    ? `已保存令牌：${settings.maskedApiKey}。留空保存会保留当前令牌。`
    : '尚未保存令牌；首次保存时必须填写。';
}

async function loadSettings() {
  try {
    const data = await request(API_BASE);
    applySettings(data.settings);
    setHealth(data.health);
  } catch (error) {
    setHealth({ ok: false, message: `无法读取后端状态：${error.message}` });
  }
}

function applyPackyPreset() {
  fields.apiBase.value = 'https://www.packyapi.com/v1';
  fields.wireApi.value = 'chat_completions';
  fields.chatPath.value = '/chat/completions';
  setResult('已应用 PackyAPI 预设；请填写模型名和令牌后保存。');
}

async function saveSettings(event) {
  event.preventDefault();
  setBusy(true);
  try {
    const data = await request(API_BASE, { method: 'PUT', body: JSON.stringify(formSettings()) });
    fields.apiKey.value = '';
    applySettings(data.settings);
    setHealth(data.health);
    setResult('配置已保存到本机后端。', 'ok');
  } catch (error) {
    setResult(`保存失败：${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function testConnection() {
  setBusy(true);
  setResult('正在向模型服务发送真实连通性请求…');
  try {
    const data = await request(`${API_BASE}/test`, { method: 'POST', body: JSON.stringify(formSettings()) });
    setHealth(data.result);
    setResult(`连通成功：${data.result.model}，耗时 ${data.result.durationMs} ms。`, 'ok');
  } catch (error) {
    setResult(`连通失败：${error.message}`, 'error');
    await loadSettings();
  } finally {
    setBusy(false);
  }
}

document.getElementById('back').addEventListener('click', () => { window.location.href = 'batch.html'; });
document.getElementById('packyPreset').addEventListener('click', applyPackyPreset);
document.getElementById('settingsForm').addEventListener('submit', saveSettings);
testButton.addEventListener('click', testConnection);
fields.wireApi.addEventListener('change', () => { fields.chatPath.value = fields.wireApi.value === 'responses' ? '/responses' : '/chat/completions'; });
loadSettings();
