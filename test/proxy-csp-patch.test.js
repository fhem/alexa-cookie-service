const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MARKER, patchProxySource } = require('../scripts/patch-alexa-cookie2');

const SAMPLE = 'function onProxyRes(proxyRes, req, res) {\n    return req.url;\n}\n';

function runPatched(csp) {
  const { source } = patchProxySource(SAMPLE);
  const onProxyRes = new Function(`${source}; return onProxyRes;`)();
  const proxyRes = { headers: csp === undefined ? {} : { 'content-security-policy': csp } };
  onProxyRes(proxyRes, { url: '/' }, {});
  return proxyRes.headers['content-security-policy'];
}

test('removes only upgrade-insecure-requests from the CSP', () => {
  assert.equal(
    runPatched('upgrade-insecure-requests;report-uri https://metrics.media-amazon.com/'),
    'report-uri https://metrics.media-amazon.com/'
  );
  assert.equal(runPatched("default-src 'self'; upgrade-insecure-requests"), "default-src 'self'");
  assert.equal(runPatched("frame-ancestors 'none';"), "frame-ancestors 'none';");
});

test('drops the header when it only contained the upgrade directive', () => {
  assert.equal(runPatched('upgrade-insecure-requests'), undefined);
});

test('handles several joined policies and a missing header', () => {
  assert.equal(runPatched("frame-ancestors 'none', upgrade-insecure-requests"), "frame-ancestors 'none'");
  assert.equal(runPatched(undefined), undefined);
});

test('patching is idempotent and reports a changed upstream', () => {
  const once = patchProxySource(SAMPLE);
  assert.equal(once.status, 'patched');
  assert.equal(patchProxySource(once.source).status, 'already-patched');
  assert.equal(patchProxySource('nothing here').status, 'anchor-missing');
});

test('installed alexa-cookie2 is patched or handles the directive itself', () => {
  const file = path.join(path.dirname(require.resolve('alexa-cookie2/package.json')), 'lib', 'proxy.js');
  const source = fs.readFileSync(file, 'utf8');
  // Read-only: fails if the postinstall patch did not apply and the anchor drifted upstream.
  assert.ok(
    source.includes(MARKER) || patchProxySource(source).status !== 'anchor-missing',
    'alexa-cookie2 proxy.js changed: onProxyRes anchor not found, review scripts/patch-alexa-cookie2.js'
  );
});
