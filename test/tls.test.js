const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const { certificateMatchesServerName, ensureTlsMaterial, shouldRenewServerCertificate } = require('../src/tls');
const { generateCertificateAuthority, generateServerCertificate, makeTempDir } = require('./helpers/tls-test-utils');

function request(url, caPath) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        ca: fs.readFileSync(caPath)
      },
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

test('ensureTlsMaterial creates a local CA and server certificate with SANs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-tls-'));
  const material = ensureTlsMaterial({
    tlsDir: path.join(tmpDir, 'tls'),
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.ok(fs.existsSync(material.caCertPath));
  assert.ok(fs.existsSync(material.serverCertPath));
  assert.ok(fs.existsSync(material.serverKeyPath));
  assert.match(new X509Certificate(fs.readFileSync(material.serverCertPath)).subjectAltName, /DNS:alexa-cookie-service/);
  assert.match(new X509Certificate(fs.readFileSync(material.serverCertPath)).subjectAltName, /DNS:localhost/);
});

test('TLS-enabled server answers healthz over HTTPS with externally provided leaf material', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-service-external-'));
  const tlsDir = path.join(tmpDir, 'tls');
  const caDir = path.join(tmpDir, 'ca');
  const serverDir = path.join(tmpDir, 'server');
  const dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const { caKey, caCert } = generateCertificateAuthority(caDir, {
    commonName: 'ACS External Server CA'
  });
  const { serverKey, serverCert } = generateServerCertificate(serverDir, {
    commonName: 'alexa-cookie-service',
    dnsNames: ['alexa-cookie-service', 'localhost'],
    ipAddresses: ['127.0.0.1'],
    caKey,
    caCert
  });

  const env = {
    ...process.env,
    PORT: '58125',
    HOST: '127.0.0.1',
    AUTH_TOKEN: 'test-token',
    TLS_ENABLED: 'true',
    TLS_DIR: tlsDir,
    TLS_SERVER_CERT_MODE: 'external',
    TLS_SERVER_NAME: 'alexa-cookie-service',
    TLS_SERVER_KEY_FILE: serverKey,
    TLS_SERVER_CERT_FILE: serverCert,
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

  const ready = new Promise((resolve, reject) => {
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
      reject(new Error(`server exited early with code ${code}`));
    });
  });

  try {
    await ready;
    const response = await request('https://127.0.0.1:58125/healthz', caCert);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"ok":/);
    assert.equal(fs.existsSync(path.join(tlsDir, 'ca.crt')), false);
    assert.equal(fs.existsSync(path.join(tlsDir, 'server.key')), false);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('ensureTlsMaterial rejects an external server certificate that does not match the server name', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-external-mismatch-');
  const tlsDir = path.join(tmpDir, 'tls');
  const caDir = path.join(tmpDir, 'ca');
  const serverDir = path.join(tmpDir, 'server');
  const { caKey, caCert } = generateCertificateAuthority(caDir, {
    commonName: 'ACS External Leaf CA'
  });
  const { serverKey, serverCert } = generateServerCertificate(serverDir, {
    commonName: 'wrong.example.invalid',
    dnsNames: ['wrong.example.invalid'],
    ipAddresses: ['127.0.0.1'],
    caKey,
    caCert
  });

  assert.throws(() => ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    serverCertMode: 'external',
    serverKeyFile: serverKey,
    serverCertFile: serverCert,
    logger: { warn() {} }
  }), /does not match server name/);
});

test('ensureTlsMaterial fails fast when the TLS directory is not writable', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-tls-'));
  const tlsDir = path.join(tmpDir, 'tls');
  const originalAccessSync = fs.accessSync;

  fs.accessSync = (dirPath, mode) => {
    if (dirPath === tlsDir) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return originalAccessSync.call(fs, dirPath, mode);
  };

  try {
    assert.throws(
      () => ensureTlsMaterial({
        tlsDir,
        serverName: 'alexa-cookie-service',
        certDays: 365,
        renewBeforeDays: 30,
        logger: { warn() {} }
      }),
      /TLS directory .* is not writable/
    );
  } finally {
    fs.accessSync = originalAccessSync;
  }
});

