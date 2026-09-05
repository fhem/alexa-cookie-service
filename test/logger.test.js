const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets } = require('../src/logger');

test('redacts sensitive JSON fields from alexa-cookie2 request logs', () => {
  const input = JSON.stringify({
    headers: {
      Cookie: 'session-id=secret; csrf=secret-csrf',
      authorization: 'Bearer access-secret'
    },
    body: 'source_token=refresh-secret&requested_token_type=auth_cookies',
    refreshToken: 'refresh-secret',
    localCookie: 'session-id=secret',
    access_token: 'underscore-access-secret',
    frc: 'frc-secret',
    'map-md': 'map-secret',
    macDms: 'mac-secret',
    cookieExchange: { Name: 'session-token', Value: 'cookie-array-secret' }
  });
  const output = redactSecrets(input);

  for (const secret of ['session-id=secret', 'secret-csrf', 'access-secret', 'refresh-secret', 'underscore-access-secret', 'frc-secret', 'map-secret', 'mac-secret', 'cookie-array-secret']) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /"Cookie":"<redacted>"/);
  assert.match(output, /source_token=<redacted>&requested_token_type=auth_cookies/);
});

test('redacts plain cookie and token log formats', () => {
  const input = [
    'Cookie session-token = cookie-secret',
    'Result: csrf=csrf-secret, Cookie=session-id=cookie-secret',
    'Authorization: Bearer access-secret'
  ].join('\n');
  const output = redactSecrets(input);

  assert.equal(output.includes('cookie-secret'), false);
  assert.equal(output.includes('csrf-secret'), false);
  assert.equal(output.includes('access-secret'), false);
});

test('keeps non-secret diagnostics visible', () => {
  const input = '{"hasCookie":true,"hasCsrf":true,"hasRefreshToken":true,"statusCode":200}';
  assert.equal(redactSecrets(input), input);
});
