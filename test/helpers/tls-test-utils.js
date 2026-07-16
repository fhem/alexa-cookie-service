const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cloneEnv(overrides = {}) {
  return { ...process.env, ...overrides };
}

function withEnv(overrides, fn) {
  const original = {};
  const keys = new Set([...Object.keys(overrides), ...Object.keys(process.env)]);

  for (const key of keys) {
    original[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function freshRequire(modulePath, envOverrides = {}) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return withEnv(envOverrides, () => require(modulePath));
}

function runOpenSsl(args, cwd) {
  execFileSync('openssl', args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

function writeOpenSslConfig(configPath, { commonName, dnsNames = [], ipAddresses = [] }) {
  const altNames = [];
  for (const dnsName of dnsNames) {
    altNames.push(`DNS.${altNames.length + 1} = ${dnsName}`);
  }
  for (const ipAddress of ipAddresses) {
    altNames.push(`IP.${altNames.length + 1} = ${ipAddress}`);
  }

  const config = [
    '[ req ]',
    'default_bits = 2048',
    'prompt = no',
    'default_md = sha256',
    'distinguished_name = dn',
    'x509_extensions = v3_req',
    '',
    '[ dn ]',
    `CN = ${commonName}`,
    '',
    '[ v3_req ]',
    'basicConstraints = critical,CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    `subjectAltName = @alt_names`,
    '',
    '[ alt_names ]',
    ...altNames
  ].join('\n');

  fs.writeFileSync(configPath, `${config}\n`);
}

function writeOpenSslCaConfig(configPath, { commonName }) {
  const config = [
    '[ req ]',
    'default_bits = 2048',
    'prompt = no',
    'default_md = sha256',
    'distinguished_name = dn',
    'x509_extensions = v3_ca',
    '',
    '[ dn ]',
    `CN = ${commonName}`,
    '',
    '[ v3_ca ]',
    'basicConstraints = critical,CA:TRUE',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid:always,issuer'
  ].join('\n');

  fs.writeFileSync(configPath, `${config}\n`);
}

function generateCertificateAuthority(dir, { commonName = 'ACS Test CA' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const caKey = path.join(dir, 'ca.key');
  const caCert = path.join(dir, 'ca.crt');
  const caConfig = path.join(dir, 'ca-openssl.cnf');

  writeOpenSslCaConfig(caConfig, { commonName });
  runOpenSsl(['genrsa', '-out', caKey, '2048'], dir);
  runOpenSsl([
    'req',
    '-x509',
    '-new',
    '-nodes',
    '-key',
    caKey,
    '-days',
    '3650',
    '-out',
    caCert,
    '-config',
    caConfig
  ], dir);

  return { caKey, caCert };
}

function generateServerCertificate(dir, {
  commonName = 'wrong.example.invalid',
  dnsNames = [commonName],
  ipAddresses = [],
  days = '1',
  caKey,
  caCert
} = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const serverKey = path.join(dir, 'server.key');
  const serverCsr = path.join(dir, 'server.csr');
  const serverCert = path.join(dir, 'server.crt');
  const serverConfig = path.join(dir, 'server-openssl.cnf');

  writeOpenSslConfig(serverConfig, { commonName, dnsNames, ipAddresses });
  runOpenSsl(['genrsa', '-out', serverKey, '2048'], dir);
  runOpenSsl([
    'req',
    '-new',
    '-key',
    serverKey,
    '-out',
    serverCsr,
    '-config',
    serverConfig
  ], dir);
  runOpenSsl([
    'x509',
    '-req',
    '-in',
    serverCsr,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-out',
    serverCert,
    '-days',
    String(days),
    '-extfile',
    serverConfig,
    '-extensions',
    'v3_req'
  ], dir);

  return { serverKey, serverCert, serverCsr };
}

function readCertificateInfo(certPath) {
  const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
    fingerprint256: cert.fingerprint256,
    subjectAltNames: cert.subjectAltName || ''
  };
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

module.exports = {
  cloneEnv,
  fileHash,
  freshRequire,
  generateCertificateAuthority,
  generateServerCertificate,
  makeTempDir,
  readCertificateInfo,
  runOpenSsl,
  withEnv
};
