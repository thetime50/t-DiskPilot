'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const logger = require('./logger');
const { formatBytes, dirSizeBytes, normalizeDriveLetter } = require('./scan');
const { createLoadProgress } = require('./loadProgress');
const { createResultCache } = require('./resultCache');
const resultCache = createResultCache();

const checklistProgress = createLoadProgress();

const HOME = os.homedir();
const localApp = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const WINDIR = process.env.WINDIR || 'C:\\Windows';

function optimizeCatalog(driveLetter) {
  const letter = normalizeDriveLetter(driveLetter) || 'C';
  const items = letter === 'C' ? systemOptimizeCatalog() : dataDriveOptimizeCatalog(letter);
  return items.map((x) => ({ ...x, drive: letter, checked: false }));
}

function systemOptimizeCatalog() {
  return [
    {
      id: 'opt-delivery-cache',
      label: '清理传递优化 (Delivery Optimization) 缓存',
      description: '删除 Windows 传递优化缓存文件，不影响已安装更新',
      path: path.join(WINDIR, 'SoftwareDistribution', 'DeliveryOptimization', 'Cache'),
      risk: 'medium',
      mode: 'direct-after-confirm',
      action: 'empty-dir',
      notes: '需确认；部分文件可能被系统占用而跳过',
    },
    {
      id: 'opt-storage-sense-info',
      label: '查看 / 开启存储感知建议',
      description: '检测存储感知状态；真正改系统设置需你确认后执行注册表/设置变更',
      path: null,
      risk: 'low',
      mode: 'info-then-optional-apply',
      action: 'storage-sense-status',
      notes: '默认只报告状态；勾选并确认后才写入启用建议',
    },
    {
      id: 'opt-recycle-bin-info',
      label: '清空回收站（需确认）',
      description: '清空当前用户回收站（所有盘）',
      path: null,
      risk: 'medium',
      mode: 'direct-after-confirm',
      action: 'empty-recycle-bin',
      driveLetter: null,
      notes: '不可进隔离区；确认后直接清空',
    },
    {
      id: 'opt-thumbnail-cache',
      label: '清理缩略图缓存',
      description: '删除 Explorer 缩略图缓存（会自动重建）',
      path: path.join(localApp, 'Microsoft', 'Windows', 'Explorer'),
      risk: 'low',
      mode: 'direct-after-confirm',
      action: 'delete-thumbcache',
      notes: '仅删除 thumbcache_*.db',
    },
  ];
}

function dataDriveOptimizeCatalog(letter) {
  const L = letter;
  const root = L + ':\\';
  return [
    {
      id: 'opt-recycle-' + L,
      label: '清空 ' + L + ': 回收站（需确认）',
      description: '仅清空 ' + L + ': 盘回收站',
      path: root + '$Recycle.Bin',
      risk: 'medium',
      mode: 'direct-after-confirm',
      action: 'empty-recycle-bin',
      driveLetter: L,
      notes: '不可进隔离区；确认后直接清空该盘回收站',
    },
    {
      id: 'opt-temp-' + L,
      label: '清理 ' + L + ':\\Temp',
      description: '清空该盘 Temp 目录（跳过占用）',
      path: root + 'Temp',
      risk: 'low',
      mode: 'direct-after-confirm',
      action: 'empty-dir',
      notes: '仅针对所选盘',
    },
    {
      id: 'opt-tmp-' + L,
      label: '清理 ' + L + ':\\tmp',
      description: '清空该盘 tmp 目录',
      path: root + 'tmp',
      risk: 'low',
      mode: 'direct-after-confirm',
      action: 'empty-dir',
      notes: '仅针对所选盘',
    },
    {
      id: 'opt-caches-' + L,
      label: '清理 ' + L + ':\\caches',
      description: '清空该盘 caches 目录内容',
      path: root + 'caches',
      risk: 'low',
      mode: 'direct-after-confirm',
      action: 'empty-dir',
      notes: '确认其中没有仍需保留的迁移缓存',
    },
  ];
}

async function storageSenseStatus() {
  if (process.platform !== 'win32') return { supported: false };
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy'
if (-not (Test-Path $path)) {
  [PSCustomObject]@{ Exists = $false; Enabled = $null } | ConvertTo-Json -Compress
} else {
  $en = (Get-ItemProperty -Path $path -Name '01' -ErrorAction SilentlyContinue).'01'
  [PSCustomObject]@{ Exists = $true; Enabled = $en } | ConvertTo-Json -Compress
}
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', ps],
      { encoding: 'utf8', windowsHide: true }
    );
    return { supported: true, ...JSON.parse(stdout || '{}') };
  } catch (err) {
    return { supported: true, error: String(err.message || err) };
  }
}

