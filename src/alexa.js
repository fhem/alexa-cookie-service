const AlexaCookie = require('alexa-cookie2');

function startAlexaCookieFlow(options, handlers = {}) {
  AlexaCookie.generateAlexaCookie('', '', options, (error, result) => {
    if (error) {
      const normalized = normalizeError(error);
      if (handlers.onProxyReady && isProxyFlowNotice(normalized)) {
        handlers.onProxyReady(normalized);
        return;
      }
      handlers.onError?.(normalized);
      return;
    }
    handlers.onComplete?.(result);
  });
}

function refreshAlexaCookie(options) {
  return new Promise((resolve, reject) => {
    AlexaCookie.refreshAlexaCookie(options, (error, result) => {
      if (error) {
        reject(normalizeError(error));
        return;
      }
      resolve(result);
    });
  });
}

function stopProxyServer() {
  return new Promise((resolve) => {
    AlexaCookie.stopProxyServer(() => resolve());
  });
}

function isProxyFlowNotice(error) {
  return Boolean(error?.message && error.message.startsWith('Please open http://'));
}

function normalizeError(error) {
  if (!error) return new Error('Unknown alexa-cookie error');
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

module.exports = {
  startAlexaCookieFlow,
  refreshAlexaCookie,
  stopProxyServer
};
