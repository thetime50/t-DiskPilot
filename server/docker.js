'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const HOME = os.homedir();
const localApp = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const roamingApp = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

function parseSizeToBytes(text) {
  if (text == null) return 0;
  const s = String(text).trim();
  if (!s || s === '0B' || s === '0') return 0;
  const m = /^([\d.]+)\s*([KMGTPE]?i?B)$/i.exec(s.replace(/\s+/g, ''));
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const map = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    PB: 1000 ** 5,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
  };
  return Math.round(num * (map[unit] || 1));
}

function parseReclaimable(text) {
  // e.g. "12.03GB (64%)" or "1.039GB"
  const s = String(text || '');
  const beforeParen = s.split('(')[0].trim();
  return parseSizeToBytes(beforeParen);
}

async function dockerAvailable() {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

async function dockerSystemDf() {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['system', 'df', '--format', '{{.Type}}|{{.TotalCount}}|{{.Active}}|{{.Size}}|{{.Reclaimable}}'],
      { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    );
    const rows = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [type, totalCount, active, size, reclaimable] = line.split('|');
        return {
          type,
          totalCount: Number(totalCount) || 0,
          active: Number(active) || 0,
          sizeLabel: size || '0B',
          reclaimableLabel: reclaimable || '0B',
          size: parseSizeToBytes(size),
          reclaimable: parseReclaimable(reclaimable),
        };
      });
    const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
    const reclaimableTotal = rows.reduce((a, r) => a + (r.reclaimable || 0), 0);
    const sizeTotal = rows.reduce((a, r) => a + (r.size || 0), 0);
    return { ok: true, rows, byType, reclaimableTotal, sizeTotal, raw: stdout };
  } catch (err) {
    return { ok: false, error: String(err.message || err), rows: [], byType: {}, reclaimableTotal: 0, sizeTotal: 0 };
  }
}

function readDockerSettings() {
  const candidates = [
    path.join(roamingApp, 'Docker', 'settings-store.json'),
    path.join(roamingApp, 'Docker', 'settings.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        path: p,
        dataFolder: j.DataFolder || j.dataFolder || null,
        customWslDistroDir: j.CustomWslDistroDir || j.customWslDistroDir || null,
        diskSizeMiB: j.DiskSizeMiB || j.diskSizeMiB || null,
      };
    } catch {
      /* continue */
    }
  }
  return null;
}

