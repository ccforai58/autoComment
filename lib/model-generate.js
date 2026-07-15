function getModelConfig() {
  const rawApiBase = String(process.env.MODEL_API_BASE || '').trim();
  if (!rawApiBase) {
    throw new Error('后端未配置模型 API 地址，请设置 MODEL_API_BASE 环境变量');
  }

  const apiBase = rawApiBase.replace(/\/+$/, '');
  const wireApi = String(process.env.MODEL_WIRE_API || 'chat_completions').trim().toLowerCase();
  const defaultPath = wireApi === 'responses' ? '/responses' : '/chat/completions';
  const chatPath = String(process.env.MODEL_CHAT_PATH || defaultPath);
  const endpoint = `${apiBase}${chatPath.startsWith('/') ? chatPath : `/${chatPath}`}`;
  const apiKey = process.env.MODEL_API_KEY;
  const model = process.env.MODEL_NAME;

  return { endpoint, apiKey, model, wireApi };
}

function buildModelRequestBody({ wireApi, model, skillTemplate, userPrompt }) {
  if (wireApi === 'responses') {
    return {
      model,
      input: [
        { role: 'system', content: skillTemplate },
        { role: 'user', content: userPrompt }
      ]
    };
  }

  return {
    model,
    messages: [
      { role: 'system', content: skillTemplate },
      { role: 'user', content: userPrompt }
    ]
  };
}

function collectText(value, chunks) {
  if (!value) return;
  if (typeof value === 'string') {
    chunks.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, chunks);
    return;
  }
  if (typeof value !== 'object') return;

  for (const key of ['text', 'output_text', 'content']) {
    if (typeof value[key] === 'string') {
      chunks.push(value[key]);
    }
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      collectText(nested, chunks);
    }
  }
}

function extractModelText(modelData) {
  if (!modelData || typeof modelData !== 'object') {
    return '';
  }

  if (typeof modelData.output_text === 'string') {
    return modelData.output_text;
  }

  if (Array.isArray(modelData.output)) {
    const chunks = [];
    collectText(modelData.output, chunks);
    if (chunks.length) {
      return chunks.join('\n');
    }
  }

  const messageContent = modelData.choices &&
    modelData.choices[0] &&
    modelData.choices[0].message &&
    modelData.choices[0].message.content;

  if (typeof messageContent === 'string') {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    const chunks = [];
    collectText(messageContent, chunks);
    return chunks.join('\n');
  }

  return '';
}

function summarizeModelData(modelData, extractedText) {
  if (!modelData || typeof modelData !== 'object') {
    return {
      responseType: typeof modelData,
      extractedTextLength: 0
    };
  }

  return {
    topLevelKeys: Object.keys(modelData).slice(0, 40),
    object: typeof modelData.object === 'string' ? modelData.object : undefined,
    status: typeof modelData.status === 'string' ? modelData.status : undefined,
    outputCount: Array.isArray(modelData.output) ? modelData.output.length : undefined,
    outputTypes: Array.isArray(modelData.output)
      ? modelData.output.slice(0, 5).map((item) => item && item.type).filter(Boolean)
      : undefined,
    choicesCount: Array.isArray(modelData.choices) ? modelData.choices.length : undefined,
    finishReasons: Array.isArray(modelData.choices)
      ? modelData.choices.slice(0, 5).map((item) => item && item.finish_reason).filter(Boolean)
      : undefined,
    hasError: !!modelData.error,
    errorMessage: modelData.error && (modelData.error.message || modelData.error.code || String(modelData.error)),
    extractedTextLength: String(extractedText || '').trim().length
  };
}

function getChatFallbackEndpoint(endpoint) {
  const value = String(endpoint || '');
  if (/\/responses$/i.test(value)) {
    return value.replace(/\/responses$/i, '/chat/completions');
  }
  if (/\/responses\?/i.test(value)) {
    return value.replace(/\/responses\?/i, '/chat/completions?');
  }
  return '';
}

const DEFAULT_RETRYABLE_MODEL_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRYABLE_FETCH_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);

const modelQueueState = {
  chain: Promise.resolve(),
  active: 0,
  lastStartAt: 0,
  queued: 0
};

const cancelableRequests = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseIntOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function getFetchErrorCode(err) {
  return err && (
    err.code ||
    (err.cause && err.cause.code) ||
    (err.cause && err.cause.name) ||
    err.name ||
    ''
  );
}

function createModelHttpError(status, bodyText) {
  const err = new Error('Model API request failed');
  err.status = status;
  err.bodyText = bodyText;
  err.retryable = DEFAULT_RETRYABLE_MODEL_STATUS_CODES.has(Number(status)) ||
    /upstream_error|temporarily unavailable|timeout|rate/i.test(String(bodyText || ''));
  return err;
}

function createModelCanceledError(requestId, reason) {
  const err = new Error('Model request canceled');
  err.name = 'AbortError';
  err.code = 'MODEL_REQUEST_CANCELED';
  err.requestId = requestId || '';
  err.cancelReason = reason || '';
  err.retryable = false;
  return err;
}

