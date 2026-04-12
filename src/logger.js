const config = require('./config');

let timestampFormatter;

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

function write(level, args) {
  const line = `[${formatTimestamp()} ${config.timeZone}] [${level}] ${args
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')}`;
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
  formatTimestamp
};
