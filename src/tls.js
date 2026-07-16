const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const { X509Certificate } = require('crypto');
const { ensureDir } = require('./fs-utils');

const DEFAULT_CA_DAYS = 3650;
const DEFAULT_CA_COMMON_NAME = 'alexa-cookie-service-local-ca';

function runOpenSsl(args) {
  try {
    execFileSync('openssl', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    const stdout = error?.stdout ? String(error.stdout).trim() : '';
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new Error(`openssl ${args.join(' ')} failed${details ? `: ${details}` : ''}`);
  }
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o600, encoding: 'utf8' });
}

function buildCaConfig(caCommonName) {
  return `
[req]
prompt = no
distinguished_name = req_distinguished_name
x509_extensions = v3_ca

[req_distinguished_name]
CN = ${caCommonName}

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;
}

function buildServerConfig(serverName) {
  const altNames = [];
  if (net.isIP(serverName) === 4) {
    altNames.push(`IP.1 = ${serverName}`);
    altNames.push('DNS.1 = localhost');
    altNames.push('IP.2 = 127.0.0.1');
  } else if (net.isIP(serverName) === 6) {
    altNames.push(`IP.1 = ${serverName}`);
    altNames.push('DNS.1 = localhost');
    altNames.push('IP.2 = 127.0.0.1');
  } else {
    altNames.push(`DNS.1 = ${serverName}`);
    altNames.push('DNS.2 = localhost');
    altNames.push('IP.1 = 127.0.0.1');
  }

  return `
[req]
prompt = no
distinguished_name = req_distinguished_name

[req_distinguished_name]
CN = ${serverName}

[v3_server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer

[alt_names]
${altNames.join('\n')}
`;
}

function writeTempConfig(prefix, content) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(tempDir, 'openssl.cnf');
  writeFile(filePath, content);
  return { tempDir, filePath };
}

function cleanupTempDir(tempDir) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
}

function ensureWritableDir(dirPath, { logger, label } = {}) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Unable to write to ${label || 'directory'} ${dirPath}: ${error.message}`);
    }
    return false;
  }
}

