const { execute, queryOne } = require('./db');
const { findBlockedKeyword, loadBlockedKeywords } = require('./blocked-keywords');
const { cancelModelRequest, generateWithModelQueued } = require('../lib/model-generate');
const { stripGeneratedCopyMarkdownFences } = require('../lib/generated-copy-cleanup');
const { ensurePromotionAnchor } = require('../lib/promotion-anchor-logic');
const promptLogic = require('../lib/generate-copy-prompt');

const POINTS_COST_PER_GENERATION = 1;

const LINK_HREF_NEWLINE_RULE = [
  '',
  '【链接格式要求】',
  'You MUST include the promoted website exactly once as an HTML anchor tag, not as a bare URL.',
  'The anchor text MUST be a natural contextual phrase that fits the current page and promoted website.',
  'When promoted website keywords are provided, the anchor text MUST be rooted in one of those keywords and must be 4 words or fewer; shorter is better.',
  'The full comment and the anchor text must read as one natural sentence or thought, not as a detached keyword insert.',
  'Do NOT use the URL, domain, "click here", "website", or generic repeated text as anchor text.',
  'Avoid anchor texts already used in this batch if they are provided in the user prompt.',
  'Do NOT use anchor texts listed as overused in the user prompt.',
  'If you output any HTML link, the href attribute value MUST contain a real line break immediately before the closing double quote.',
  'Correct example:',
  '<a href="https://example.com/',
  '">点击这里</a>',
  'Wrong examples:',
  '<a href="https://example.com/">点击这里</a>',
  '<a href="https://example.com/\\n">点击这里</a>',
  'The required line break must be an actual newline character in the output, not the two characters \\ and n.'
].join('\n');

