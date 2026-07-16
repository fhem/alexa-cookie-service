const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

function dockerAvailable() {
  const result = spawnSync('docker', ['info'], {
    stdio: 'ignore'
  });
  return result.status === 0;
}

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function requestHealthz(port, caPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/healthz',
        method: 'GET',
        ca: fs.readFileSync(caPath),
        timeout: 5000
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
    req.on('timeout', () => {
      req.destroy(new Error('healthz request timed out'));
    });
    req.end();
  });
}

async function waitForHealthy(port, caPath, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (!fs.existsSync(caPath)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    try {
      const response = await requestHealthz(port, caPath);
      if (response.statusCode === 200) {
        return response;
      }
      lastError = new Error(`unexpected status ${response.statusCode}: ${response.body}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError || new Error('container did not become healthy in time');
}

const dockerTest = dockerAvailable() ? test : test.skip;

dockerTest('docker image starts and serves healthz over HTTPS', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-cookie-container-'));
  const dataDir = path.join(tmpDir, 'data');
  const imageTag = `alexa-cookie-service:test-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const containerName = `alexa-cookie-service-${process.pid}-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });

  let containerId = '';
  let publishedPort = '';

  try {
    docker(['build', '-t', imageTag, '.'], {
      cwd: process.cwd()
    });

    containerId = docker([
      'run',
      '--detach',
      '--name',
      containerName,
      '--publish',
      '127.0.0.1::58080',
      '--mount',
      `type=bind,src=${dataDir},dst=/data`,
      '-e',
      'HOST=0.0.0.0',
      '-e',
      'PORT=58080',
      '-e',
      'AUTH_TOKEN=test-token',
      '-e',
      'TLS_ENABLED=true',
      '-e',
      'DATA_DIR=/data',
      '-e',
      'STATE_FILE=/data/alexa-registration.json',
      '-e',
      'METADATA_FILE=/data/service-metadata.json',
      '-e',
      'COOKIE_EXPORT_DIR=/data/cookie-export',
      '-e',
      'DEBUG_HTML_DIR=/data/debug-html',
      imageTag
    ], {
      cwd: process.cwd()
    });

    const portMapping = docker(['port', containerId, '58080/tcp'], {
      cwd: process.cwd()
    });
    const match = portMapping.match(/127\.0\.0\.1:(\d+)/);
    assert.ok(match, `unexpected docker port output: ${portMapping}`);
    publishedPort = match[1];

    const caPath = path.join(dataDir, 'tls', 'ca.crt');
    const response = await waitForHealthy(Number(publishedPort), caPath);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /"ok":/);
    assert.ok(fs.existsSync(path.join(dataDir, 'tls', 'ca.crt')));
    assert.ok(fs.existsSync(path.join(dataDir, 'tls', 'server.crt')));
    assert.ok(fs.existsSync(path.join(dataDir, 'tls', 'server.key')));
  } finally {
    if (containerId) {
      try {
        docker(['rm', '-f', containerId], {
          cwd: process.cwd()
        });
      } catch {
        // Best effort cleanup.
      }
    }
    try {
      docker(['rmi', '-f', imageTag], {
        cwd: process.cwd()
      });
    } catch {
      // Best effort cleanup.
    }
  }
});
