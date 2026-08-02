(function initManualAssistantSessionLogic(root) {
'use strict';

function shouldRecordNativeManualSubmission(input) {
  const source = input && typeof input === 'object' ? input : {};
  return source.manualSessionActive === true && source.hasLocalBatchContext !== true;
}

function shouldAllowManualAssistant(input) {
  const source = input && typeof input === 'object' ? input : {};
  return source.hasLocalBatchContext !== true;
}

const api = {
  shouldRecordNativeManualSubmission,
  shouldAllowManualAssistant
};

root.AutoCommentManualAssistantSessionLogic = api;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== 'undefined' ? globalThis : window);
