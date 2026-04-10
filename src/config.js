const path = require('path');

function envBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envInt(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const dataDir = process.env.DATA_DIR || '/data';

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: envInt('PORT', 8080),
  logLevel: process.env.LOG_LEVEL || 'combined',
  authToken: process.env.AUTH_TOKEN || '',
  dataDir,
  stateFile: process.env.STATE_FILE || path.join(dataDir, 'alexa-registration.json'),
  metadataFile: process.env.METADATA_FILE || path.join(dataDir, 'service-metadata.json'),
  cookieExportFile: process.env.COOKIE_EXPORT_FILE || path.join(dataDir, 'cookie.txt'),
  debugHtmlDir: process.env.DEBUG_HTML_DIR || path.join(dataDir, 'debug-html'),
  amazonPage: process.env.AMAZON_PAGE || 'amazon.de',
  baseAmazonPage: process.env.BASE_AMAZON_PAGE || process.env.AMAZON_PAGE || 'amazon.de',
  acceptLanguage: process.env.ACCEPT_LANGUAGE || 'de-DE',
  proxyOwnIp: process.env.PROXY_OWN_IP || '',
  proxyListenBind: process.env.PROXY_LISTEN_BIND || '0.0.0.0',
  proxyPort: envInt('PROXY_PORT', 8090),
  proxyOnly: envBool('PROXY_ONLY', true),
  setupProxy: envBool('SETUP_PROXY', true),
  appName: process.env.APP_NAME || 'FHEM EchoDevice Cookie Service',
  useHermes: envBool('USE_HERMES', false),
  refreshScheduleHours: envInt('REFRESH_SCHEDULE_HOURS', 24),
  refreshMinAgeHours: envInt('REFRESH_MIN_AGE_HOURS', 6),
  requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 30000)
};
