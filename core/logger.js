/**
 * Structured logger with level filtering and colored output.
 * Keeps things simple — no external deps.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  reset: '\x1b[0m',
};

const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function log(level, tag, message, data) {
  if (LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const color = COLORS[level];
  const prefix = `${color}[${timestamp}] [${level.toUpperCase()}] [${tag}]${COLORS.reset}`;

  if (data !== undefined) {
    console.log(prefix, message, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(prefix, message);
  }
}

const logger = {
  debug: (tag, msg, data) => log('debug', tag, msg, data),
  info: (tag, msg, data) => log('info', tag, msg, data),
  warn: (tag, msg, data) => log('warn', tag, msg, data),
  error: (tag, msg, data) => log('error', tag, msg, data),
};

export default logger;