function readWslDockerPaths() {
  // HKCU\...\Lxss\<guid> BasePath / DistributionName
  const out = [];
  if (process.platform !== 'win32') return out;
  try {
    const { execFileSync } = require('child_process');
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  if ($p.DistributionName -match 'docker') {
    [PSCustomObject]@{ Name = $p.DistributionName; BasePath = $p.BasePath }
  }
} | ConvertTo-Json -Compress
`;
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const data = JSON.parse(stdout || '[]');
    const arr = Array.isArray(data) ? data : data ? [data] : [];
    for (const d of arr) {
      if (!d || !d.BasePath) continue;
      let base = String(d.BasePath).replace(/^\\\\\?\\/, '');
      out.push({ name: d.Name, basePath: base, vhdx: path.join(base, 'ext4.vhdx') });
    }
  } catch {
    /* ignore */
  }
  return out;
}

function fileSizeOrZero(p) {
  try {
    if (p && fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.isFile()) return st.size;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * Known Docker-related filesystem paths (hotspots / suggest).
 */
function discoverDockerPaths() {
  const settings = readDockerSettings();
  const wsl = readWslDockerPaths();
  const paths = [
    {
      id: 'docker-local',
      label: 'Docker Desktop Local',
      path: path.join(localApp, 'Docker'),
      risk: 'medium',
      category: 'docker-data',
    },
    {
      id: 'docker-roaming',
      label: 'Docker Roaming 配置',
      path: path.join(roamingApp, 'Docker'),
      risk: 'high',
      category: 'suggest-only',
    },
    {
      id: 'docker-programdata',
      label: 'ProgramData\\DockerDesktop',
      path: 'C:\\ProgramData\\DockerDesktop',
      risk: 'medium',
      category: 'docker-data',
    },
    {
      id: 'docker-wsl-main-vhdx',
      label: 'docker-desktop WSL vhdx',
      path: path.join(localApp, 'Docker', 'wsl', 'main', 'ext4.vhdx'),
      risk: 'high',
      category: 'suggest-only',
      isFile: true,
    },
  ];

  if (settings && settings.dataFolder) {
    paths.push({
      id: 'docker-data-folder',
      label: 'Docker DataFolder (settings)',
      path: settings.dataFolder,
      risk: 'high',
      category: 'suggest-only',
    });
  }
  if (settings && settings.customWslDistroDir) {
    paths.push({
      id: 'docker-custom-wsl-dir',
      label: 'Docker CustomWslDistroDir',
      path: settings.customWslDistroDir,
      risk: 'high',
      category: 'suggest-only',
    });
  }

  for (const d of wsl) {
    paths.push({
      id: `docker-wsl-${String(d.name).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
      label: `WSL ${d.name} vhdx`,
      path: d.vhdx,
      risk: 'high',
      category: 'suggest-only',
      isFile: true,
      meta: { distro: d.name, basePath: d.basePath },
    });
  }

  // de-dupe by path
  const seen = new Set();
  const unique = [];
  for (const p of paths) {
    const key = String(p.path || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return { paths: unique, settings, wsl };
}

async function collectDockerHotspots({ dirSizeBytes, formatBytes, shouldCancel } = {}) {
  const { paths, settings, wsl } = discoverDockerPaths();
  const results = [];

  for (const rule of paths) {
    if (shouldCancel && shouldCancel()) break;
    const exists = fs.existsSync(rule.path);
    let size = 0;
    if (exists) {
      if (rule.isFile) {
        size = fileSizeOrZero(rule.path);
      } else if (typeof dirSizeBytes === 'function') {
        size = await dirSizeBytes(rule.path, { shouldCancel, progressMinIntervalMs: 400 });
      }
    }
    results.push({
      id: rule.id,
      category: rule.category,
      label: rule.label,
      path: rule.path,
      risk: rule.risk,
      exists,
      size,
      sizeLabel: formatBytes ? formatBytes(size) : String(size),
      meta: rule.meta || undefined,
    });
  }

  const df = await dockerSystemDf();
  const available = df.ok;
  if (available) {
    const images = df.byType.Images || {};
    const cache = df.byType['Build Cache'] || df.byType.BuildCache || {};
    const containers = df.byType.Containers || {};
    results.push({
      id: 'docker-df-images',
      category: 'docker-prune',
      label: 'Docker 镜像 (docker system df)',
      path: '(docker images)',
      risk: 'medium',
      exists: true,
      size: images.size || 0,
      sizeLabel: images.sizeLabel || (formatBytes ? formatBytes(images.size || 0) : '0'),
      reclaimable: images.reclaimable || 0,
      reclaimableLabel: images.reclaimableLabel || '',
      source: 'docker-system-df',
    });
    results.push({
      id: 'docker-df-build-cache',
      category: 'docker-prune',
      label: 'Docker Build Cache (df)',
      path: '(docker build cache)',
      risk: 'low',
      exists: true,
      size: cache.size || 0,
      sizeLabel: cache.sizeLabel || (formatBytes ? formatBytes(cache.size || 0) : '0'),
      reclaimable: cache.reclaimable || 0,
      reclaimableLabel: cache.reclaimableLabel || '',
      source: 'docker-system-df',
    });
    results.push({
      id: 'docker-df-containers',
      category: 'suggest-only',
      label: 'Docker 容器可写层 (df)',
      path: '(docker containers)',
      risk: 'high',
      exists: true,
      size: containers.size || 0,
      sizeLabel: containers.sizeLabel || (formatBytes ? formatBytes(containers.size || 0) : '0'),
      reclaimable: containers.reclaimable || 0,
      reclaimableLabel: containers.reclaimableLabel || '',
      source: 'docker-system-df',
    });
  }

  results.sort((a, b) => (b.size || 0) - (a.size || 0));
  return {
    hotspots: results,
    df,
    dockerCli: available,
    settings,
    wsl,
  };
}

/**
 * Run a docker prune command. Never called unless caller passed confirm.
 */
async function runDockerPrune(kind, { dryRun = true } = {}) {
  const plans = {
    'build-cache': {
      args: ['builder', 'prune', '-f'],
      label: 'docker builder prune -f',
    },
    'dangling-images': {
      args: ['image', 'prune', '-f'],
      label: 'docker image prune -f',
    },
    'unused-images': {
      args: ['image', 'prune', '-a', '-f'],
      label: 'docker image prune -a -f',
    },
    'system-prune': {
      args: ['system', 'prune', '-f'],
      label: 'docker system prune -f',
    },
  };

  const plan = plans[kind];
  if (!plan) throw new Error('未知 docker prune 类型: ' + kind);

  const dfBefore = await dockerSystemDf();
  if (dryRun) {
    let reclaimable = 0;
    let note = null;
    let wouldReclaimLabel = null;
    if (kind === 'build-cache') {
      const c = dfBefore.byType['Build Cache'] || {};
      reclaimable = c.reclaimable || c.size || 0;
      wouldReclaimLabel = c.reclaimableLabel || c.sizeLabel || null;
    } else if (kind === 'dangling-images') {
      const img = dfBefore.byType.Images || {};
      reclaimable = 0;
      note =
        'dangling 仅删无标签镜像；镜像总可回收约 ' +
        (img.reclaimableLabel || '0') +
        '（含未使用标签镜像，需 unused-images）';
      wouldReclaimLabel = img.reclaimableLabel || null;
    } else if (kind === 'unused-images') {
      const img = dfBefore.byType.Images || {};
      reclaimable = img.reclaimable || 0;
      wouldReclaimLabel = img.reclaimableLabel || null;
    } else if (kind === 'system-prune') {
      reclaimable = dfBefore.reclaimableTotal || 0;
      wouldReclaimLabel = null;
    }
    return {
      dryRun: true,
      command: plan.label,
      wouldReclaim: reclaimable,
      wouldReclaimLabel,
      note,
      dfBefore,
    };
  }

  const { stdout, stderr } = await execFileAsync('docker', plan.args, {
    windowsHide: true,
    timeout: 600000,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const dfAfter = await dockerSystemDf();
  return {
    dryRun: false,
    command: plan.label,
    stdout: String(stdout || '').trim(),
    stderr: String(stderr || '').trim(),
    dfBefore,
    dfAfter,
  };
}

module.exports = {
  parseSizeToBytes,
  dockerAvailable,
  dockerSystemDf,
  readDockerSettings,
  readWslDockerPaths,
  discoverDockerPaths,
  collectDockerHotspots,
  runDockerPrune,
};