test('shouldRenewServerCertificate returns true when SAN does not match the target name', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-tls-'));
  const material = ensureTlsMaterial({
    tlsDir: path.join(tmpDir, 'tls'),
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.equal(
    shouldRenewServerCertificate(material.serverCertPath, {
      serverName: 'other-service',
      renewBeforeDays: 30
    }),
    true
  );
});

test('certificateMatchesServerName uses exact X.509 DNS and IP SAN matching', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-san-match-');
  const caDir = path.join(tmpDir, 'ca');
  const serverDir = path.join(tmpDir, 'server');
  const { caKey, caCert } = generateCertificateAuthority(caDir);
  const { serverCert } = generateServerCertificate(serverDir, {
    commonName: 'acs.example.internal.evil',
    dnsNames: ['acs.example.internal.evil', 'exact.example.internal'],
    ipAddresses: ['127.0.0.1', '::1'],
    caKey,
    caCert
  });
  const cert = new X509Certificate(fs.readFileSync(serverCert));

  assert.equal(certificateMatchesServerName(cert, 'acs.example.internal'), false);
  assert.equal(certificateMatchesServerName(cert, 'acs.example.internal.evil'), true);
  assert.equal(certificateMatchesServerName(cert, 'exact.example.internal'), true);
  assert.equal(certificateMatchesServerName(cert, '127.0.0.1'), true);
  assert.equal(certificateMatchesServerName(cert, '127.0.0.2'), false);
  assert.equal(certificateMatchesServerName(cert, '::1'), true);
  assert.equal(certificateMatchesServerName(cert, '::2'), false);
});

test('ensureTlsMaterial rejects an unknown server certificate mode before creating files', () => {
  const tlsDir = path.join(os.tmpdir(), 'alexa-cookie-service-invalid-mode-' + process.pid + '-' + Date.now());

  assert.throws(
    () => ensureTlsMaterial({
      tlsDir,
      serverName: 'alexa-cookie-service',
      serverCertMode: 'externl'
    }),
    /Invalid TLS_SERVER_CERT_MODE externl: expected managed or external/
  );
  assert.equal(fs.existsSync(tlsDir), false);
});

test('ensureTlsMaterial rejects a mismatched external server key and certificate', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-external-pair-');
  const ca = generateCertificateAuthority(path.join(tmpDir, 'ca'));
  const first = generateServerCertificate(path.join(tmpDir, 'first'), {
    commonName: 'alexa-cookie-service', dnsNames: ['alexa-cookie-service'],
    caKey: ca.caKey, caCert: ca.caCert
  });
  const second = generateServerCertificate(path.join(tmpDir, 'second'), {
    commonName: 'alexa-cookie-service', dnsNames: ['alexa-cookie-service'],
    caKey: ca.caKey, caCert: ca.caCert
  });

  assert.throws(() => ensureTlsMaterial({
    tlsDir: tmpDir,
    serverName: 'alexa-cookie-service',
    serverCertMode: 'external',
    serverKeyFile: first.serverKey,
    serverCertFile: second.serverCert
  }), /TLS server key .* does not match certificate/);
});

test('ensureTlsMaterial accepts externally provided server key and certificate', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-external-');
  const tlsDir = path.join(tmpDir, 'tls');
  const caDir = path.join(tmpDir, 'ca');
  const serverDir = path.join(tmpDir, 'server');
  const { caKey, caCert } = generateCertificateAuthority(caDir, {
    commonName: 'ACS External Leaf CA'
  });
  const { serverKey, serverCert } = generateServerCertificate(serverDir, {
    commonName: 'alexa-cookie-service',
    dnsNames: ['alexa-cookie-service', 'localhost'],
    days: '365',
    caKey,
    caCert
  });

  const material = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    serverCertMode: 'external',
    serverKeyFile: serverKey,
    serverCertFile: serverCert,
    logger: { warn() {} }
  });

  assert.equal(fs.existsSync(path.join(tlsDir, 'ca.key')), false);
  assert.equal(fs.existsSync(path.join(tlsDir, 'ca.crt')), false);
  assert.equal(fs.existsSync(path.join(tlsDir, 'server.key')), false);
  assert.equal(fs.existsSync(path.join(tlsDir, 'server.crt')), false);
  assert.equal(fs.existsSync(material.serverKeyPath), true);
  assert.equal(fs.existsSync(material.serverCertPath), true);
  assert.equal(fs.readFileSync(material.serverKeyPath, 'utf8'), fs.readFileSync(serverKey, 'utf8'));
  assert.equal(fs.readFileSync(material.serverCertPath, 'utf8'), fs.readFileSync(serverCert, 'utf8'));
  assert.equal(material.ca, undefined);
});

test('TLS-enabled server answers healthz over HTTPS', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-service-'));
  const tlsDir = path.join(tmpDir, 'tls');
  const dataDir = path.join(tmpDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: '58124',
    HOST: '127.0.0.1',
    AUTH_TOKEN: 'test-token',
    TLS_ENABLED: 'true',
    TLS_DIR: tlsDir,
    TLS_SERVER_NAME: 'alexa-cookie-service',
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

  const ready = new Promise((resolve, reject) => {
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
      reject(new Error(`server exited early with code ${code}`));
    });
  });

  try {
    await ready;
    const response = await request('https://127.0.0.1:58124/healthz', path.join(tlsDir, 'ca.crt'));
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"ok":/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
