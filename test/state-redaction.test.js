const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 58127;
const SECRETS = {
  loginCookie: 'secret-login-cookie',
  localCookie: 'session-id=secret-local-cookie',
  cookie: 'secret-plain-cookie',
  refreshToken: 'secret-refresh-token',
  accessToken: 'secret-access-token',
  csrf: 'secret-csrf',
  frc: 'secret-frc',
  'map-md': 'secret-map-md',
  deviceId: 'secret-device-id',
  deviceSerial: 'secret-device-serial',
  macDms: { device_private_key: 'secret-private-key', adp_token: 'secret-adp-token' },
  formerRegistrationData: { loginCookie: 'secret-former-login-cookie', refreshToken: 'secret-former-refresh' }
};
const KEPT = {
  amazonPage: 'amazon.de',
  deviceAppName: 'FHEM EchoDevice Cookie Service',
  tokenDate: 1793388539540,
  dataVersion: 2
};
const LEAK_MARKERS = [
  'secret-login-cookie',
  'secret-local-cookie',
  'secret-plain-cookie',
  'secret-refresh-token',
  'secret-access-token',
  'secret-csrf',
  'secret-frc',
  'secret-map-md',
  'secret-device-id',
  'secret-device-serial',
  'secret-private-key',
  'secret-adp-token',
  'secret-former'
];

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      { method: 'GET', hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(state, run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-service-'));
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    AUTH_TOKEN: 'test-token',
    DATA_DIR: path.join(tmpDir, 'data'),
    STATE_FILE: path.join(tmpDir, 'data', 'state.json'),
    METADATA_FILE: path.join(tmpDir, 'data', 'metadata.json'),
    COOKIE_EXPORT_DIR: path.join(tmpDir, 'exports'),
    DEBUG_HTML_DIR: path.join(tmpDir, 'debug')
  };
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(env.STATE_FILE, JSON.stringify(state));

  const child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start in time')), 10000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early with code ${code}`));
    });
  });

  try {
    await ready;
    await run();
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function assertNoSecrets(body) {
  for (const marker of LEAK_MARKERS) {
    assert.ok(!body.includes(marker), `response leaks ${marker}`);
  }
}

test('status and state responses redact secrets but keep non-secret fields and flags', async () => {
  await withServer({ ...SECRETS, ...KEPT }, async () => {
    const headers = { 'x-auth-token': 'test-token' };

    const status = await request(`http://127.0.0.1:${PORT}/api/status`, headers);
    assert.equal(status.statusCode, 200);
    assertNoSecrets(status.body);
    const statusJson = JSON.parse(status.body);
    assert.equal(statusJson.hasCookie, true);
    assert.equal(statusJson.hasCsrf, true);
    assert.equal(statusJson.hasRefreshToken, true);
    assert.equal(statusJson.amazonPage, 'amazon.de');
    assert.equal(statusJson.state.macDms, '<redacted>');
    assert.equal(statusJson.state.formerRegistrationData, '<redacted>');
    for (const [key, value] of Object.entries(KEPT)) {
      assert.equal(statusJson.state[key], value, `${key} is kept`);
    }

    const state = await request(`http://127.0.0.1:${PORT}/api/state`, headers);
    assert.equal(state.statusCode, 200);
    assertNoSecrets(state.body);
  });
});

test('the cookie export and raw state stay unredacted for echodevice', async () => {
  await withServer({ ...SECRETS, ...KEPT }, async () => {
    const headers = { 'x-auth-token': 'test-token' };

    const raw = await request(`http://127.0.0.1:${PORT}/api/state?raw=1`, headers);
    assert.equal(JSON.parse(raw.body).macDms.adp_token, 'secret-adp-token');

    const cookie = await request(`http://127.0.0.1:${PORT}/api/cookie`, headers);
    assert.equal(cookie.statusCode, 200);
    const exported = JSON.parse(cookie.body);
    assert.equal(exported.localCookie, 'session-id=secret-local-cookie');
    assert.equal(exported.refreshToken, 'secret-refresh-token');
    assert.equal(exported.macDms.adp_token, 'secret-adp-token');
  });
});
