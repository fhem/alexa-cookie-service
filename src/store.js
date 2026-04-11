const fs = require('fs');
const path = require('path');

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(filePath, value, options = {}) {
  const { compact = false } = options;
  ensureDirForFile(filePath);
  const indent = compact ? undefined : 2;
  fs.writeFileSync(filePath, JSON.stringify(value, null, indent), 'utf8');
}

function writeText(filePath, value) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, value, 'utf8');
}

module.exports = {
  readJson,
  writeJson,
  writeText,
  ensureDirForFile
};
