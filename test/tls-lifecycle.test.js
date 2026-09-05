const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureTlsMaterial,
  shouldRenewServerCertificate
} = require('../src/tls');
const {
  fileHash,
  generateCertificateAuthority,
  generateServerCertificate,
  makeTempDir,
  readCertificateInfo
} = require('./helpers/tls-test-utils');

test('ensureTlsMaterial keeps the CA stable and reuses the server certificate while it remains valid', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-lifecycle-');
  const tlsDir = path.join(tmpDir, 'tls');
  const first = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.ok(fs.existsSync(first.caCertPath));
  assert.ok(fs.existsSync(first.serverCertPath));
  assert.match(readCertificateInfo(first.serverCertPath).subjectAltNames, /DNS:alexa-cookie-service/);
  assert.match(readCertificateInfo(first.serverCertPath).subjectAltNames, /DNS:localhost/);

  const firstCaHash = fileHash(first.caCertPath);
  const firstServerHash = fileHash(first.serverCertPath);
  const second = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.equal(fileHash(second.caCertPath), firstCaHash);
  assert.equal(fileHash(second.serverCertPath), firstServerHash);
});

test('shouldRenewServerCertificate returns true for certificates that are near expiry', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-renew-');
  const tlsDir = path.join(tmpDir, 'tls');
  const { caKey, caCert } = generateCertificateAuthority(tlsDir, {
    commonName: 'ACS Renewal Test CA'
  });
  const server = generateServerCertificate(tlsDir, {
    commonName: 'alexa-cookie-service',
    dnsNames: ['alexa-cookie-service', 'localhost'],
    days: '1',
    caKey,
    caCert
  });

  assert.equal(
    shouldRenewServerCertificate(server.serverCert, {
      serverName: 'alexa-cookie-service',
      renewBeforeDays: 30
    }),
    true
  );
});

test('ensureTlsMaterial replaces a stale server certificate while keeping the CA', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-replace-');
  const tlsDir = path.join(tmpDir, 'tls');
  fs.mkdirSync(tlsDir, { recursive: true });

  const { caKey, caCert } = generateCertificateAuthority(tlsDir, {
    commonName: 'ACS Replacement Test CA'
  });
  const stale = generateServerCertificate(tlsDir, {
    commonName: 'wrong.example.invalid',
    dnsNames: ['wrong.example.invalid'],
    days: '1',
    caKey,
    caCert
  });

  const staleServerHash = fileHash(stale.serverCert);
  const staleCaHash = fileHash(caCert);

  const renewed = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.equal(fileHash(renewed.caCertPath), staleCaHash);
  assert.notEqual(fileHash(renewed.serverCertPath), staleServerHash);
  assert.match(readCertificateInfo(renewed.serverCertPath).subjectAltNames, /DNS:alexa-cookie-service/);
  assert.doesNotMatch(readCertificateInfo(renewed.serverCertPath).subjectAltNames, /wrong\.example\.invalid/);
});


test('ensureTlsMaterial replaces the server certificate when the CA changes', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-ca-change-');
  const tlsDir = path.join(tmpDir, 'tls');
  fs.mkdirSync(tlsDir, { recursive: true });

  const initial = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  const replacementCaDir = path.join(tmpDir, 'replacement-ca');
  const replacementCa = generateCertificateAuthority(replacementCaDir, {
    commonName: 'ACS Replacement CA'
  });

  fs.copyFileSync(replacementCa.caKey, initial.caKeyPath);
  fs.copyFileSync(replacementCa.caCert, initial.caCertPath);

  const beforeServerHash = fileHash(initial.serverCertPath);
  const renewed = ensureTlsMaterial({
    tlsDir,
    serverName: 'alexa-cookie-service',
    certDays: 365,
    renewBeforeDays: 30,
    logger: { warn() {} }
  });

  assert.notEqual(fileHash(renewed.serverCertPath), beforeServerHash);
  assert.match(readCertificateInfo(renewed.serverCertPath).issuer, /ACS Replacement CA/);
  assert.match(readCertificateInfo(renewed.serverCertPath).subjectAltNames, /DNS:alexa-cookie-service/);
});

test('ensureTlsMaterial repairs a mismatched managed server key and certificate', () => {
  const tmpDir = makeTempDir('alexa-cookie-service-tls-pair-repair-');
  const tlsDir = path.join(tmpDir, 'tls');
  const initial = ensureTlsMaterial({ tlsDir, serverName: 'alexa-cookie-service' });
  const initialCaHash = fileHash(initial.caCertPath);
  const initialCertHash = fileHash(initial.serverCertPath);
  const foreign = generateServerCertificate(path.join(tmpDir, 'foreign'), {
    commonName: 'alexa-cookie-service',
    dnsNames: ['alexa-cookie-service', 'localhost'],
    caKey: initial.caKeyPath,
    caCert: initial.caCertPath
  });
  const foreignKeyHash = fileHash(foreign.serverKey);
  fs.copyFileSync(foreign.serverKey, initial.serverKeyPath);

  const repaired = ensureTlsMaterial({ tlsDir, serverName: 'alexa-cookie-service' });
  assert.equal(fileHash(repaired.caCertPath), initialCaHash);
  assert.notEqual(fileHash(repaired.serverKeyPath), foreignKeyHash);
  assert.notEqual(fileHash(repaired.serverCertPath), initialCertHash);

  const stable = ensureTlsMaterial({ tlsDir, serverName: 'alexa-cookie-service' });
  assert.equal(fileHash(stable.serverKeyPath), fileHash(repaired.serverKeyPath));
  assert.equal(fileHash(stable.serverCertPath), fileHash(repaired.serverCertPath));
});
