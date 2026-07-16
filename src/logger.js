const config = require('./config');

let timestampFormatter;

const JSON_SECRET_KEYS = [
  'accessToken',
  'access_token',
  'authorization',
  'cookie',
  'deviceId',
  'deviceSerial',
  'frc',
  'csrf',
  'localCookie',
  'macDms',
  'map-md',
  'loginCookie',
  'refreshToken',
  'refresh_token',
  'secureSessionToken',
  'source_token',
  'token',
  'Value'
].join('|');

function getTimestampFormatter() {
  if (!timestampFormatter) {
    timestampFormatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false
    });
  }
  return timestampFormatter;
}

function formatTimestamp(date = new Date()) {
  return getTimestampFormatter().format(date).replace(' ', 'T');
}

function redactSecrets(value) {
  return String(value)
    .replace(
      new RegExp(`("(?:${JSON_SECRET_KEYS})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'),
      '$1"<redacted>"'
    )
    .replace(/((?:source_token|refresh_token|access_token|csrf|token)=)[^&\s"]+/gi, '$1<redacted>')
    .replace(/(authorization:\s*(?:Bearer\s+)?)[^\s,}"]+/gi, '$1<redacted>')
    .replace(/(Cookie:\s*)[^\r\n]+/gi, '$1<redacted>')
    .replace(/(Cookie\s+[^=\s]+\s*=\s*)[^\r\n]+/gi, '$1<redacted>')
    .replace(/(csrf=)[^,;\s]+/gi, '$1<redacted>')
    .replace(/(Cookie=)[^\r\n]+/gi, '$1<redacted>');
}

function serialize(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level, args) {
  const message = redactSecrets(args.map(serialize).join(' '));
  const line = `[${formatTimestamp()} ${config.timeZone}] [${level}] ${message}`;
  process.stdout.write(`${line}\n`);
}

function info(...args) {
  write('INFO', args);
}

function warn(...args) {
  write('WARN', args);
}

function error(...args) {
  write('ERROR', args);
}

const httpStream = {
  write(message) {
    const line = String(message).trimEnd();
    if (!line) return;
    info(line);
  }
};

module.exports = {
  info,
  warn,
  error,
  httpStream,
  formatTimestamp,
  redactSecrets
};
