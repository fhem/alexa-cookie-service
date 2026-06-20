const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function request(method, url, headers = {}, body = undefined) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers
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
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

test('api/status accepts POST as well as GET', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-service-'));
  const env = {
    ...process.env,
    PORT: '58123',
    HOST: '127.0.0.1',
    AUTH_TOKEN: 'test-token',
    DATA_DIR: path.join(tmpDir, 'data'),
    STATE_FILE: path.join(tmpDir, 'data', 'state.json'),
    METADATA_FILE: path.join(tmpDir, 'data', 'metadata.json'),
    COOKIE_EXPORT_DIR: path.join(tmpDir, 'exports'),
    DEBUG_HTML_DIR: path.join(tmpDir, 'debug')
  };

  fs.mkdirSync(env.DATA_DIR, { recursive: true });

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start in time')), 10000);
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

    const getResponse = await request('GET', 'http://127.0.0.1:58123/api/status', {
      'x-auth-token': 'test-token'
    });
    assert.equal(getResponse.statusCode, 200);
    assert.match(getResponse.body, /"ok":/);

    const postResponse = await request('POST', 'http://127.0.0.1:58123/api/status', {
      'x-auth-token': 'test-token',
      'Content-Type': 'application/json'
    }, '{}');
    assert.equal(postResponse.statusCode, 200);
    assert.match(postResponse.body, /"ok":/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
