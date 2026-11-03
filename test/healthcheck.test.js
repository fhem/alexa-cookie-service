const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { generateCertificateAuthority, generateServerCertificate } = require('./helpers/tls-test-utils');

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start in time')), 15000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.includes('EACCES') || text.includes('Error:')) {
        clearTimeout(timeout);
        reject(new Error(text));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('server exited early with code ' + code));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

test('healthcheck uses the configured TLS CA path and loopback independently of bind HOST', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-healthcheck-'));
  const tlsDir = path.join(tmpDir, 'tls');
  const dataDir = path.join(tmpDir, 'data');
  const externalCaPath = path.join(tmpDir, 'external-ca.crt');
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: '58152',
    HOST: '0.0.0.0',
    AUTH_TOKEN: 'test-token',
    TLS_ENABLED: 'true',
    TLS_DIR: tlsDir,
    DATA_DIR: dataDir,
    STATE_FILE: path.join(dataDir, 'state.json'),
    METADATA_FILE: path.join(dataDir, 'metadata.json'),
    COOKIE_EXPORT_DIR: path.join(tmpDir, 'exports'),
    DEBUG_HTML_DIR: path.join(tmpDir, 'debug')
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);
    fs.copyFileSync(path.join(tlsDir, 'ca.crt'), externalCaPath);
    fs.unlinkSync(path.join(tlsDir, 'ca.crt'));

    const healthcheck = spawn(process.execPath, ['scripts/healthcheck.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '58152',
        HOST: '0.0.0.0',
        TLS_ENABLED: 'true',
        TLS_SERVER_CERT_MODE: 'external',
        TLS_DIR: tlsDir,
        TLS_CA_CERT_FILE: externalCaPath
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });

    const exitCode = await new Promise((resolve, reject) => {
      healthcheck.on('error', reject);
      healthcheck.on('exit', (code) => resolve(code));
    });

    assert.equal(exitCode, 0);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('external TLS healthcheck does not require the managed default CA file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-healthcheck-external-'));
  const healthcheck = spawn(process.execPath, ['scripts/healthcheck.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '9',
      TLS_ENABLED: 'true',
      TLS_SERVER_CERT_MODE: 'external',
      TLS_DIR: path.join(tmpDir, 'missing-tls-directory')
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let stderr = '';
  healthcheck.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exitCode = await new Promise((resolve, reject) => {
    healthcheck.on('error', reject);
    healthcheck.on('exit', resolve);
  });

  assert.equal(exitCode, 1);
  assert.doesNotMatch(stderr, /ENOENT|ca\.crt/);
});

test('healthcheck passes for an external certificate without 127.0.0.1 in its SAN', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-healthcheck-san-'));
  const dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const serverName = 'acs.example.internal';
  const { caKey, caCert } = generateCertificateAuthority(path.join(tmpDir, 'ca'));
  const { serverKey, serverCert } = generateServerCertificate(path.join(tmpDir, 'server'), {
    commonName: serverName,
    dnsNames: [serverName],
    caKey,
    caCert
  });

  const tlsEnv = {
    PORT: String(await getFreePort()),
    TLS_ENABLED: 'true',
    TLS_SERVER_CERT_MODE: 'external',
    TLS_SERVER_NAME: serverName,
    TLS_SERVER_KEY_FILE: serverKey,
    TLS_SERVER_CERT_FILE: serverCert,
    TLS_CA_CERT_FILE: caCert
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...tlsEnv,
      HOST: '0.0.0.0',
      AUTH_TOKEN: 'test-token',
      DATA_DIR: dataDir,
      STATE_FILE: path.join(dataDir, 'state.json'),
      METADATA_FILE: path.join(dataDir, 'metadata.json'),
      COOKIE_EXPORT_DIR: path.join(tmpDir, 'exports'),
      DEBUG_HTML_DIR: path.join(tmpDir, 'debug')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);

    const run = (extraEnv) => new Promise((resolve, reject) => {
      const healthcheck = spawn(process.execPath, ['scripts/healthcheck.js'], {
        cwd: process.cwd(),
        env: { ...process.env, ...tlsEnv, ...extraEnv },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      healthcheck.stderr.on('data', (chunk) => { stderr += String(chunk); });
      healthcheck.on('error', reject);
      healthcheck.on('exit', (code) => resolve({ code, stderr }));
    });

    assert.equal((await run({})).code, 0);

    const mismatch = await run({ HEALTHCHECK_SERVERNAME: 'other.example.internal' });
    assert.equal(mismatch.code, 1);
    assert.match(mismatch.stderr, /ERR_TLS_CERT_ALTNAME_INVALID/);

    // Pins the original failure: verifying against the loopback address itself.
    const loopback = await run({ HEALTHCHECK_HOST: '127.0.0.1' });
    assert.equal(loopback.code, 1);
    assert.match(loopback.stderr, /ERR_TLS_CERT_ALTNAME_INVALID/);

    assert.equal((await run({ HEALTHCHECK_HOST: '127.0.0.1', HEALTHCHECK_SERVERNAME: serverName })).code, 0);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
