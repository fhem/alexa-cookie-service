const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const tlsEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.TLS_ENABLED || '').toLowerCase());
const tlsDir = process.env.TLS_DIR || path.join(process.env.DATA_DIR || '/data', 'tls');
const tlsCaCertFile = process.env.TLS_CA_CERT_FILE || path.join(tlsDir, 'ca.crt');
const port = process.env.PORT || 58080;
const host = process.env.HOST || '127.0.0.1';
const agentOptions = tlsEnabled
  ? {
      ca: fs.readFileSync(tlsCaCertFile)
    }
  : {};
const client = tlsEnabled ? https : http;

const req = client.request(
  {
    host,
    port,
    path: '/healthz',
    method: 'GET',
    timeout: 5000,
    ...agentOptions
  },
  (res) => {
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      process.exit(0);
    }
    process.exit(1);
  }
);

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.end();
