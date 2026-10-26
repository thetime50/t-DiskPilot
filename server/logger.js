'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function logFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `ops-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`;
}

function append(level, message, meta) {
  ensureLogDir();
  const line = {
    time: stamp(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const text = JSON.stringify(line) + '\n';
  fs.appendFileSync(path.join(LOG_DIR, logFileName()), text, 'utf8');
  return line;
}

module.exports = {
  info: (msg, meta) => append('info', msg, meta),
  warn: (msg, meta) => append('warn', msg, meta),
  error: (msg, meta) => append('error', msg, meta),
  LOG_DIR,
};
