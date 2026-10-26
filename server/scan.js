'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { walkRank, measureDir } = require('./walker');
const docker = require('./docker');

const HOME = os.homedir();

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, Number(n));
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

async function listDrives() {
  if (process.platform !== 'win32') {
    return [{ name: '/', label: 'root', root: '/', total: 0, free: 0, used: 0 }];
  }
  const ps = `
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
  $used = 0; $free = 0; $total = 0
  try {
    if ($_.Used -ne $null) { $used = [int64]$_.Used }
    if ($_.Free -ne $null) { $free = [int64]$_.Free }
    $total = $used + $free
  } catch {}
  [PSCustomObject]@{
    Name = $_.Name
    Root = $_.Root
    Used = $used
    Free = $free
    Total = $total
  }
} | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', ps],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );
    const data = JSON.parse(stdout || '[]');
    const arr = Array.isArray(data) ? data : [data];
    return arr
      .filter((d) => d && d.Name)
      .map((d) => ({
        name: d.Name,
        root: d.Root || `${d.Name}:\\`,
        total: Number(d.Total) || 0,
        free: Number(d.Free) || 0,
        used: Number(d.Used) || 0,
        usedPct: d.Total ? Math.round((Number(d.Used) / Number(d.Total)) * 1000) / 10 : 0,
        totalLabel: formatBytes(d.Total),
        freeLabel: formatBytes(d.Free),
        usedLabel: formatBytes(d.Used),
      }));
  } catch (err) {
    return [{ error: String(err.message || err) }];
  }
}

/** Node-based directory size (no PowerShell timeout). */
async function dirSizeBytes(target, opts = {}) {
  if (!target || !fs.existsSync(target)) return 0;
  try {
    const r = await measureDir(target, {
      progressMinIntervalMs: 500,
      ...opts,
    });
    return r.cancelled ? r.size : r.size;
  } catch {
    return 0;
  }
}

/** Rank immediate children via Node walk (with progress callbacks). */
async function rankChildren(target, opts = {}) {
  if (!target || !fs.existsSync(target)) {
    return { path: target, error: 'path not found', children: [] };
  }
  const raw = await walkRank(target, opts);
  const children = (raw.children || []).map((c) => ({
    name: c.name,
    path: c.path,
    isDir: !!c.isDir,
    size: Number(c.size) || 0,
    sizeLabel: formatBytes(c.size),
  }));
  return {
    path: raw.path,
    total: raw.total,
    totalLabel: formatBytes(raw.total),
    children,
    fileCount: raw.fileCount,
    dirCount: raw.dirCount,
    cancelled: raw.cancelled,
    scannedAt: new Date().toISOString(),
  };
}

function hotspotRules() {
  const localApp = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
  return [
    { id: 'user-temp', category: 'temp', label: '用户 Temp', path: process.env.TEMP || path.join(localApp, 'Temp'), risk: 'low' },
    { id: 'local-temp', category: 'temp', label: 'Local\\Temp', path: path.join(localApp, 'Temp'), risk: 'low' },
    { id: 'pip-cache', category: 'pip-cache', label: 'Pip 缓存', path: path.join(localApp, 'pip', 'Cache'), risk: 'low' },
    { id: 'npm-cache', category: 'npm-cache', label: 'npm 缓存', path: path.join(localApp, 'npm-cache'), risk: 'low' },
    { id: 'yarn-cache', category: 'yarn-cache', label: 'Yarn 缓存', path: path.join(localApp, 'Yarn', 'Cache'), risk: 'low' },
    { id: 'pnpm-store', category: 'pnpm-cache', label: 'pnpm store', path: path.join(localApp, 'pnpm', 'store'), risk: 'low' },
    { id: 'user-cache', category: 'temp', label: '~/.cache', path: path.join(HOME, '.cache'), risk: 'low' },
    { id: 'crash-dumps', category: 'crash-dumps', label: '崩溃转储', path: path.join(localApp, 'CrashDumps'), risk: 'low' },
    { id: 'windows-temp', category: 'temp', label: 'Windows\\Temp', path: 'C:\\Windows\\Temp', risk: 'medium' },
    { id: 'windows-logs', category: 'temp-logs', label: 'Windows\\Logs', path: 'C:\\Windows\\Logs', risk: 'medium' },
    {
      id: 'delivery-opt',
      category: 'temp',
      label: '传递优化缓存',
      path: path.join(process.env.WINDIR || 'C:\\Windows', 'SoftwareDistribution', 'DeliveryOptimization', 'Cache'),
      risk: 'medium',
    },
    { id: 'android', category: 'suggest-only', label: '.android', path: path.join(HOME, '.android'), risk: 'high' },
    { id: 'vscode', category: 'suggest-only', label: '.vscode 扩展/数据', path: path.join(HOME, '.vscode'), risk: 'high' },
    { id: 'rustup', category: 'suggest-only', label: '.rustup', path: path.join(HOME, '.rustup'), risk: 'high' },
    { id: 'cargo', category: 'suggest-only', label: '.cargo', path: path.join(HOME, '.cargo'), risk: 'high' },
    { id: 'gradle', category: 'suggest-only', label: '.gradle', path: path.join(HOME, '.gradle'), risk: 'high' },
    { id: 'appdata', category: 'suggest-only', label: 'AppData', path: path.join(HOME, 'AppData'), risk: 'high' },
    { id: 'docker-local', category: 'docker-data', label: 'Docker Desktop Local', path: path.join(localApp, 'Docker'), risk: 'medium' },
    { id: 'docker-programdata', category: 'docker-data', label: 'ProgramData\\DockerDesktop', path: 'C:\\ProgramData\\DockerDesktop', risk: 'medium' },
    { id: 'docker-wsl-main', category: 'suggest-only', label: 'docker-desktop WSL vhdx', path: path.join(localApp, 'Docker', 'wsl', 'main', 'ext4.vhdx'), risk: 'high' },
  ];
}

/** Measure hotspots with Node walker (no PS timeout). */
async function measureHotspotsNode({ includeSuggestOnly = true, shouldCancel, onItem } = {}) {
  const rules = hotspotRules().filter((r) => includeSuggestOnly || r.category !== 'suggest-only');
  const results = [];
  for (const rule of rules) {
    if (shouldCancel && shouldCancel()) break;
    if (onItem) onItem(rule.path);
    const exists = fs.existsSync(rule.path);
    let size = 0;
    if (exists) {
      try {
        const st = fs.statSync(rule.path);
        if (st.isFile()) size = st.size;
        else {
          size = await dirSizeBytes(rule.path, {
            shouldCancel,
            progressMinIntervalMs: 400,
          });
        }
      } catch {
        size = 0;
      }
    }
    results.push({
      ...rule,
      exists,
      size,
      sizeLabel: formatBytes(size),
    });
  }

  // Docker WSL vhdx (from registry) + docker system df — skip duplicate paths
  try {
    if (onItem) onItem('Docker detection');
    const collected = await docker.collectDockerHotspots({
      dirSizeBytes,
      formatBytes,
      shouldCancel,
    });
    const seen = new Set(results.map((r) => String(r.path || '').toLowerCase()));
    for (const h of collected.hotspots || []) {
      const key = String(h.path || '').toLowerCase();
      if (key && seen.has(key)) continue;
      if (!includeSuggestOnly && h.category === 'suggest-only') continue;
      seen.add(key);
      results.push(h);
    }
  } catch (_) {
    /* docker optional */
  }

  results.sort((a, b) => b.size - a.size);
  return results;
}

async function measureHotspots(opts) {
  return measureHotspotsNode(opts);
}

module.exports = {
  formatBytes,
  listDrives,
  dirSizeBytes,
  rankChildren,
  hotspotRules,
  measureHotspots,
  measureHotspotsNode,
  docker,
};
