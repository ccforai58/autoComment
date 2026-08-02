const COMMENT_STRUCTURE_RULE = [
  '',
  'Comment structure requirements:',
  "Start by affirming the article's value using a specific topic, insight, method, example, or reader benefit from the current page.",
  'Then add one substantive follow-up viewpoint, suggestion, or extension and integrate the promoted website as a useful resource within that second part.',
  'For space-delimited languages, make the value affirmation approximately 30 words and the follow-up viewpoint approximately 50 words.',
  'For Chinese, Japanese, Korean, Thai, Lao, and Burmese, make the value affirmation approximately 50 to 70 characters and the follow-up viewpoint approximately 100 to 140 characters.',
  'Prefer a specific direct connection between the article and promoted website. If their primary topics differ, find and state a specific secondary connection grounded in their supplied content, such as writing method, content structure, user experience, page speed, visual presentation, workflow, creative inspiration, case presentation, or audience need.',
  'Do not use vague bridges such as "worth learning" or "very helpful", and do not invent facts, capabilities, results, or claims for either website.',
  'The HTML anchor must be naturally embedded in the second part, not added as a detached link.',
  'Never output planning, instructions, or an explanation of how to write the comment. Output only the final publishable comment in the page language.'
].join('\n');

const LINK_HREF_NEWLINE_RULE = [
  '',
  'Link format requirements:',
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
  '">click here</a>',
  'Wrong examples:',
  '<a href="https://example.com/">click here</a>',
  '<a href="https://example.com/\\n">click here</a>',
  'The required line break must be an actual newline character in the output, not the two characters \\ and n.'
].join('\n');

function buildSkillTemplate(baseTemplate, options = {}) {
  const template = String(baseTemplate || '').trim();
  if (!options.requireHtmlAnchor) return template;

  const parts = [template];
  if (options.requireCommentStructure) parts.push(COMMENT_STRUCTURE_RULE);
  parts.push(LINK_HREF_NEWLINE_RULE);
  return parts.filter(Boolean).join('\n');
}

module.exports = { buildSkillTemplate };
