'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

function ensureRoot() {
  const root = config.quarantineRoot;
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
    logger.info('quarantine root created', { root });
  }
  return root;
}

function safeName(p) {
  return String(p)
    .replace(/[:\\/]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 180);
}

/** Move path into quarantine; returns destination. */
function moveToQuarantine(srcPath) {
  const root = ensureRoot();
  if (!fs.existsSync(srcPath)) {
    throw new Error(`源路径不存在: ${srcPath}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(root, `${stamp}__${safeName(srcPath)}`);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.renameSync(srcPath, destDir);
  const meta = {
    src: srcPath,
    dest: destDir,
    movedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(path.dirname(destDir), `${path.basename(destDir)}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  logger.info('quarantined', meta);
  return meta;
}

function listQuarantine() {
  const root = ensureRoot();
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = path.join(root, e.name);
      const metaPath = path.join(root, `${e.name}.meta.json`);
      let meta = null;
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (_) {
          /* ignore */
        }
      }
      return { name: e.name, path: full, meta };
    });
}

function permanentDeleteQuarantineItem(name) {
  const root = ensureRoot();
  const full = path.join(root, name);
  if (!full.startsWith(root)) throw new Error('非法路径');
  if (!fs.existsSync(full)) throw new Error('隔离项不存在');
  fs.rmSync(full, { recursive: true, force: true });
  const metaPath = path.join(root, `${name}.meta.json`);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  logger.info('quarantine permanent delete', { name, full });
  return { ok: true, name };
}

function restoreQuarantineItem(name) {
  const root = ensureRoot();
  const full = path.join(root, name);
  const metaPath = path.join(root, `${name}.meta.json`);
  if (!fs.existsSync(full)) throw new Error('隔离项不存在');
  let meta = null;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }
  if (!meta || !meta.src) throw new Error('缺少 meta，无法还原');
  if (fs.existsSync(meta.src)) throw new Error(`还原目标已存在: ${meta.src}`);
  fs.mkdirSync(path.dirname(meta.src), { recursive: true });
  fs.renameSync(full, meta.src);
  fs.unlinkSync(metaPath);
  logger.info('quarantine restored', { name, src: meta.src });
  return { ok: true, restoredTo: meta.src };
}

module.exports = {
  ensureRoot,
  moveToQuarantine,
  listQuarantine,
  permanentDeleteQuarantineItem,
  restoreQuarantineItem,
  getRoot: () => config.quarantineRoot,
};