loadBlockedKeywords().catch((err) => {
  console.error('[generate-copy] failed to preload blocked keywords:', err);
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function ensureTables() {
  await execute(
    `
      CREATE TABLE IF NOT EXISTS auto_comment_users (
        user_id VARCHAR(255) PRIMARY KEY,
        points INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    []
  );

  await execute(
    `
      CREATE TABLE IF NOT EXISTS refund_points_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id VARCHAR(255) NOT NULL,
        batch_id VARCHAR(36) DEFAULT NULL,
        url TEXT DEFAULT NULL,
        points INT NOT NULL DEFAULT 1,
        reason VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_user_refund_date (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    []
  );
}

function getDefaultSkillTemplate() {
  return [
    '你是一个资深的网站营销与文案专家，擅长为各类网站撰写高转化率的推广文案。',
    '请严格根据我提供的"当前网站内容"进行分析和创作，不要凭空捏造网站不存在的功能或信息。',
    '',
    '【输出要求】',
    '1. 先用 1-2 句话高度概括该网站的核心价值和目标用户。',
    '2. 我需要在该网站发表评论，关联到我的网站并吸引用户点击访问我的网站。',
    '3. 语气可以专业但要自然、真实，避免夸张、虚假宣传。',
    '4. 使用英文输出，字数建议控制在 100-200词。',
    '5. 直接给出推广文案，不要有多余的输出。'
  ].join('\n');
}

function getDefaultSkillTemplateV2() {
  return [
    'You are an experienced website marketing and comment copywriter.',
    'Analyze only the current page content provided by the user. Do not invent features, facts, or claims that are not supported by the page.',
    '',
    'Output requirements:',
    '1. Write a natural comment that fits the current page and softly connects to the promoted website.',
    '2. Match the main language of the current page. Use English only when the page is English or the language is unclear.',
    '3. Keep the tone useful, specific, and human. Avoid exaggerated promotional claims.',
    '4. Keep the comment concise, roughly 80-180 words unless the page language naturally needs shorter wording.',
    '5. Return only the comment text. Do not wrap it in Markdown fences, code blocks, JSON, labels, explanations, or extra notes.'
  ].join('\n');
}

function appendRequiredOutputRules(skillTemplate) {
  return `${skillTemplate.trim()}\n${LINK_HREF_NEWLINE_RULE}`;
}

const buildUserPrompt = promptLogic.buildUserPrompt;

function parseManualAssistantJson(text) {
  const raw = stripGeneratedCopyMarkdownFences(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeManualFieldValues(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceById = source.fieldValuesById && typeof source.fieldValuesById === 'object'
    ? source.fieldValuesById
    : {};
  const fieldValuesById = {};
  for (const [key, item] of Object.entries(sourceById)) {
    const fieldId = String(key || '').trim();
    const text = String(item == null ? '' : item).trim();
    if (fieldId && text) fieldValuesById[fieldId] = text;
  }
  const tags = Array.isArray(source.tags)
    ? source.tags.map((item) => String(item || '').trim()).filter(Boolean)
    : String(source.tags || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  return {
    commentText: String(source.commentText || source.comment || source.message || '').trim(),
    siteTitle: String(source.siteTitle || source.title || '').trim(),
    tagline: String(source.tagline || source.slogan || '').trim(),
    shortDescription: String(source.shortDescription || source.description || '').trim(),
    longDescription: String(source.longDescription || source.body || '').trim(),
    bio: String(source.bio || source.profileBio || '').trim(),
    tags,
    categorySuggestion: String(source.categorySuggestion || source.category || '').trim(),
    pricingModel: String(source.pricingModel || source.pricing || source.priceModel || '').trim(),
    authorName: String(source.authorName || source.author || '').trim(),
    contactEmail: String(source.contactEmail || source.email || '').trim(),
    websiteUrl: String(source.websiteUrl || source.url || '').trim(),
    fieldValuesById
  };
}

async function deductPoint(userId) {
  // Local-only mode: points consumption is disabled.
  const row = await queryOne('SELECT points FROM auto_comment_users WHERE user_id = ?', [userId]);
  if (!row) {
    await execute(
      `
        INSERT INTO auto_comment_users (user_id, points, updated_at)
        VALUES (?, 0, NOW())
        ON DUPLICATE KEY UPDATE updated_at = NOW()
      `,
      [userId]
    );
    return { success: true, remainingPoints: 0, pointsDisabled: true, autoCreatedUser: true };
  }

  return { success: true, remainingPoints: Number(row.points) || 0, pointsDisabled: true };
}

async function refundPoint(userId, url, reason) {
  // Local-only mode: there is no deduction to refund.
  const row = await queryOne('SELECT points FROM auto_comment_users WHERE user_id = ?', [userId]);
  if (!row) {
    return { remainingPoints: 0, pointsDisabled: true, autoCreatedUser: true };
  }

  return { remainingPoints: Number(row.points) || 0, pointsDisabled: true };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  const {
    userId,
    websiteUrl,
    title,
    description,
    bodyText,
    skillTemplate,
    promotionWebsiteUrl,
    promotionWebsiteContent,
    usedAnchorTexts,
    usedAnchorTextStats,
    aiRequestId,
    pageLanguageHint,
    pageLanguageEvidence,
    manualMode,
    manualPageType,
    manualFieldSpecs,
    homepageProfile
  } = body;

  if (!userId) {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }

  try {
    await ensureTables();

    const deducted = await deductPoint(userId);
    if (!deducted.success) {
      if (deducted.code === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          code: 'USER_NOT_FOUND',
          error: 'User ID must be manually assigned by an administrator'
        });
      }

      return res.status(200).json({
        success: false,
        error: 'Points consumption is disabled for local use',
        currentPoints: deducted.currentPoints,
        requiredPoints: 0,
        pointsDisabled: true
      });
    }

    const baseTemplate = skillTemplate && skillTemplate.trim()
      ? skillTemplate.trim()
      : getDefaultSkillTemplateV2();
    const isManualMode = manualMode === true;
    const shouldRequireHtmlAnchor = !isManualMode || String(manualPageType || '').trim() === 'blog_comment';
    const template = shouldRequireHtmlAnchor ? appendRequiredOutputRules(baseTemplate) : baseTemplate.trim();
    const userPrompt = buildUserPrompt({
      websiteUrl,
      title,
      description,
      bodyText,
      promotionWebsiteUrl,
      promotionWebsiteContent,
      usedAnchorTexts,
      usedAnchorTextStats,
      pageLanguageHint,
      pageLanguageEvidence,
      manualMode: isManualMode,
      manualPageType,
      manualFieldSpecs,
      homepageProfile
    });
    const generatedText = await generateWithModelQueued(template, userPrompt, {
      requestId: aiRequestId
    });
    const manualJson = isManualMode ? parseManualAssistantJson(generatedText) : null;
    const fieldValues = normalizeManualFieldValues(manualJson);
    const cleanedGeneratedText = manualJson
      ? (fieldValues.commentText || fieldValues.longDescription || fieldValues.shortDescription || fieldValues.bio)
      : stripGeneratedCopyMarkdownFences(generatedText);
    const anchored = shouldRequireHtmlAnchor ? ensurePromotionAnchor(cleanedGeneratedText, {
      promotionUrl: promotionWebsiteUrl || websiteUrl,
      promotionContent: promotionWebsiteContent || '',
      pageTitle: title || '',
      pageDescription: description || '',
      usedAnchorTexts,
      blockedAnchorTexts: Array.isArray(usedAnchorTextStats)
        ? usedAnchorTextStats
            .filter((item) => item && Number(item.count) >= 30)
            .map((item) => String(item.text || '').trim())
            .filter(Boolean)
        : []
    }) : {
      text: cleanedGeneratedText,
      anchorText: '',
      anchorSource: '',
      anchorWasDuplicate: false,
      anchorRewritten: false,
      hrefNewlinePreserved: false,
      changed: false
    };
    if (anchored.changed) {
      console.log('[generate-copy] promotion anchor normalized', {
        anchorText: anchored.anchorText,
        anchorSource: anchored.anchorSource,
        anchorWasDuplicate: anchored.anchorWasDuplicate,
        anchorRewritten: anchored.anchorRewritten,
        usedAnchorCount: anchored.usedAnchorCount
      });
    }

    const blockedKeyword = await findBlockedKeyword(anchored.text);
    if (blockedKeyword) {
      await refundPoint(userId, websiteUrl, `blocked_keyword:${blockedKeyword}`);
      console.log('[generate-copy] blocked generated copy; points disabled:', {
        userId,
        websiteUrl,
        blockedKeyword
      });

      return res.status(200).json({
        success: true,
        text: '',
        blocked: true,
        remainingPoints: deducted.remainingPoints
      });
    }

    return res.status(200).json({
      success: true,
      text: anchored.text,
      fieldValues: isManualMode ? { ...fieldValues, commentText: anchored.text || fieldValues.commentText } : null,
      anchorText: anchored.anchorText,
      anchorSource: anchored.anchorSource,
      anchorWasDuplicate: anchored.anchorWasDuplicate,
      anchorRewritten: anchored.anchorRewritten,
      hrefNewlinePreserved: anchored.hrefNewlinePreserved,
      remainingPoints: deducted.remainingPoints
    });
  } catch (err) {
    if (err && (err.code === 'MODEL_REQUEST_CANCELED' || err.name === 'AbortError')) {
      console.warn('[generate-copy] canceled:', {
        aiRequestId,
        reason: err.cancelReason || err.message
      });
      return res.status(499).json({ success: false, error: 'AI request canceled', canceled: true });
    }
    console.error('[generate-copy] error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message });
  }
};

module.exports.cancel = async function cancelGenerateCopyHandler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const body = req.body || {};
  const aiRequestId = String(body.aiRequestId || body.requestId || '').trim();
  const reason = String(body.reason || 'client_cancel').trim() || 'client_cancel';
  if (!aiRequestId) {
    return res.status(400).json({ success: false, error: 'missing aiRequestId' });
  }
  const result = cancelModelRequest(aiRequestId, reason);
  console.info('[generate-copy] cancel request', {
    aiRequestId,
    reason,
    status: result.status
  });
  return res.status(200).json(result);
};

module.exports.buildUserPrompt = buildUserPrompt;
