'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'last-scan.json');
const MAX_BYTES = 1.5 * 1024 * 1024; // single file hard cap
const MAX_CHILDREN = 40;
const MAX_HOTSPOTS = 30;
const STALE_MS = 24 * 60 * 60 * 1000; // 24h

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function slimRanking(ranking) {
  if (!ranking || typeof ranking !== 'object') return null;
  const children = Array.isArray(ranking.children) ? ranking.children : [];
  const slimChildren = children.slice(0, MAX_CHILDREN).map((c) => ({
    name: c.name,
    path: c.path,
    size: c.size,
    sizeLabel: c.sizeLabel,
    durationMs: c.durationMs != null ? c.durationMs : null,
    durationLabel: c.durationLabel || null,
    isDir: c.isDir !== false,
  }));
  return {
    path: ranking.path,
    total: ranking.total,
    totalLabel: ranking.totalLabel,
    durationMs: ranking.durationMs != null ? ranking.durationMs : null,
    durationLabel: ranking.durationLabel || null,
    partial: !!ranking.partial,
    children: slimChildren,
    truncated: children.length > slimChildren.length,
  };
}

function slimHotspots(hotspots) {
  const list = Array.isArray(hotspots) ? hotspots : [];
  return list.slice(0, MAX_HOTSPOTS).map((h) => ({
    id: h.id,
    label: h.label,
    path: h.path,
    size: h.size,
    sizeLabel: h.sizeLabel,
    category: h.category,
    risk: h.risk,
  }));
}

function compactResult(result) {
  if (!result || result.cancelled) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    scannedAt: result.scannedAt || result.finishedAt || new Date().toISOString(),
    durationMs: result.durationMs != null ? result.durationMs : null,
    durationLabel: result.durationLabel || null,
    mode: result.mode || null,
    target: result.target || null,
    drive: result.drive
      ? {
          name: result.drive.name,
          freeLabel: result.drive.freeLabel,
          usedLabel: result.drive.usedLabel,
          totalLabel: result.drive.totalLabel,
        }
      : null,
    rootRanking: slimRanking(result.rootRanking),
    hotspots: slimHotspots(result.hotspots),
  };
}

function saveScanResult(result) {
  const compact = compactResult(result);
  if (!compact) return { ok: false, reason: 'empty-or-cancelled' };
  ensureDir();
  let text = JSON.stringify(compact);
  // If still too big, drop hotspots then shrink children
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    compact.hotspots = [];
    text = JSON.stringify(compact);
  }
  while (Buffer.byteLength(text, 'utf8') > MAX_BYTES && compact.rootRanking && compact.rootRanking.children.length > 10) {
    compact.rootRanking.children = compact.rootRanking.children.slice(0, Math.ceil(compact.rootRanking.children.length / 2));
    compact.rootRanking.truncated = true;
    text = JSON.stringify(compact);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  // atomic-ish overwrite of the single file
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, FILE);
  return { ok: true, bytes: Buffer.byteLength(text, 'utf8'), path: FILE };
}

function loadScanResult() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES * 2) return null; // corrupt/oversized guard
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function freshness() {
  const cached = loadScanResult();
  if (!cached || !cached.scannedAt) {
    return {
      hasScan: false,
      scannedAt: null,
      ageMs: null,
      staleAfterMs: STALE_MS,
      stale: true,
      canAct: false,
      reason: '尚无扫描结果，请先扫描',
    };
  }
  const ageMs = Date.now() - Date.parse(cached.scannedAt);
  const stale = !(ageMs >= 0 && ageMs <= STALE_MS);
  return {
    hasScan: true,
    scannedAt: cached.scannedAt,
    ageMs,
    staleAfterMs: STALE_MS,
    stale,
    canAct: !stale,
    reason: stale
      ? '扫描结果已超过 ' + Math.round(STALE_MS / 3600000) + ' 小时，请重新扫描后再清理/优化'
      : '扫描结果有效',
  };
}

function clearScanCache() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
    const tmp = FILE + '.tmp';
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = {
  FILE,
  MAX_BYTES,
  MAX_CHILDREN,
  STALE_MS,
  saveScanResult,
  loadScanResult,
  freshness,
  clearScanCache,
};
