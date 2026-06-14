const http = require('http');

const port = process.env.PORT || 58080;
const host = process.env.HOST || '127.0.0.1';

const req = http.request(
  {
    host,
    port,
    path: '/healthz',
    method: 'GET',
    timeout: 5000
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
