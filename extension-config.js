(function () {
  const DEFAULT_API_BASE = 'http://127.0.0.1:3000/api';

  window.AUTO_COMMENT_CONFIG = Object.freeze({
    API_BASE: DEFAULT_API_BASE
  });

  console.info('[AutoComment][config] API_BASE =', window.AUTO_COMMENT_CONFIG.API_BASE);
})();
