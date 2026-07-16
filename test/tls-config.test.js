const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  freshRequire,
  makeTempDir
} = require('./helpers/tls-test-utils');

function loadConfig(envOverrides) {
  return freshRequire(path.join(process.cwd(), 'src/config.js'), envOverrides);
}

test('TLS config defaults provide the local CA layout and remain disabled by default', () => {
  const config = loadConfig({
    TLS_ENABLED: undefined,
    TLS_DIR: undefined,
    TLS_SERVER_CERT_MODE: undefined,
    TLS_SERVER_NAME: undefined,
    TLS_CA_DAYS: undefined,
    TLS_CERT_DAYS: undefined,
    TLS_RENEW_BEFORE_DAYS: undefined,
    TLS_CA_KEY_FILE: undefined,
    TLS_CA_CERT_FILE: undefined,
    TLS_SERVER_KEY_FILE: undefined,
    TLS_SERVER_CERT_FILE: undefined
  });

  assert.equal(config.tlsEnabled, false);
  assert.equal(config.tlsDir, '/data/tls');
  assert.equal(config.tlsServerCertMode, 'managed');
  assert.equal(config.tlsServerName, 'alexa-cookie-service');
  assert.equal(config.tlsCaDays, 3650);
  assert.equal(config.tlsCertDays, 365);
  assert.equal(config.tlsRenewBeforeDays, 30);
  assert.equal(config.tlsCaKeyFile, '/data/tls/ca.key');
  assert.equal(config.tlsCaCertFile, '/data/tls/ca.crt');
  assert.equal(config.tlsServerKeyFile, '/data/tls/server.key');
  assert.equal(config.tlsServerCertFile, '/data/tls/server.crt');
});

test('TLS config parses overrides and explicit file paths', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-config-');
  const tlsDir = path.join(tmpDir, 'tls');

  const config = loadConfig({
    TLS_ENABLED: 'true',
    TLS_DIR: tlsDir,
    TLS_SERVER_CERT_MODE: 'external',
    TLS_SERVER_NAME: 'acs.example.internal',
    TLS_CA_DAYS: '7300',
    TLS_CERT_DAYS: '90',
    TLS_RENEW_BEFORE_DAYS: '14',
    TLS_CA_KEY_FILE: path.join(tlsDir, 'root.key'),
    TLS_CA_CERT_FILE: path.join(tlsDir, 'root.crt'),
    TLS_SERVER_KEY_FILE: path.join(tlsDir, 'leaf.key'),
    TLS_SERVER_CERT_FILE: path.join(tlsDir, 'leaf.crt')
  });

  assert.equal(config.tlsEnabled, true);
  assert.equal(config.tlsDir, tlsDir);
  assert.equal(config.tlsServerCertMode, 'external');
  assert.equal(config.tlsServerName, 'acs.example.internal');
  assert.equal(config.tlsCaDays, 7300);
  assert.equal(config.tlsCertDays, 90);
  assert.equal(config.tlsRenewBeforeDays, 14);
  assert.equal(config.tlsCaKeyFile, path.join(tlsDir, 'root.key'));
  assert.equal(config.tlsCaCertFile, path.join(tlsDir, 'root.crt'));
  assert.equal(config.tlsServerKeyFile, path.join(tlsDir, 'leaf.key'));
  assert.equal(config.tlsServerCertFile, path.join(tlsDir, 'leaf.crt'));
});
