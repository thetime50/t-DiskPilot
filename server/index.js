'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const scan = require('./scan');
const { normalizeDriveLetter } = scan;
const clean = require('./clean');
const optimize = require('./optimize');
const suggest = require('./suggest');
const scanPersist = require('./scanPersist');
const exportReport = require('./exportReport');
const quarantine = require('./quarantine');
const scanJob = require('./scanJob');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
const DIST = path.join(__dirname, '..', 'dist');
const LEGACY_PUBLIC = path.join(__dirname, '..', 'legacy-public');
const staticRoot = fs.existsSync(DIST) ? DIST : LEGACY_PUBLIC;
app.use(express.static(staticRoot));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 't-DiskPilot',
    version: '1.2.0',
    quarantineRoot: quarantine.getRoot(),
    scan: scanJob.snapshot(),
  });
});

app.get('/api/drives', async (_req, res) => {
  try {
    const drives = await scan.listDrives();
    res.json({ drives });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * Start async scan job.
 * Body: { drive?: "C", path?: "D:\\foo", hotspots?: true }
 */
app.post('/api/scan/start', async (req, res) => {
  try {
    const body = req.body || {};
    const includeHotspots = body.hotspots !== false && body.hotspots !== 0;
    // New scan: drop previous scan persist + analysis caches
    try { scanPersist.clearScanCache(); } catch (_) {}
    try { clean.clearResultCache(); } catch (_) {}
    try { optimize.clearResultCache(); } catch (_) {}
    try { suggest.clearResultCache(); } catch (_) {}
    const snap = await scanJob.startJob({
      drive: body.drive || 'C',
      targetPath: body.path || null,
      includeHotspots,
    });
    res.json(snap);
  } catch (err) {
    const status = err.code === 'BUSY' ? 409 : 500;
    res.status(status).json({ error: String(err.message || err), code: err.code });
  }
});

/** Progress snapshot (poll every ~150–250ms). */
app.get('/api/scan/progress', (_req, res) => {
  res.json(scanJob.snapshot());
});

/** Full result when status is done/cancelled. */
app.get('/api/scan/result', (_req, res) => {
  const snap = scanJob.snapshot();
  res.json({ ...snap, result: scanJob.getResult() });
});

app.get('/api/scan/cached', (_req, res) => {
  const cached = scanPersist.loadScanResult();
  res.json({ cached, freshness: scanPersist.freshness() });
});

app.get('/api/scan/freshness', (_req, res) => {
  res.json(scanPersist.freshness());
});

app.delete('/api/scan/cache', (_req, res) => {
  const cleared = scanPersist.clearScanCache();
  try { clean.clearResultCache(); } catch (_) {}
  try { optimize.clearResultCache(); } catch (_) {}
  try { suggest.clearResultCache(); } catch (_) {}
  res.json({ ok: true, ...cleared });
});

app.post('/api/scan/cancel', (_req, res) => {
  res.json(scanJob.cancelJob());
});

/** Legacy sync scan — starts job and tells client to poll (avoids long-blocking). */
app.get('/api/scan', async (req, res) => {
  try {
    const drive = req.query.drive || 'C';
    const targetPath = req.query.path;
    const includeHotspots = req.query.hotspots !== '0';
    try { scanPersist.clearScanCache(); } catch (_) {}
    try { clean.clearResultCache(); } catch (_) {}
    try { optimize.clearResultCache(); } catch (_) {}
    try { suggest.clearResultCache(); } catch (_) {}
    const snap = await scanJob.startJob({
      drive: String(drive),
      targetPath: targetPath ? String(targetPath) : null,
      includeHotspots,
    });
    res.json({
      async: true,
      message: '扫描已在后台启动，请轮询 GET /api/scan/progress，完成后取 GET /api/scan/result',
      ...snap,
    });
  } catch (err) {
    const status = err.code === 'BUSY' ? 409 : 500;
    logger.error('scan start failed', { error: String(err.message || err) });
    res.status(status).json({ error: String(err.message || err), code: err.code });
  }
});

app.get('/api/hotspots', async (req, res) => {
  try {
    const driveLetter = req.query.drive
      ? String(req.query.drive).replace(/:\\?$/, '').toUpperCase()
      : null;
    const hotspots = await scan.measureHotspots({ includeSuggestOnly: true, driveLetter });
    res.json({ hotspots, drive: driveLetter });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/clean/checklist/progress', (_req, res) => {
  res.json(clean.getChecklistProgress());
});

app.get('/api/clean/checklist', async (req, res) => {
  try {
    const drive = normalizeDriveLetter(req.query.drive) || 'C';
    const force = String(req.query.refresh || '') === '1' || String(req.query.refresh || '') === 'true';
    if (!force) {
      const hit = clean.getCachedResult(drive);
      if (hit && hit.value) {
        return res.json({ items: hit.value, drive, cached: true, cachedAt: hit.at, policy: '低风险可直接删；其余先隔离' });
      }
    }
    const items = await clean.buildChecklist(drive);
    clean.setCachedResult(drive, items);
    res.json({ items, drive, cached: false, policy: '低风险可直接删；其余先隔离' });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/clean/execute', async (req, res) => {
  try {
    const { ids = [], dryRun = true, confirmToken, drive: bodyDrive } = req.body || {};
    const drive = normalizeDriveLetter(bodyDrive) || 'C';
    if (dryRun === false) {
      const fr = scanPersist.freshness();
      if (!fr.canAct) {
        return res.status(403).json({ error: fr.reason, code: 'SCAN_STALE', freshness: fr });
      }
    }
    const result = await clean.executeClean({ ids, dryRun: dryRun !== false, confirmToken, drive });
    if (dryRun === false) clean.clearResultCache(drive);
    res.json({ ...result, drive });
  } catch (err) {
    const status = err.code === 'NEED_CONFIRM' ? 400 : 500;
    res.status(status).json({ error: String(err.message || err), code: err.code });
  }
});

app.get('/api/optimize/checklist/progress', (_req, res) => {
  res.json(optimize.getChecklistProgress());
});

app.get('/api/optimize/checklist', async (req, res) => {
  try {
    const drive = normalizeDriveLetter(req.query.drive) || 'C';
    const force = String(req.query.refresh || '') === '1' || String(req.query.refresh || '') === 'true';
    if (!force) {
      const hit = optimize.getCachedResult(drive);
      if (hit && hit.value) {
        return res.json({ items: hit.value, drive, cached: true, cachedAt: hit.at });
      }
    }
    const items = await optimize.buildChecklist(drive);
    optimize.setCachedResult(drive, items);
    res.json({ items, drive, cached: false });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/optimize/execute', async (req, res) => {
  try {
    const { ids = [], dryRun = true, confirmToken, drive: bodyDrive } = req.body || {};
    const drive = normalizeDriveLetter(bodyDrive) || 'C';
    if (dryRun === false) {
      const fr = scanPersist.freshness();
      if (!fr.canAct) {
        return res.status(403).json({ error: fr.reason, code: 'SCAN_STALE', freshness: fr });
      }
    }
    const result = await optimize.executeOptimize({ ids, dryRun: dryRun !== false, confirmToken, drive });
    if (dryRun === false) optimize.clearResultCache(drive);
    res.json({ ...result, drive });
  } catch (err) {
    const status = err.code === 'NEED_CONFIRM' ? 400 : 500;
    res.status(status).json({ error: String(err.message || err), code: err.code });
  }
});

app.get('/api/suggest/progress', (_req, res) => {
  res.json(suggest.getLoadProgress());
});

app.get('/api/suggest', async (req, res) => {
  try {
    const drive = normalizeDriveLetter(req.query.drive) || 'C';
    const force = String(req.query.refresh || '') === '1' || String(req.query.refresh || '') === 'true';
    if (!force) {
      const hit = suggest.getCachedResult(drive);
      if (hit && hit.value) {
        return res.json({ items: hit.value, drive, cached: true, cachedAt: hit.at });
      }
    }
    const items = await suggest.buildSuggestions(drive);
    suggest.setCachedResult(drive, items);
    res.json({ items, drive, cached: false });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/suggest/apply', async (req, res) => {
  try {
    const { id, dryRun = true, confirmToken, params, drive: bodyDrive } = req.body || {};
    const drive = normalizeDriveLetter(bodyDrive) || 'C';
    const result = await suggest.applySuggestion({ id, dryRun: dryRun !== false, confirmToken, params, drive });
    if (dryRun === false) suggest.clearResultCache(drive);
    res.json({ ...result, drive });
  } catch (err) {
    const status = err.code === 'NEED_CONFIRM' ? 400 : 500;
    res.status(status).json({ error: String(err.message || err), code: err.code });
  }
});

app.get('/api/quarantine', (_req, res) => {
  try {
    res.json({ root: quarantine.getRoot(), items: quarantine.listQuarantine() });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/quarantine/delete', (req, res) => {
  try {
    const { name, confirmToken, dryRun = true } = req.body || {};
    if (dryRun !== false) {
      return res.json({ dryRun: true, wouldDelete: name });
    }
    if (confirmToken !== 'CONFIRM') {
      return res.status(400).json({ error: '需要 confirmToken === "CONFIRM"' });
    }
    const result = quarantine.permanentDeleteQuarantineItem(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/quarantine/restore', (req, res) => {
  try {
    const { name, confirmToken, dryRun = true } = req.body || {};
    if (dryRun !== false) {
      return res.json({ dryRun: true, wouldRestore: name });
    }
    if (confirmToken !== 'CONFIRM') {
      return res.status(400).json({ error: '需要 confirmToken === "CONFIRM"' });
    }
    const result = quarantine.restoreQuarantineItem(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('*', (_req, res) => {
  const indexHtml = path.join(staticRoot, 'index.html');
  if (fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml);
  }
  // Dev: Vite serves UI on :5173; API-only here.
  res.status(404).json({
    error: 'UI not built. Run npm run dev (Vite :5173) or npm run build then npm start.',
    api: true,
  });
});

const server = app.listen(config.PORT, '127.0.0.1', () => {
  quarantine.ensureRoot();
  logger.info('t-DiskPilot started', { port: config.PORT, quarantine: quarantine.getRoot() });
  console.log(`t-DiskPilot running at http://127.0.0.1:${config.PORT}`);
  console.log(`Quarantine root: ${quarantine.getRoot()}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
