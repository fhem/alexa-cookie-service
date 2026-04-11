const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const config = require('./config');
const { readJson, writeJson, ensureDirForFile } = require('./store');
const { startAlexaCookieFlow, refreshAlexaCookie, stopProxyServer } = require('./alexa');

ensureDirForFile(config.stateFile);
ensureDirForFile(config.metadataFile);
ensureDirForFile(config.cookieExportFile);
fs.mkdirSync(config.debugHtmlDir, { recursive: true });

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.logLevel));

function buildBaseOptions() {
  return {
    amazonPage: config.amazonPage,
    baseAmazonPage: config.baseAmazonPage,
    acceptLanguage: config.acceptLanguage,
    proxyOwnIp: config.proxyOwnIp,
    proxyListenBind: config.proxyListenBind,
    proxyPort: config.proxyPort,
    proxyOnly: config.proxyOnly,
    setupProxy: config.setupProxy,
    deviceAppName: config.appName,
    useHermes: config.useHermes,
    debug: false,
    logger: (...args) => console.log(...args),
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

function exportCookieArtifacts(state) {
  const cookie = state?.localCookie || state?.cookie || '';
  writeJson(config.cookieExportFile, buildEchoDeviceCache(state), { compact: true });
  writeJson(config.metadataFile, {
    updatedAt: new Date().toISOString(),
    hasCookie: Boolean(cookie),
    hasCsrf: Boolean(state?.csrf),
    hasRefreshToken: Boolean(state?.refreshToken),
    amazonPage: config.amazonPage,
    appName: state?.amazonPage || config.appName
  });
}

function persistState(state, source = 'unknown') {
  const enriched = {
    ...state,
    serviceUpdatedAt: new Date().toISOString(),
    serviceSource: source
  };
  writeJson(config.stateFile, enriched);
  exportCookieArtifacts(enriched);
  return enriched;
}

function isProxyFlowNotice(error) {
  return Boolean(error?.message && error.message.startsWith('Please open http://'));
}

function extractProxyUrl(error) {
  const match = error?.message?.match(/Please open (http:\/\/\S+)\s+with your browser/i);
  return match ? match[1] : `http://${config.proxyOwnIp || 'HOSTNAME_MISSING'}:${config.proxyPort}/`;
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

async function performRefresh(reason = 'manual') {
  const state = loadState();
  if (!state) {
    const error = new Error('No persisted registration state available');
    error.code = 'NO_STATE';
    throw error;
  }

  const options = {
    ...buildBaseOptions(),
    formerRegistrationData: state
  };

  const refreshed = await refreshAlexaCookie(options);
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

app.get('/healthz', (req, res) => {
  const status = getStatus();
  res.status(status.ok ? 200 : 503).json(status);
});

app.get('/api/status', requireAuth, (req, res) => {
  res.json(getStatus());
});

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
      res.status(202).json({
        message: error.message,
        proxyUrl: extractProxyUrl(error)
      });
    },
    onComplete(result) {
      const persisted = persistState(result, source);
      proxyFlowActive = false;
      if (responded) return;
      responded = true;
      res.json({
        message: 'Login flow finished. State was persisted successfully.',
        state: sanitizeState(persisted)
      });
    },
    onError(error) {
      proxyFlowActive = false;
      console.error('Alexa login flow failed:', error.message);
      if (responded) return;
      responded = true;
      res.status(500).json({ error: error.message });
    }
  });
}

app.post('/api/login/start', requireAuth, async (req, res) => {
  try {
    await stopProxyFlowIfActive();
    const state = loadState();
    beginLoginFlow(
      res,
      {
        ...buildBaseOptions(),
        proxyOnly: true,
        formerRegistrationData: state || undefined,
        ...(req.body?.proxyOwnIp ? { proxyOwnIp: req.body.proxyOwnIp } : {})
      },
      'login:start'
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/login/url', requireAuth, async (req, res) => {
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
});

app.post('/api/refresh', requireAuth, async (req, res) => {
  try {
    const state = await refreshSingleton('api');
    res.json({ message: 'Refresh successful', state: sanitizeState(state) });
  } catch (error) {
    const statusCode = error.code === 'NO_STATE' ? 404 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

app.get('/api/cookie', requireAuth, (req, res) => {
  const state = loadState();
  if (!state) {
    res.status(404).json({ error: 'No persisted state available' });
    return;
  }
  res.json({
    ...buildEchoDeviceCache(state),
    serviceUpdatedAt: state.serviceUpdatedAt || null
  });
});

app.get('/api/cookie.txt', requireAuth, (req, res) => {
  const state = loadState();
  if (!state) {
    res.status(404).type('text/plain').send('');
    return;
  }
  res.type('text/plain').send(state.localCookie || state.cookie || '');
});

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
      console.log('Scheduled refresh completed');
    } catch (error) {
      console.error('Scheduled refresh failed:', error.message);
    }
  }, intervalMs);
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(config.port, config.host, () => {
  console.log(`alexa-cookie-service listening on ${config.host}:${config.port}`);
  if (!config.proxyOwnIp) {
    console.warn('PROXY_OWN_IP is empty. Manual login flows may fail or generate unusable proxy URLs.');
  }
  scheduleRefreshLoop();
});
