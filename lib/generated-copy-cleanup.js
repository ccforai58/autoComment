function stripGeneratedCopyMarkdownFences(value) {
  const text = String(value || '').trim();
  const match = text.match(/^<?```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```>?$/);
  if (!match) {
    return text;
  }
  return match[1].trim();
}

module.exports = {
  stripGeneratedCopyMarkdownFences
};
