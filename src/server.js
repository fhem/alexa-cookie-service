const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { readJson, writeJson, ensureDirForFile } = require('./store');
const { startAlexaCookieFlow, refreshAlexaCookie, stopProxyServer } = require('./alexa');
const { buildLoginFlowResponse } = require('./login-flow');
const { ensureDir } = require('./fs-utils');

ensureDirForFile(config.stateFile);
ensureDirForFile(config.metadataFile);
ensureDir(config.cookieExportDir, { mkdirSync: fs.mkdirSync, logger, label: 'cookie export directory' });
ensureDir(config.debugHtmlDir, { mkdirSync: fs.mkdirSync, logger, label: 'debug HTML directory' });

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.logLevel, { stream: logger.httpStream }));

function buildBaseOptions() {
  return {
    amazonPage: config.amazonPage,
    baseAmazonPage: config.baseAmazonPage,
    acceptLanguage: config.acceptLanguage,
    proxyOwnIp: config.proxyPublicHost,
    proxyListenBind: config.proxyListenBind,
    proxyPort: config.proxyPort,
    proxyOnly: config.proxyOnly,
    setupProxy: config.setupProxy,
    deviceAppName: config.appName,
    useHermes: config.useHermes,
    debug: false,
    logger: (...args) => logger.info(...args),
    callbackEndpoint: '/api/login/callback',
    closeAfterLogin: true,
    proxyRootPath: '/',
    expressInstance: app,
    proxyLogLevel: 'info'
  };
}

