function ensureDir(dirPath, { mkdirSync, logger, label } = {}) {
  if (typeof mkdirSync !== 'function') {
    throw new TypeError('mkdirSync must be a function');
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Unable to create ${label || 'directory'} ${dirPath}: ${error.message}`);
    }
    return false;
  }
}

module.exports = {
  ensureDir
};
