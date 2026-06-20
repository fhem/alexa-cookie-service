const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureDir } = require('../src/fs-utils');

test('ensureDir returns success when mkdirSync works', () => {
  const calls = [];
  const ok = ensureDir('/tmp/alexa-cookie-service-test-success', {
    mkdirSync: (dirPath, options) => {
      calls.push({ dirPath, options });
    },
    logger: { warn() { throw new Error('warn should not be called'); } },
    label: 'test directory'
  });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dirPath, '/tmp/alexa-cookie-service-test-success');
  assert.equal(calls[0].options.recursive, true);
});

test('ensureDir tolerates EACCES and logs a warning', () => {
  let warned = '';
  const ok = ensureDir('/opt/fhem/cache/alexa-cookie', {
    mkdirSync: () => {
      const error = new Error("EACCES: permission denied, mkdir '/opt/fhem/cache/alexa-cookie/'");
      error.code = 'EACCES';
      throw error;
    },
    logger: { warn(message) { warned = message; } },
    label: 'cookie export directory'
  });

  assert.equal(ok, false);
  assert.match(warned, /Unable to create cookie export directory \/opt\/fhem\/cache\/alexa-cookie/);
});
