'use strict';

const path = require('path');
const scan = require('./scan');
const { walkRank } = require('./walker');
const scanPersist = require('./scanPersist');
const { formatBytes } = require('./scan');

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—';
  const n = Math.round(Number(ms));
  if (n < 1000) return n + ' ms';
  const s = n / 1000;
  if (s < 60) return s.toFixed(1) + ' s';
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return m + 'm ' + rem + 's';
}

/** In-memory scan job (single active job). */
const job = {
  id: null,
  status: 'idle', // idle | running | done | error | cancelled
  mode: null, // drive | path
  target: null,
  scannedBytes: 0,
  totalBytes: 0,
  percent: 0,
  currentPath: '',
  breadcrumb: '',
  fileCount: 0,
  dirCount: 0,
  error: null,
  result: null,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  _cancel: false,
  _seq: 0,
};

function snapshot() {
  let durationMs = job.durationMs;
  if (job.status === 'running' && job.startedAt) {
    durationMs = Date.now() - Date.parse(job.startedAt);
  }
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    target: job.target,
    scannedBytes: job.scannedBytes,
    totalBytes: job.totalBytes,
    percent: job.percent,
    scannedLabel: formatBytes(job.scannedBytes),
    totalLabel: job.totalBytes ? formatBytes(job.totalBytes) : '—',
    currentPath: job.currentPath,
    breadcrumb: job.breadcrumb,
    fileCount: job.fileCount,
    dirCount: job.dirCount,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs,
    durationLabel: formatDuration(durationMs),
    hasResult: !!job.result,
  };
}

function getResult() {
  return job.result;
}

function cancelJob() {
  if (job.status === 'running') {
    job._cancel = true;
    return { ok: true, message: '取消请求已发送' };
  }
  return { ok: false, message: '当前没有运行中的扫描' };
}

async function startJob({ drive, targetPath, includeHotspots = true } = {}) {
  if (job.status === 'running') {
    const err = new Error('已有扫描在进行中，请先取消或等待完成');
    err.code = 'BUSY';
    throw err;
  }

  job._seq += 1;
  const id = `scan-${Date.now()}-${job._seq}`;
  job.id = id;
  job.status = 'running';
  job.mode = targetPath ? 'path' : 'drive';
  job.target = targetPath || `${String(drive || 'C').replace(/:\\?$/, '')}:\\`;
  job.scannedBytes = 0;
  job.totalBytes = 0;
  job.percent = 0;
  job.currentPath = job.target;
  job.breadcrumb = '';
  job.fileCount = 0;
  job.dirCount = 0;
  job.error = null;
  job.result = null;
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.durationMs = null;
  job._cancel = false;

  // Fire and forget
  setImmediate(() => runJob(id, { drive, targetPath, includeHotspots }));

  return snapshot();
}

