const AlexaCookie = require('alexa-cookie2');

function generateAlexaCookie(options) {
  return new Promise((resolve, reject) => {
    AlexaCookie.generateAlexaCookie('', '', options, (error, result) => {
      if (error) {
        reject(normalizeError(error));
        return;
      }
      resolve(result);
    });
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
  generateAlexaCookie,
  refreshAlexaCookie
};