async function buildChecklist(driveLetter) {
  const letter = normalizeDriveLetter(driveLetter) || 'C';
  const items = optimizeCatalog(letter);
  const out = [];
  checklistProgress.begin(items.length, '准备优化清单…');
  let step = 0;
  try {
  for (const item of items) {
    checklistProgress.step(++step, item.label || item.id);

    let size = 0;
    let exists = true;
    let extra = {};
    if (item.path) {
      exists = fs.existsSync(item.path);
      if (exists && item.action === 'empty-dir') size = await dirSizeBytes(item.path);
      if (exists && item.action === 'delete-thumbcache') {
        try {
          const files = fs.readdirSync(item.path).filter((f) => /^thumbcache_.*\.db$/i.test(f));
          for (const f of files) {
            try {
              size += fs.statSync(path.join(item.path, f)).size;
            } catch (_) {
              /* ignore */
            }
          }
          extra.files = files.length;
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (item.action === 'storage-sense-status') {
      extra.status = await storageSenseStatus();
    }
    out.push({
      ...item,
      exists,
      size,
      sizeLabel: formatBytes(size),
      selectable: item.action === 'storage-sense-status' || item.action === 'empty-recycle-bin' || (exists && (size > 0 || item.action !== 'empty-dir')),
      extra,
    });
  }
  checklistProgress.end();
  return out;
  } catch (err) {
    checklistProgress.fail(err);
    throw err;
  }
}

function getChecklistProgress() {
  return checklistProgress.snapshot();
}

async function emptyDirSafe(dirPath, { dryRun }) {
  if (!fs.existsSync(dirPath)) return { deleted: 0, skipped: 0, dryRun };
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let deleted = 0;
  let skipped = 0;
  const errors = [];
  for (const ent of entries) {
    const full = path.join(dirPath, ent.name);
    try {
      if (dryRun) {
        deleted += 1;
        continue;
      }
      fs.rmSync(full, { recursive: true, force: true });
      deleted += 1;
    } catch (err) {
      skipped += 1;
      errors.push(String(err.message || err));
    }
  }
  return { deleted, skipped, dryRun, errors };
}

async function executeOptimize({ ids = [], dryRun = true, confirmToken, drive } = {}) {
  if (!dryRun && confirmToken !== 'CONFIRM') {
    const err = new Error('需要 confirmToken === "CONFIRM" 才能真实执行');
    err.code = 'NEED_CONFIRM';
    throw err;
  }
  const letter = normalizeDriveLetter(drive) || 'C';
  const catalog = optimizeCatalog(letter);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const results = [];

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      results.push({ id, ok: false, error: '未知项目' });
      continue;
    }
    try {
      let detail = {};
      if (item.action === 'empty-dir') {
        detail = await emptyDirSafe(item.path, { dryRun });
      } else if (item.action === 'delete-thumbcache') {
        const dir = item.path;
        const files = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter((f) => /^thumbcache_.*\.db$/i.test(f))
          : [];
        if (!dryRun) {
          for (const f of files) {
            try {
              fs.unlinkSync(path.join(dir, f));
            } catch (_) {
              /* skip locked */
            }
          }
        }
        detail = { files: files.length, dryRun };
      } else if (item.action === 'empty-recycle-bin') {
        const dl = item.driveLetter ? String(item.driveLetter).toUpperCase() : null;
        const cmd = dl
          ? 'Clear-RecycleBin -DriveLetter ' + dl + ' -Force -ErrorAction SilentlyContinue'
          : 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue';
        if (dryRun) {
          detail = { dryRun: true, would: cmd, driveLetter: dl };
        } else {
          await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-Command', cmd],
            { windowsHide: true }
          );
          detail = { dryRun: false, cleared: true, driveLetter: dl };
        }
      } else if (item.action === 'storage-sense-status') {
        const status = await storageSenseStatus();
        if (dryRun) {
          detail = { dryRun: true, status, note: '确认后可写入启用存储感知 (HKCU StoragePolicy 01=1)' };
        } else {
          // Apply enable Storage Sense for current user
          const ps = `
$ErrorActionPreference = 'Stop'
$path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy'
New-Item -Path $path -Force | Out-Null
New-ItemProperty -Path $path -Name '01' -Value 1 -PropertyType DWord -Force | Out-Null
`;
          await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
          detail = { dryRun: false, applied: true, statusBefore: status };
        }
      } else {
        detail = { skipped: true, reason: '未实现的 action' };
      }
      logger.info('optimize execute', { id, dryRun, detail });
      results.push({ id, ok: true, label: item.label, detail });
    } catch (err) {
      logger.error('optimize failed', { id, error: String(err.message || err) });
      results.push({ id, ok: false, error: String(err.message || err) });
    }
  }
  return { dryRun, results, at: new Date().toISOString() };
}


function cacheKey(drive) {
  return normalizeDriveLetter(drive) || 'C';
}

function getCachedResult(drive) {
  return resultCache.get(cacheKey(drive));
}

function setCachedResult(drive, value) {
  if (arguments.length === 1) return resultCache.set('C', drive);
  return resultCache.set(cacheKey(drive), value);
}

function clearResultCache(drive) {
  if (drive == null || drive === '') resultCache.clear();
  else resultCache.clear(cacheKey(drive));
}

module.exports = {
  optimizeCatalog,
  buildChecklist,
  getChecklistProgress,
  getCachedResult,
  setCachedResult,
  clearResultCache,
  executeOptimize,
  storageSenseStatus,
};
