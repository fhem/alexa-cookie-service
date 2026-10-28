#!/usr/bin/env node
'use strict';

// Workaround for https://github.com/Apollon77/alexa-cookie/issues/222
//
// Amazon sends `Content-Security-Policy: upgrade-insecure-requests`, which alexa-cookie2's
// plain-HTTP login proxy forwards unchanged. The browser then upgrades the email form POST
// to https://<proxy>/ax/claim and fails with ERR_SSL_PROTOCOL_ERROR. This script makes the
// proxy drop only that directive. It is applied from the npm `postinstall` hook and can be
// removed once alexa-cookie2 handles the header itself.

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'alexa-cookie-service: strip upgrade-insecure-requests';
const ANCHOR = 'function onProxyRes(proxyRes, req, res) {\n';
const PATCH = `        // ${MARKER}
        if (typeof proxyRes.headers['content-security-policy'] === 'string') {
            proxyRes.headers['content-security-policy'] = proxyRes.headers['content-security-policy']
                .split(',')
                .map((policy) => policy.split(';').filter((directive) => !/^\\s*upgrade-insecure-requests\\s*$/i.test(directive)).join(';'))
                .filter((policy) => policy.trim() !== '')
                .join(',');
            if (proxyRes.headers['content-security-policy'] === '') delete proxyRes.headers['content-security-policy'];
        }
`;

function patchProxySource(source) {
  if (source.includes(MARKER)) return { status: 'already-patched', source };
  if (!source.includes(ANCHOR)) return { status: 'anchor-missing', source };
  return { status: 'patched', source: source.replace(ANCHOR, ANCHOR + PATCH) };
}

function proxyFile() {
  return path.join(path.dirname(require.resolve('alexa-cookie2/package.json')), 'lib', 'proxy.js');
}

function applyPatch(file = proxyFile()) {
  const { status, source } = patchProxySource(fs.readFileSync(file, 'utf8'));
  if (status === 'patched') fs.writeFileSync(file, source);
  return status;
}

if (require.main === module) {
  let status;
  try {
    status = applyPatch();
  } catch (error) {
    console.warn(`patch-alexa-cookie2: skipped (${error.message})`);
    process.exit(0);
  }
  if (status === 'anchor-missing') {
    console.warn('patch-alexa-cookie2: onProxyRes not found, alexa-cookie2 changed; check whether the patch is still needed');
  } else {
    console.log(`patch-alexa-cookie2: ${status}`);
  }
}

module.exports = { MARKER, applyPatch, patchProxySource };
