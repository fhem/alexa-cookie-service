const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

test('healthcheck uses the configured TLS CA path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-healthcheck-'));
  const tlsDir = path.join(tmpDir, 'tls');
  const dataDir = path.join(tmpDir, 'data');
  const externalCaPath = path.join(tmpDir, 'external-ca.crt');
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: '58152',
    HOST: '127.0.0.1',
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
        HOST: '127.0.0.1',
        TLS_ENABLED: 'true',
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