function getCancelableRequest(requestId) {
  const key = String(requestId || '').trim();
  if (!key) return null;
  return cancelableRequests.get(key) || null;
}

function ensureCancelableRequest(requestId) {
  const key = String(requestId || '').trim();
  if (!key) return null;
  let entry = cancelableRequests.get(key);
  if (!entry) {
    entry = {
      requestId: key,
      controller: new AbortController(),
      status: 'queued',
      canceled: false,
      cancelReason: '',
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0
    };
    cancelableRequests.set(key, entry);
  }
  return entry;
}

function cleanupCancelableRequest(requestId, finishedAt) {
  setTimeout(() => {
    const latest = getCancelableRequest(requestId);
    if (latest && latest.finishedAt === finishedAt) {
      cancelableRequests.delete(latest.requestId);
    }
  }, 30 * 1000).unref?.();
}

function finishCancelableRequest(requestId, status) {
  const entry = getCancelableRequest(requestId);
  if (!entry) return;
  entry.status = status || entry.status || 'finished';
  entry.finishedAt = Date.now();
  cleanupCancelableRequest(entry.requestId, entry.finishedAt);
}

function cancelModelRequest(requestId, reason = 'client_cancel') {
  const entry = getCancelableRequest(requestId);
  if (!entry) {
    return { success: false, status: 'not_found', requestId: String(requestId || '') };
  }
  if (entry.status === 'finished' || entry.status === 'failed' || entry.status === 'canceled') {
    return { success: true, status: 'already_finished', requestId: entry.requestId };
  }
  entry.canceled = true;
  entry.cancelReason = reason;
  entry.status = 'canceled';
  entry.finishedAt = Date.now();
  try {
    entry.controller.abort(createModelCanceledError(entry.requestId, reason));
  } catch {
    entry.controller.abort();
  }
  cleanupCancelableRequest(entry.requestId, entry.finishedAt);
  return { success: true, status: 'canceled', requestId: entry.requestId, reason };
}

function isRetryableModelError(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  if (DEFAULT_RETRYABLE_MODEL_STATUS_CODES.has(Number(err.status))) return true;
  const code = getFetchErrorCode(err);
  if (DEFAULT_RETRYABLE_FETCH_CODES.has(String(code))) return true;
  return /fetch failed|socket|timeout|temporarily unavailable|upstream/i.test(String(err.message || ''));
}

async function withModelQueue(task, options = {}) {
  const logger = options.logger || console;
  const requestId = String(options.requestId || '').trim();
  const cancelEntry = ensureCancelableRequest(requestId);
  const minIntervalMs = parseMs(
    options.minRequestIntervalMs !== undefined
      ? options.minRequestIntervalMs
      : process.env.MODEL_MIN_REQUEST_INTERVAL_MS,
    1800
  );
  const queuedBefore = modelQueueState.queued;
  modelQueueState.queued += 1;

  const previous = modelQueueState.chain.catch(() => {});
  const run = previous.then(async () => {
    modelQueueState.queued = Math.max(0, modelQueueState.queued - 1);
    if (cancelEntry && cancelEntry.canceled) {
      logger.warn('[generate-copy][model] queue_skip_canceled', {
        requestId,
        reason: cancelEntry.cancelReason
      });
      throw createModelCanceledError(requestId, cancelEntry.cancelReason);
    }
    const now = Date.now();
    const waitMs = Math.max(0, modelQueueState.lastStartAt + minIntervalMs - now);
    if (waitMs > 0) {
      logger.info('[generate-copy][model] queue_wait', {
        waitMs,
        minIntervalMs,
        queuedBefore,
        active: modelQueueState.active
      });
      await sleep(waitMs);
    }

    modelQueueState.active += 1;
    modelQueueState.lastStartAt = Date.now();
    if (cancelEntry) {
      cancelEntry.status = 'running';
      cancelEntry.startedAt = modelQueueState.lastStartAt;
    }
    logger.info('[generate-copy][model] queue_start', {
      requestId,
      queued: modelQueueState.queued,
      active: modelQueueState.active,
      minIntervalMs
    });
    try {
      return await task();
    } finally {
      if (cancelEntry && !cancelEntry.canceled) {
        finishCancelableRequest(requestId, 'finished');
      }
      modelQueueState.active = Math.max(0, modelQueueState.active - 1);
      logger.info('[generate-copy][model] queue_done', {
        requestId,
        queued: modelQueueState.queued,
        active: modelQueueState.active
      });
    }
  });

  modelQueueState.chain = run.catch(() => {});
  return run;
}

