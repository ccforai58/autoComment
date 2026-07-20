(function initManualAssistantFieldLogic(root) {
'use strict';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function compactText(value, maxLength) {
  return safeText(value).replace(/\s+/g, ' ').slice(0, maxLength || 160);
}

function normalizeManualPageType(value) {
  const text = safeText(value).toLowerCase();
  if (text === 'blog_comment' || text === 'blog' || text === 'comment') return 'blog_comment';
  if (text === 'directory_submission' || text === 'directory' || text === 'listing') return 'directory_submission';
  if (text === 'media_submission' || text === 'media' || text === 'article' || text === 'press') return 'media_submission';
  if (text === 'profile_link' || text === 'profile' || text === 'account') return 'profile_link';
  return 'generic_form';
}

function stableHash(text) {
  const input = safeText(text);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildManualFieldId(field, index) {
  const source = field && typeof field === 'object' ? field : {};
  const role = safeText(source.role) || 'unknown';
  const stableParts = [
    role,
    safeText(source.name),
    safeText(source.id),
    safeText(source.placeholder),
    safeText(source.label),
    safeText(source.tagName).toLowerCase(),
    safeText(source.type).toLowerCase(),
    Number.isFinite(Number(index)) ? String(Number(index)) : '0'
  ];
  return `mf_${role}_${stableHash(stableParts.join('|'))}`;
}

function normalizeManualFieldSpec(field, index) {
  const source = field && typeof field === 'object' ? field : {};
  const role = safeText(source.role) || 'unknown';
  const spec = {
    fieldId: safeText(source.fieldId) || buildManualFieldId({ ...source, role }, index),
    role,
    score: Number(source.score) || 0,
    label: compactText(source.label, 180),
    tagName: safeText(source.tagName).toLowerCase(),
    type: safeText(source.type).toLowerCase(),
    name: safeText(source.name),
    id: safeText(source.id),
    placeholder: compactText(source.placeholder, 140)
  };
  return spec;
}

function getManualFieldValueById(fieldValues, fieldId) {
  const source = fieldValues && typeof fieldValues === 'object' ? fieldValues : {};
  const byId = source.fieldValuesById && typeof source.fieldValuesById === 'object'
    ? source.fieldValuesById
    : {};
  const value = byId[fieldId];
  return safeText(value);
}

function normalizeChoiceText(value) {
  return safeText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function choiceTokens(value) {
  return normalizeChoiceText(value).split(' ').map((item) => item.trim()).filter(Boolean);
}

function selectBestManualChoiceOption(desiredValue, options) {
  const desired = normalizeChoiceText(desiredValue);
  const choices = Array.isArray(options) ? options : [];
  if (!desired || !choices.length) return null;
  const desiredTokens = new Set(choiceTokens(desired));
  let best = null;

  choices.forEach((option, index) => {
    const source = option && typeof option === 'object' ? option : { text: option };
    const text = safeText(source.text);
    const value = safeText(source.value);
    const haystack = normalizeChoiceText(`${text} ${value}`);
    if (!haystack) return;
    let score = 0;
    const textKey = normalizeChoiceText(text);
    const valueKey = normalizeChoiceText(value);
    if (haystack === desired || textKey === desired || valueKey === desired) {
      score = 100;
    } else if (
      (textKey && (desired.includes(textKey) || textKey.includes(desired))) ||
      (valueKey && (desired.includes(valueKey) || valueKey.includes(desired))) ||
      desired.includes(haystack) ||
      haystack.includes(desired)
    ) {
      score = 80;
    } else {
      const optionTokens = choiceTokens(haystack);
      const matches = optionTokens.filter((token) => desiredTokens.has(token));
      if (matches.length) {
        score = Math.round(40 + (matches.length / Math.max(1, optionTokens.length)) * 35);
      }
    }
    if (score >= 45 && (!best || score > best.score)) {
      best = { index, value, text, score };
    }
  });

  return best;
}

function chooseManualFieldValue(fieldSpec, fieldValues, profile, commentText) {
  const spec = fieldSpec && typeof fieldSpec === 'object' ? fieldSpec : {};
  const role = safeText(spec.role);
  const values = fieldValues && typeof fieldValues === 'object' ? fieldValues : {};
  const profileValues = profile && typeof profile === 'object' ? profile : {};
  const valueById = getManualFieldValueById(values, spec.fieldId);
  if (valueById) return valueById;
  const tagText = Array.isArray(values.tags) ? values.tags.join(', ') : safeText(values.tags);
  if (role === 'email') return safeText(values.contactEmail || profileValues.email);
  if (role === 'website' || role === 'websiteUrl' || role === 'url') return safeText(values.websiteUrl || profileValues.website);
  if (role === 'name' || role === 'author') return safeText(values.authorName || profileValues.author || profileValues.title);
  if (role === 'title') return safeText(values.siteTitle || profileValues.title || profileValues.author);
  if (role === 'tagline') return safeText(values.tagline || values.shortDescription || profileValues.tagline || profileValues.description);
  if (role === 'pricingModel') return safeText(values.pricingModel || values.pricing || values.categorySuggestion || '');
  if (role === 'category') return safeText(values.categorySuggestion);
  if (role === 'tags' || role === 'tag') return safeText(tagText);
  if (role === 'description') return safeText(values.shortDescription || values.longDescription || profileValues.description || commentText);
  if (role === 'bio' || role === 'profileBio') return safeText(values.bio || values.longDescription || values.shortDescription || profileValues.description || commentText);
  if (role === 'comment' || role === 'message' || role === 'content') return safeText(values.commentText || commentText);
  return '';
}

function isSensitiveManualField(field, spec) {
  const type = safeText(field && field.type).toLowerCase();
  const role = safeText(spec && spec.role).toLowerCase();
  if (['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image'].includes(type)) return true;
  if (/(password|secret|token|captcha|otp|verification)/i.test(role)) return true;
  return false;
}

function shouldAttemptManualFieldFill(fieldSpec) {
  const spec = fieldSpec && typeof fieldSpec === 'object' ? fieldSpec : {};
  return !isSensitiveManualField(spec, spec);
}

function getManualAssistantStatusTone(color) {
  const text = safeText(color).toLowerCase();
  if (text === '#f97373' || text === '#ef4444' || /red|error|danger/.test(text)) {
    return {
      intent: 'error',
      textColor: '#fecaca',
      borderColor: 'rgba(248,113,113,0.75)',
      backgroundColor: 'rgba(127,29,29,0.68)'
    };
  }
  if (text === '#f59e0b' || text === '#facc15' || /amber|yellow|warn/.test(text)) {
    return {
      intent: 'warning',
      textColor: '#fde68a',
      borderColor: 'rgba(245,158,11,0.78)',
      backgroundColor: 'rgba(120,53,15,0.7)'
    };
  }
  if (text === '#22c55e' || text === '#16a34a' || /green|success/.test(text)) {
    return {
      intent: 'success',
      textColor: '#bbf7d0',
      borderColor: 'rgba(34,197,94,0.66)',
      backgroundColor: 'rgba(20,83,45,0.62)'
    };
  }
  return {
    intent: 'neutral',
    textColor: '#cbd5e1',
    borderColor: 'rgba(148,163,184,0.34)',
    backgroundColor: 'rgba(15,23,42,0.74)'
  };
}

function shouldBlockManualAssistantAction(activeAction, requestedAction) {
  return !!safeText(activeAction) && !!safeText(requestedAction);
}

function readManualFieldCurrentValue(field) {
  if (!field) return '';
  const tagName = safeText(field.tagName).toLowerCase();
  if (tagName === 'select' && field.options && field.selectedIndex >= 0) {
    const selected = field.options[field.selectedIndex];
    return safeText((selected && (selected.value || selected.textContent)) || field.value);
  }
  if (field.isContentEditable) return safeText(field.innerText || field.textContent);
  return safeText(field.value);
}

function collectManualFinalFieldSnapshot(fields, specs) {
  const inputFields = Array.isArray(fields) ? fields : [];
  const inputSpecs = Array.isArray(specs) ? specs : [];
  const outputFields = [];
  const fieldValuesById = {};
  const fieldValuesByRole = {};
  let commentText = '';

  inputFields.forEach((field, index) => {
    const spec = normalizeManualFieldSpec(inputSpecs[index] || {}, index);
    if (isSensitiveManualField(field, spec)) return;
    const value = readManualFieldCurrentValue(field);
    if (!value) return;
    outputFields.push({
      fieldId: spec.fieldId,
      role: spec.role,
      label: spec.label,
      value
    });
    fieldValuesById[spec.fieldId] = value;
    if (!fieldValuesByRole[spec.role]) fieldValuesByRole[spec.role] = value;
    if (!commentText && ['comment', 'message', 'content', 'description', 'bio', 'profileBio'].includes(spec.role)) {
      commentText = value;
    }
  });

  return { fields: outputFields, fieldValuesById, fieldValuesByRole, commentText };
}

const api = {
  buildManualFieldId,
  chooseManualFieldValue,
  collectManualFinalFieldSnapshot,
  getManualAssistantStatusTone,
  normalizeManualFieldSpec,
  normalizeManualPageType,
  selectBestManualChoiceOption,
  shouldBlockManualAssistantAction,
  shouldAttemptManualFieldFill
};

root.AutoCommentManualAssistantFieldLogic = api;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== 'undefined' ? globalThis : window);