async function runJob(id, { drive, targetPath, includeHotspots }) {
  try {
    const drives = await scan.listDrives();
    let absTarget;
    let totalEstimate = 0;
    let driveInfo = null;

    if (targetPath) {
      absTarget = path.resolve(String(targetPath));
      // Try match drive for estimate
      const letter = /^([A-Za-z]):/.exec(absTarget);
      if (letter) {
        driveInfo = drives.find((d) => d.name && d.name.toUpperCase() === letter[1].toUpperCase());
        // For subpath, we don't know size; leave estimate 0 (UI shows bytes scanned)
        totalEstimate = 0;
      }
    } else {
      const letter = String(drive || 'C').replace(/:\\?$/, '').toUpperCase();
      driveInfo = drives.find((d) => d.name && d.name.toUpperCase() === letter) || null;
      absTarget = driveInfo ? driveInfo.root : `${letter}:\\`;
      totalEstimate = driveInfo && driveInfo.used ? Number(driveInfo.used) : 0;
    }

    job.target = absTarget;
    job.totalBytes = totalEstimate;

    const rankingRaw = await walkRank(absTarget, {
      totalBytesEstimate: totalEstimate,
      progressMinIntervalMs: 120,
      progressMinBytes: 4 * 1024 * 1024,
      shouldCancel: () => job._cancel || job.id !== id,
      onProgress: (p) => {
        if (job.id !== id) return;
        job.scannedBytes = p.scannedBytes;
        if (totalEstimate > 0) {
          job.totalBytes = totalEstimate;
          job.percent = p.percent;
        } else {
          job.totalBytes = p.scannedBytes;
          job.percent = 0;
        }
        job.currentPath = p.currentPath;
        job.breadcrumb = p.breadcrumb;
        job.fileCount = p.fileCount;
        job.dirCount = p.dirCount;
      },
    });

    if (job.id !== id) return;

    if (rankingRaw.cancelled || job._cancel) {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.durationMs = rankingRaw.durationMs != null
        ? rankingRaw.durationMs
        : (job.startedAt ? Date.now() - Date.parse(job.startedAt) : null);
      job.percent = job.totalBytes
        ? Math.min(100, Math.round((job.scannedBytes / job.totalBytes) * 1000) / 10)
        : 0;
      job.result = {
        cancelled: true,
        scannedAt: job.finishedAt,
        drive: driveInfo,
        drives,
        rootRanking: {
          path: rankingRaw.path,
          total: rankingRaw.total,
          totalLabel: formatBytes(rankingRaw.total),
          durationMs: rankingRaw.durationMs != null ? rankingRaw.durationMs : job.durationMs,
          durationLabel: formatDuration(
            rankingRaw.durationMs != null ? rankingRaw.durationMs : job.durationMs
          ),
          children: (rankingRaw.children || []).map((c) => ({
            name: c.name,
            path: c.path,
            isDir: c.isDir,
            size: c.size,
            sizeLabel: formatBytes(c.size),
            durationMs: c.durationMs != null ? c.durationMs : null,
            durationLabel: formatDuration(c.durationMs),
          })),
          partial: true,
        },
        hotspots: null,
      };
      return;
    }

    // Finalize ranking labels
    const ranking = {
      path: rankingRaw.path,
      total: rankingRaw.total,
      totalLabel: formatBytes(rankingRaw.total),
      durationMs: rankingRaw.durationMs != null ? rankingRaw.durationMs : null,
      durationLabel: formatDuration(rankingRaw.durationMs),
      children: (rankingRaw.children || []).map((c) => ({
        name: c.name,
        path: c.path,
        isDir: !!c.isDir,
        size: c.size,
        sizeLabel: formatBytes(c.size),
        durationMs: c.durationMs != null ? c.durationMs : null,
        durationLabel: formatDuration(c.durationMs),
      })),
      fileCount: rankingRaw.fileCount,
      dirCount: rankingRaw.dirCount,
      scannedAt: new Date().toISOString(),
    };

    // Hotspots after ranking — only rules whose path is on the scanned drive
    let hotspots = null;
    if (includeHotspots && !targetPath) {
      const m = /^([A-Za-z]):/.exec(String(absTarget || ''));
      const driveLetter = (m && m[1].toUpperCase())
        || (driveInfo && driveInfo.name && String(driveInfo.name).toUpperCase())
        || String(drive || '').replace(/:\\?$/, '').toUpperCase()
        || null;
      const onDriveRules = scan.hotspotRules(driveLetter).filter((r) => r.category !== 'suggest-only');
      if (!onDriveRules.length) {
        hotspots = [];
        job.currentPath = absTarget;
        job.breadcrumb = '';
      } else {
        job.currentPath = '热点规则 · ' + driveLetter + ':';
        job.breadcrumb = 'hotspots';
        hotspots = await scan.measureHotspotsNode({
          includeSuggestOnly: false,
          driveLetter,
          shouldCancel: () => job._cancel || job.id !== id,
          onItem: (label) => {
            job.currentPath = '热点 · ' + label;
          },
        });
      }
    }

    if (job.id !== id) return;

    job.finishedAt = new Date().toISOString();
    job.durationMs = job.startedAt
      ? Date.now() - Date.parse(job.startedAt)
      : rankingRaw.durationMs;
    job.scannedBytes = rankingRaw.scannedBytes || rankingRaw.total;
    job.result = {
      scannedAt: job.finishedAt,
      durationMs: job.durationMs,
      durationLabel: formatDuration(job.durationMs),
      rankingDurationMs: ranking.durationMs,
      rankingDurationLabel: ranking.durationLabel,
      drive: driveInfo,
      drives,
      rootRanking: ranking,
      hotspots,
      mode: targetPath ? 'path' : 'drive',
    };
    if (job._cancel) {
      job.status = 'cancelled';
    } else {
      try { scanPersist.saveScanResult(job.result); } catch (_) { /* ignore persist errors */ }
      job.status = 'done';
      job.percent = 100;
    }
  } catch (err) {
    if (job.id !== id) return;
    job.status = 'error';
    job.error = String(err.message || err);
    job.finishedAt = new Date().toISOString();
    job.durationMs = job.startedAt
      ? Date.now() - Date.parse(job.startedAt)
      : null;
  }
}

module.exports = {
  snapshot,
  getResult,
  cancelJob,
  startJob,
  getJob: () => job,
};