async function requestModelOnce(skillTemplate, userPrompt, modelConfig, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || console;
  const { endpoint, apiKey, model, wireApi } = modelConfig;
  const requestId = String(options.requestId || '').trim();
  const cancelEntry = getCancelableRequest(requestId);
  const signal = options.signal || (cancelEntry && cancelEntry.controller && cancelEntry.controller.signal);

  if (cancelEntry && cancelEntry.canceled) {
    throw createModelCanceledError(requestId, cancelEntry.cancelReason);
  }

  logger.info('[generate-copy][model] request', {
    requestId,
    endpoint,
    model,
    wireApi,
    systemPromptLength: skillTemplate.length,
    userPromptLength: userPrompt.length
  });

  const modelResponse = await fetchImpl(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal,
      body: JSON.stringify(buildModelRequestBody({ wireApi, model, skillTemplate, userPrompt }))
    }
  );

  if (!modelResponse.ok) {
    const errorText = await modelResponse.text();
    logger.error('[generate-copy][model] failed:', modelResponse.status, errorText);
    throw createModelHttpError(modelResponse.status, errorText);
  }

  const modelData = await modelResponse.json();
  const extractedText = extractModelText(modelData);
  logger.info('[generate-copy][model] response', {
    endpoint,
    model,
    wireApi,
    ...summarizeModelData(modelData, extractedText)
  });
  return extractedText;
}

async function requestModelWithRetries(skillTemplate, userPrompt, modelConfig, options = {}) {
  const logger = options.logger || console;
  const maxRetries = parseIntOption(
    options.transientRetries !== undefined
      ? options.transientRetries
      : process.env.MODEL_TRANSIENT_RETRIES,
    2
  );
  const baseDelayMs = parseMs(
    options.transientRetryBaseDelayMs !== undefined
      ? options.transientRetryBaseDelayMs
      : process.env.MODEL_TRANSIENT_RETRY_BASE_DELAY_MS,
    2500
  );

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestModelOnce(skillTemplate, userPrompt, modelConfig, options);
    } catch (err) {
      lastError = err;
      const retryable = isRetryableModelError(err);
      const status = err && err.status;
      const code = getFetchErrorCode(err);
      if (!retryable || attempt >= maxRetries) {
        logger.warn('[generate-copy][model] retry_stop', {
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          retryable,
          status,
          code,
          message: err && err.message
        });
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn('[generate-copy][model] retry_wait', {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        maxAttempts: maxRetries + 1,
        delayMs,
        status,
        code,
        message: err && err.message
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function generateWithModel(skillTemplate, userPrompt, options = {}) {
  const modelConfig = options.modelConfig || getModelConfig();
  const logger = options.logger || console;
  const { apiKey, model, wireApi } = modelConfig;

  if (!apiKey) {
    throw new Error('后端未配置通义千问 API Key，请联系管理员。');
  }

  if (!model) {
    throw new Error('后端未配置模型名称，请设置 MODEL_NAME 环境变量');
  }

  const emptyResponseRetries = Math.max(0, Number(
    options.emptyResponseRetries !== undefined
      ? options.emptyResponseRetries
      : (process.env.MODEL_EMPTY_RESPONSE_RETRIES || 2)
  ) || 0);
  const retryDelayMs = Math.max(0, Number(
    options.emptyResponseRetryDelayMs !== undefined
      ? options.emptyResponseRetryDelayMs
      : (process.env.MODEL_EMPTY_RESPONSE_RETRY_DELAY_MS || 800)
  ) || 0);

  let text = '';
  for (let attempt = 0; attempt <= emptyResponseRetries; attempt++) {
    text = await requestModelWithRetries(skillTemplate, userPrompt, modelConfig, options);
    if (String(text || '').trim() || wireApi !== 'responses') {
      return text;
    }
    logger.warn('[generate-copy][model] responses returned empty text', {
      endpoint: modelConfig.endpoint,
      model,
      attempt: attempt + 1,
      maxAttempts: emptyResponseRetries + 1
    });
    if (attempt < emptyResponseRetries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (String(text || '').trim() || wireApi !== 'responses') {
    return text;
  }

  const allowChatFallback = options.allowChatFallback !== undefined
    ? options.allowChatFallback === true
    : String(process.env.MODEL_ALLOW_CHAT_FALLBACK || '').toLowerCase() === 'true';
  if (!allowChatFallback) {
    throw new Error('Model responses API returned empty output; chat fallback is disabled for this model');
  }

  const fallbackEndpoint = getChatFallbackEndpoint(modelConfig.endpoint);
  if (!fallbackEndpoint) {
    logger.warn('[generate-copy][model] responses returned empty text and no chat fallback endpoint is available', {
      endpoint: modelConfig.endpoint,
      model
    });
    return text;
  }

  logger.warn('[generate-copy][model] responses returned empty text; retrying with chat completions', {
    responsesEndpoint: modelConfig.endpoint,
    fallbackEndpoint,
    model
  });

  return requestModelWithRetries(skillTemplate, userPrompt, {
    ...modelConfig,
    endpoint: fallbackEndpoint,
    wireApi: 'chat_completions'
  }, options);
}

async function generateWithModelQueued(skillTemplate, userPrompt, options = {}) {
  if (options.disableQueue === true) {
    return generateWithModel(skillTemplate, userPrompt, options);
  }
  return withModelQueue(() => generateWithModel(skillTemplate, userPrompt, options), options);
}

module.exports = {
  buildModelRequestBody,
  extractModelText,
  generateWithModel,
  generateWithModelQueued,
  cancelModelRequest,
  getChatFallbackEndpoint,
  getModelConfig,
  isRetryableModelError,
  requestModelWithRetries,
  summarizeModelData
};
