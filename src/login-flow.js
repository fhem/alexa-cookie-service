function buildLoginFlowResponse({ message, proxyUrl, ...rest } = {}) {
  const response = {
    error: '',
    ...rest
  };

  if (message !== undefined) {
    response.message = message;
  }
  if (proxyUrl !== undefined) {
    response.proxyUrl = proxyUrl;
  }

  return response;
}

module.exports = {
  buildLoginFlowResponse
};