function ensureReadableFile(filePath, { logger, label } = {}) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Unable to read ${label || 'file'} ${filePath}: ${error.message}`);
    }
    return false;
  }
}

function parseExpiry(validTo) {
  const expiresAt = Date.parse(validTo);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function certificateMatchesServerName(cert, serverName) {
  if (!serverName) return true;
  const san = cert.subjectAltName || '';
  if (net.isIP(serverName) === 4 || net.isIP(serverName) === 6) {
    return san.includes(`IP Address:${serverName}`) || san.includes(`IP:${serverName}`);
  }
  return san.includes(`DNS:${serverName}`);
}

function shouldRenewServerCertificate(certPath, { serverName, renewBeforeDays = 30 } = {}) {
  if (!fs.existsSync(certPath)) return true;

  let cert;
  try {
    cert = new X509Certificate(fs.readFileSync(certPath));
  } catch {
    return true;
  }

  if (!certificateMatchesServerName(cert, serverName)) {
    return true;
  }

  const expiresAt = parseExpiry(cert.validTo);
  if (!expiresAt) return true;

  const remainingDays = (expiresAt - Date.now()) / 86400000;
  return remainingDays <= renewBeforeDays;
}

function ensureCaMaterial(tlsDir, { caCommonName = DEFAULT_CA_COMMON_NAME, caDays = DEFAULT_CA_DAYS, caKeyFile, caCertFile } = {}) {
  const caKeyPath = caKeyFile || path.join(tlsDir, 'ca.key');
  const caCertPath = caCertFile || path.join(tlsDir, 'ca.crt');
  if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
    return { caKeyPath, caCertPath };
  }

  const { tempDir, filePath: configPath } = writeTempConfig('acs-ca-', buildCaConfig(caCommonName));
  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096', '-out', caKeyPath]);
    runOpenSsl([
      'req',
      '-x509',
      '-new',
      '-nodes',
      '-key', caKeyPath,
      '-sha256',
      '-days', String(caDays),
      '-out', caCertPath,
      '-config', configPath,
      '-extensions', 'v3_ca'
    ]);
    fs.chmodSync(caKeyPath, 0o600);
    return { caKeyPath, caCertPath };
  } finally {
    cleanupTempDir(tempDir);
  }
}

function serverCertTrustedByCa(serverCertPath, caCertPath) {
  if (!fs.existsSync(serverCertPath) || !fs.existsSync(caCertPath)) return false;
  try {
    runOpenSsl(['verify', '-CAfile', caCertPath, serverCertPath]);
    return true;
  } catch {
    return false;
  }
}

function generateServerMaterial({ tlsDir, serverName, certDays, caKeyPath, caCertPath, serverKeyFile, serverCertFile }) {
  const serverKeyPath = serverKeyFile || path.join(tlsDir, 'server.key');
  const serverCsrPath = path.join(tlsDir, 'server.csr');
  const serverCertPath = serverCertFile || path.join(tlsDir, 'server.crt');
  const { tempDir, filePath: configPath } = writeTempConfig('acs-server-', buildServerConfig(serverName));

  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', serverKeyPath]);
    runOpenSsl([
      'req',
      '-new',
      '-key', serverKeyPath,
      '-out', serverCsrPath,
      '-config', configPath,
      '-subj', `/CN=${serverName}`
    ]);
    runOpenSsl([
      'x509',
      '-req',
      '-in', serverCsrPath,
      '-CA', caCertPath,
      '-CAkey', caKeyPath,
      '-CAcreateserial',
      '-out', serverCertPath,
      '-days', String(certDays),
      '-sha256',
      '-extfile', configPath,
      '-extensions', 'v3_server'
    ]);
    fs.chmodSync(serverKeyPath, 0o600);
    return { serverKeyPath, serverCertPath };
  } finally {
    try {
      fs.rmSync(serverCsrPath, { force: true });
    } catch {
      // Best effort cleanup.
    }
    cleanupTempDir(tempDir);
  }
}

function ensureServerMaterial(tlsDir, options) {
  const {
    serverName,
    certDays = 365,
    renewBeforeDays = 30,
    caKeyPath,
    caCertPath,
    serverKeyFile,
    serverCertFile
  } = options;

  const serverKeyPath = serverKeyFile || path.join(tlsDir, 'server.key');
  const serverCertPath = serverCertFile || path.join(tlsDir, 'server.crt');
  const needsRenewal =
    !fs.existsSync(serverKeyPath) ||
    !serverCertTrustedByCa(serverCertPath, caCertPath) ||
    shouldRenewServerCertificate(serverCertPath, { serverName, renewBeforeDays });

  if (needsRenewal) {
    generateServerMaterial({ tlsDir, serverName, certDays, caKeyPath, caCertPath, serverKeyFile, serverCertFile });
  }

  return { serverKeyPath, serverCertPath };
}

function ensureTlsMaterial(options = {}) {
  const {
    tlsDir,
    serverName,
    certDays = 365,
    renewBeforeDays = 30,
    caCommonName = DEFAULT_CA_COMMON_NAME,
    caDays = DEFAULT_CA_DAYS,
    caKeyFile,
    caCertFile,
    serverKeyFile,
    serverCertFile,
    serverCertMode = 'managed',
    logger
  } = options;

  if (!tlsDir) {
    throw new Error('TLS directory is required');
  }
  if (!serverName) {
    throw new Error('TLS server name is required');
  }

  const normalizedMode = String(serverCertMode || 'managed').toLowerCase();
  const serverKeyPath = serverKeyFile || path.join(tlsDir, 'server.key');
  const serverCertPath = serverCertFile || path.join(tlsDir, 'server.crt');

  if (normalizedMode === 'external') {
    if (!ensureReadableFile(serverKeyPath, { logger, label: 'TLS server key' })) {
      throw new Error(`TLS server key ${serverKeyPath} is not readable`);
    }
    if (!ensureReadableFile(serverCertPath, { logger, label: 'TLS server certificate' })) {
      throw new Error(`TLS server certificate ${serverCertPath} is not readable`);
    }

    const serverCert = new X509Certificate(fs.readFileSync(serverCertPath));
    if (!certificateMatchesServerName(serverCert, serverName)) {
      throw new Error(`TLS server certificate ${serverCertPath} does not match server name ${serverName}`);
    }

    return {
      key: fs.readFileSync(serverKeyPath),
      cert: fs.readFileSync(serverCertPath),
      ca: caCertFile && fs.existsSync(caCertFile) ? fs.readFileSync(caCertFile) : undefined,
      caKeyPath: caKeyFile || null,
      caCertPath: caCertFile || null,
      caKeyFile: caKeyFile || null,
      caCertFile: caCertFile || null,
      serverKeyPath,
      serverCertPath,
      serverKeyFile: serverKeyPath,
      serverCertFile: serverCertPath,
      tlsDir,
      serverName,
      serverCertMode: normalizedMode
    };
  }

  if (!ensureDir(tlsDir, { mkdirSync: fs.mkdirSync, logger, label: 'TLS directory' })) {
    throw new Error(`Unable to create TLS directory ${tlsDir}`);
  }
  if (!ensureWritableDir(tlsDir, { logger, label: 'TLS directory' })) {
    throw new Error(`TLS directory ${tlsDir} is not writable`);
  }

  for (const dirPath of new Set([
    path.dirname(caKeyFile || path.join(tlsDir, 'ca.key')),
    path.dirname(caCertFile || path.join(tlsDir, 'ca.crt')),
    path.dirname(serverKeyFile || path.join(tlsDir, 'server.key')),
    path.dirname(serverCertFile || path.join(tlsDir, 'server.crt'))
  ])) {
    if (!ensureDir(dirPath, { mkdirSync: fs.mkdirSync, logger, label: 'TLS file directory' })) {
      throw new Error(`Unable to create TLS file directory ${dirPath}`);
    }
    if (!ensureWritableDir(dirPath, { logger, label: 'TLS file directory' })) {
      throw new Error(`TLS file directory ${dirPath} is not writable`);
    }
  }

  const { caKeyPath, caCertPath } = ensureCaMaterial(tlsDir, { caCommonName, caDays, caKeyFile, caCertFile });
  const { serverKeyPath: managedServerKeyPath, serverCertPath: managedServerCertPath } = ensureServerMaterial(tlsDir, {
    serverName,
    certDays,
    renewBeforeDays,
    caKeyPath,
    caCertPath,
    serverKeyFile,
    serverCertFile
  });

  return {
    key: fs.readFileSync(managedServerKeyPath),
    cert: fs.readFileSync(managedServerCertPath),
    ca: fs.readFileSync(caCertPath),
    caKeyPath,
    caCertPath,
    caKeyFile: caKeyPath,
    caCertFile: caCertPath,
    serverKeyPath: managedServerKeyPath,
    serverCertPath: managedServerCertPath,
    serverKeyFile: managedServerKeyPath,
    serverCertFile: managedServerCertPath,
    tlsDir,
    serverName,
    serverCertMode: normalizedMode
  };
}

module.exports = {
  ensureTlsMaterial,
  shouldRenewServerCertificate,
  certificateMatchesServerName,
  parseExpiry
};
