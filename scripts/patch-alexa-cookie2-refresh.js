const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'alexa-cookie2', 'alexa-cookie.js');

const anchor = '        loginData.deviceSerial = deviceSerial;\n';
const patch = anchor + [
  '        if (loginData.accessToken) {',
  '            return callback(null, loginData);',
  '        }',
  ''
].join('\n');

if (!fs.existsSync(target)) {
  console.warn(`alexa-cookie2 patch skipped, file not found: ${target}`);
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');

if (source.includes('return callback(null, loginData);')) {
  console.log('alexa-cookie2 refresh workaround already applied');
  process.exit(0);
}

if (!source.includes(anchor)) {
  console.warn('alexa-cookie2 patch skipped, expected anchor was not found');
  process.exit(0);
}

fs.writeFileSync(target, source.replace(anchor, patch));
console.log('alexa-cookie2 refresh workaround applied');