function requireAuth(req, res, next) {
  if (!config.authToken) {
    next();
    return;
  }
  const token = req.header('x-auth-token') || req.query.token;
  if (token !== config.authToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function loadState() {
  return readJson(config.stateFile, null);
}

function sanitizeState(state) {
  if (!state) return null;
  const clone = JSON.parse(JSON.stringify(state));
  if (clone.loginCookie) clone.loginCookie = '<redacted>';
  if (clone.localCookie) clone.localCookie = '<redacted>';
  if (clone.cookie) clone.cookie = '<redacted>';
  if (clone.refreshToken) clone.refreshToken = '<redacted>';
  if (clone.accessToken) clone.accessToken = '<redacted>';
  return clone;
}

function stripServiceMetadata(state) {
  if (!state || typeof state !== 'object') return {};
  const clone = JSON.parse(JSON.stringify(state));
  delete clone.serviceUpdatedAt;
  delete clone.serviceSource;
  return clone;
}

function buildEchoDeviceCache(state) {
  if (!state) return null;
  return {
    localCookie: state.localCookie || state.cookie || '',
    csrf: state.csrf || '',
    refreshToken: state.refreshToken || '',
    macDms: state.macDms || '',
    formerRegistrationData: stripServiceMetadata(state.formerRegistrationData || state)
  };
}

function writeMetadata(state) {
  const cookie = state?.localCookie || state?.cookie || '';
  writeJson(config.metadataFile, {
    updatedAt: new Date().toISOString(),
    hasCookie: Boolean(cookie),
    hasCsrf: Boolean(state?.csrf),
    hasRefreshToken: Boolean(state?.refreshToken),
    amazonPage: config.amazonPage,
    appName: state?.amazonPage || config.appName
  });
}

function resolveSaveTarget(save) {
  if (typeof save !== 'string') return null;
  const trimmed = save.trim();
  if (!trimmed) return null;
  return path.join(config.cookieExportDir, path.basename(trimmed));
}

function getSaveTarget(req) {
  return resolveSaveTarget(req.query?.save || req.body?.save);
}

function saveEchoDeviceCache(filePath, state) {
  writeJson(filePath, buildEchoDeviceCache(state), { compact: true });
}

function saveEchoDeviceCacheDeferred(filePath, state) {
  setImmediate(() => {
    try {
      saveEchoDeviceCache(filePath, state);
      logger.info(`Cookie export written to ${filePath}`);
    } catch (error) {
      logger.error(`Failed to write cookie export ${filePath}:`, error.message);
    }
  });
}

function persistState(state, source = 'unknown') {
  const enriched = {
    ...state,
    serviceUpdatedAt: new Date().toISOString(),
    serviceSource: source
  };
  writeJson(config.stateFile, enriched);
  writeMetadata(enriched);
  return enriched;
}

function isProxyFlowNotice(error) {
  return Boolean(error?.message && error.message.startsWith('Please open http://'));
}

function extractProxyUrl(error) {
  const match = error?.message?.match(/Please open (http:\/\/\S+)\s+with your browser/i);
  return match ? match[1] : `http://${config.proxyPublicHost || 'HOSTNAME_MISSING'}:${config.proxyPort}/`;
}

function getStatus() {
  const state = loadState();
  const updatedAt = state?.serviceUpdatedAt || null;
  let ageHours = null;
  if (updatedAt) {
    ageHours = Math.round(((Date.now() - new Date(updatedAt).getTime()) / 3600000) * 100) / 100;
  }
  return {
    ok: Boolean(state),
    updatedAt,
    ageHours,
    hasCookie: Boolean(state?.localCookie || state?.cookie),
    hasCsrf: Boolean(state?.csrf),
    hasRefreshToken: Boolean(state?.refreshToken),
    amazonPage: config.amazonPage,
    state: sanitizeState(state)
  };
}

function shouldAutoRefreshStatus(state) {
  if (!state?.serviceUpdatedAt) return false;

  const updatedAtMs = new Date(state.serviceUpdatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return false;

  const ageHours = (Date.now() - updatedAtMs) / 3600000;
  return ageHours >= config.refreshMinAgeHours;
}

async function performRefresh(reason = 'manual') {
  const state = loadState();
  if (!state) {
    const error = new Error('Start Login Flow.');
    error.code = 'NO_STATE';
    throw error;
  }

  const options = {
    ...buildBaseOptions(),
    formerRegistrationData: state
  };

  const startedAt = Date.now();
  logger.info(`Starting refresh (${reason})`);
  const refreshed = await refreshAlexaCookie(options);
  logger.info(`Refresh finished (${reason}) in ${Date.now() - startedAt} ms`);
  return persistState(refreshed, `refresh:${reason}`);
}

let refreshInFlight = null;
let proxyFlowActive = false;
async function refreshSingleton(reason = 'manual') {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(reason).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function stopProxyFlowIfActive() {
  if (!proxyFlowActive) return;
  await stopProxyServer();
  proxyFlowActive = false;
}

async function handleStatus(req, res) {
  try {
    const state = loadState();
    if (state && shouldAutoRefreshStatus(state)) {
      try {
        await refreshSingleton('status');
        logger.info('Status request triggered automatic refresh');
      } catch (error) {
        logger.error('Automatic status refresh failed:', error.message);
      }
    }

    res.json(getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.get('/healthz', (req, res) => {
  const status = getStatus();
  res.status(200).json(status);
});

app.get('/api/status', requireAuth, handleStatus);

app.get('/api/state', requireAuth, (req, res) => {
  const raw = req.query.raw === '1';
  const state = loadState();
  if (!state) {
    res.status(404).json({ error: 'No persisted state available' });
    return;
  }
  res.json(raw ? state : sanitizeState(state));
});

function beginLoginFlow(res, options, source) {
  let responded = false;

  startAlexaCookieFlow(options, {
    onProxyReady(error) {
      proxyFlowActive = true;
      if (responded) return;
      responded = true;
      res.status(202).json(buildLoginFlowResponse({
        message: error.message,
        proxyUrl: extractProxyUrl(error)
      }));
    },
    onComplete(result) {
      const persisted = persistState(result, source);
      stopProxyFlowIfActive().catch((stopError) => {
        logger.error('Failed to stop proxy server after login:', stopError.message);
      }).finally(() => {
        proxyFlowActive = false;
        if (responded) return;
        responded = true;
        res.json(buildLoginFlowResponse({
          message: 'Login flow finished. State was persisted successfully.',
          state: sanitizeState(persisted)
        }));
      });
    },
    onError(error) {
      stopProxyFlowIfActive().catch((stopError) => {
        logger.error('Failed to stop proxy server after login error:', stopError.message);
      }).finally(() => {
        proxyFlowActive = false;
        logger.error('Alexa login flow failed:', error.message);
        if (responded) return;
        responded = true;
        res.status(500).json({ error: error.message });
      });
    }
  });
}

async function handleLoginStart(req, res) {
  try {
    await stopProxyFlowIfActive();
    const state = loadState();
    beginLoginFlow(
      res,
      {
        ...buildBaseOptions(),
        proxyOnly: true,
        formerRegistrationData: state || undefined,
        ...((req.body?.proxyPublicHost || req.body?.proxyOwnIp)
          ? { proxyOwnIp: req.body?.proxyPublicHost || req.body?.proxyOwnIp }
          : {})
      },
      'login:start'
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function handleLoginUrl(req, res) {
  try {
    await stopProxyFlowIfActive();
    beginLoginFlow(
      res,
      {
        ...buildBaseOptions(),
        proxyOnly: true,
        formerRegistrationData: loadState() || undefined
      },
      'login:url'
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function handleCookieRefresh(req, res) {
  try {
    const requestStartedAt = Date.now();
    const state = await refreshSingleton('api');
    const saveTarget = getSaveTarget(req);
    if (saveTarget) {
      saveEchoDeviceCacheDeferred(saveTarget, state);
    }
    res.json({
      message: '',
      saveTarget: saveTarget ? path.basename(saveTarget) : null,
      state: sanitizeState(state)
    });
    logger.info(
      `Refresh request handled in ${Date.now() - requestStartedAt} ms` +
        (saveTarget ? ` (saveTarget=${path.basename(saveTarget)})` : '')
    );
  } catch (error) {
    const statusCode = error.code === 'NO_STATE' ? 200 : 500;
    res.status(statusCode).json({
      error: error.message,
      code: error.code || 'REFRESH_FAILED',
      action: error.code === 'NO_STATE' ? 'Start Login Flow.' : undefined
    });
    logger.error('Refresh request failed:', error.message);
  }
}

function handleCookieJson(req, res) {
  const state = loadState();
  if (!state) {
    res.status(404).json({ error: 'No persisted state available' });
    return;
  }
  const cookiePayload = {
    ...buildEchoDeviceCache(state),
    serviceUpdatedAt: state.serviceUpdatedAt || null
  };
  const saveTarget = getSaveTarget(req);
  if (saveTarget) {
    saveEchoDeviceCache(saveTarget, state);
  }
  res.json(cookiePayload);
}

function handleCookieText(req, res) {
  const state = loadState();
  if (!state) {
    res.status(404).type('text/plain').send('');
    return;
  }
  res.type('text/plain').send(state.localCookie || state.cookie || '');
}

app.post('/api/cookie/login/start', requireAuth, handleLoginStart);
app.post('/api/login/start', requireAuth, handleLoginStart);

app.get('/api/cookie/login/url', requireAuth, handleLoginUrl);
app.get('/api/login/url', requireAuth, handleLoginUrl);

app.post('/api/cookie/refresh', requireAuth, handleCookieRefresh);
app.post('/api/refresh', requireAuth, handleCookieRefresh);

app.get('/api/cookie', requireAuth, handleCookieJson);

app.get('/api/cookie/text', requireAuth, handleCookieText);
app.get('/api/cookie.txt', requireAuth, handleCookieText);

function scheduleRefreshLoop() {
  if (!Number.isFinite(config.refreshScheduleHours) || config.refreshScheduleHours <= 0) return;
  const intervalMs = config.refreshScheduleHours * 3600000;
  setInterval(async () => {
    try {
      const current = loadState();
      if (!current?.serviceUpdatedAt) return;
      const ageMs = Date.now() - new Date(current.serviceUpdatedAt).getTime();
      if (ageMs < config.refreshMinAgeHours * 3600000) return;
      await refreshSingleton('scheduled');
      logger.info('Scheduled refresh completed');
    } catch (error) {
      logger.error('Scheduled refresh failed:', error.message);
    }
  }, intervalMs);
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(config.port, config.host, () => {
  logger.info(`alexa-cookie-service listening on ${config.host}:${config.port}`);
  if (!config.proxyPublicHost) {
    logger.warn('PROXY_PUBLIC_HOST is empty. Manual login flows may fail or generate unusable proxy URLs.');
  }
  logger.info(`Log timestamps use timezone ${config.timeZone}`);
  scheduleRefreshLoop();
});
