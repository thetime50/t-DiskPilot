'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const DEFAULT_QUARANTINE_D = 'D:\\t-DiskPilot-quarantine';
const FALLBACK_QUARANTINE = path.join(HOME, 't-DiskPilot-quarantine');

function resolveQuarantineRoot() {
  try {
    if (fs.existsSync('D:\\') || tryTouch('D:\\')) {
      return DEFAULT_QUARANTINE_D;
    }
  } catch (_) {
    /* fall through */
  }
  return FALLBACK_QUARANTINE;
}

function tryTouch(driveRoot) {
  try {
    const probe = path.join(driveRoot, '.t-diskpilot-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  HOME,
  PORT: Number(process.env.PORT) || 3789,
  quarantineRoot: resolveQuarantineRoot(),
  // Low-risk categories: may delete directly after confirm (no quarantine required)
  LOW_RISK_CATEGORIES: new Set([
    'temp',
    'pip-cache',
    'npm-cache',
    'yarn-cache',
    'pnpm-cache',
    'crash-dumps',
    'temp-logs',
    'browser-cache',
    'thumbnails',
    'docker-cache',
  ]),
};
