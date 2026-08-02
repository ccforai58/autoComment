function stripGeneratedCopyMarkdownFences(value) {
  const text = String(value || '').trim();
  const match = text.match(/^<?```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```>?$/);
  if (!match) {
    return text;
  }
  return match[1].trim();
}

function validateGeneratedComment(value) {
  const text = stripGeneratedCopyMarkdownFences(value);
  const metaInstructionPatterns = [
    /\bwe need (?:to )?(?:answer|craft|include|write|respond)\b/i,
    /\bneed (?:to )?(?:craft|include|write)\b/i,
    /\b(?:must|should|need to) include (?:an? )?(?:html\s*)?(?:link|anchor)\b/i,
    /\bhtml\s*anchor\b/i,
    /\bhref with (?:a )?(?:newline|line break)\b/i,
    /\banchor text rooted\b/i,
    /\bpage lang(?:uage)?\b/i
  ];
  if (metaInstructionPatterns.some((pattern) => pattern.test(text))) {
    return { valid: false, reason: 'meta_instruction_output' };
  }
  return { valid: true, reason: '' };
}

module.exports = {
  stripGeneratedCopyMarkdownFences,
  validateGeneratedComment
};
