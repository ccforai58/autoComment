function escapeLiteralNewlinesInsideJsonStrings(value) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString && (character === '\n' || character === '\r')) {
      result += '\\n';
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      escaped = false;
      continue;
    }
    result += character;
    if (character === '\\' && inString) {
      escaped = !escaped;
      continue;
    }
    if (character === '"' && !escaped) inString = !inString;
    escaped = false;
  }

  return result;
}

function parseManualAssistantJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    try {
      const parsed = JSON.parse(escapeLiteralNewlinesInsideJsonStrings(match[0]));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }
}

module.exports = { parseManualAssistantJson };
