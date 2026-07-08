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

async function requestModelOnce(skillTemplate, userPrompt, modelConfig, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || console;
  const { endpoint, apiKey, model, wireApi } = modelConfig;

  logger.info('[generate-copy][model] request', {
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
      body: JSON.stringify(buildModelRequestBody({ wireApi, model, skillTemplate, userPrompt }))
    }
  );

  if (!modelResponse.ok) {
    const errorText = await modelResponse.text();
    logger.error('[generate-copy][model] failed:', modelResponse.status, errorText);
    throw new Error('通义千问接口调用失败，请稍后重试。');
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

  const text = await requestModelOnce(skillTemplate, userPrompt, modelConfig, options);
  if (String(text || '').trim() || wireApi !== 'responses') {
    return text;
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

  return requestModelOnce(skillTemplate, userPrompt, {
    ...modelConfig,
    endpoint: fallbackEndpoint,
    wireApi: 'chat_completions'
  }, options);
}

module.exports = {
  buildModelRequestBody,
  extractModelText,
  generateWithModel,
  getChatFallbackEndpoint,
  getModelConfig,
  summarizeModelData
};
