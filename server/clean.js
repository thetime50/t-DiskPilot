'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const config = require('./config');
const logger = require('./logger');
const quarantine = require('./quarantine');
const { formatBytes, dirSizeBytes } = require('./scan');
const { createLoadProgress } = require('./loadProgress');
const { createResultCache } = require('./resultCache');
const resultCache = createResultCache();

const checklistProgress = createLoadProgress();
const docker = require('./docker');

const HOME = os.homedir();
const localApp = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

/** Catalog of cleanable items. Each is individually selectable. */
function cleanCatalog() {
  return [
    {
      id: 'clean-user-temp',
      category: 'temp',
      label: '清理用户 Temp',
      description: '清空 %TEMP% / Local\\Temp 下可删文件（跳过正在占用的）',
      path: process.env.TEMP || path.join(localApp, 'Temp'),
      risk: 'low',
      mode: 'direct', // low-risk: direct delete after confirm
      action: 'empty-dir',
    },
    {
      id: 'clean-pip-cache',
      category: 'pip-cache',
      label: '清理 Pip 缓存',
      description: '删除 pip HTTP/wheel 缓存，可重新下载',
      path: path.join(localApp, 'pip', 'Cache'),
      risk: 'low',
      mode: 'direct',
      action: 'empty-dir',
    },
    {
      id: 'clean-npm-cache',
      category: 'npm-cache',
      label: '清理 npm 缓存',
      description: '删除 npm-cache 目录内容',
      path: path.join(localApp, 'npm-cache'),
      risk: 'low',
      mode: 'direct',
      action: 'empty-dir',
    },
    {
      id: 'clean-yarn-cache',
      category: 'yarn-cache',
      label: '清理 Yarn 缓存',
      description: '删除 Yarn Cache',
      path: path.join(localApp, 'Yarn', 'Cache'),
      risk: 'low',
      mode: 'direct',
      action: 'empty-dir',
    },
    {
      id: 'clean-user-cache',
      category: 'temp',
      label: '清理 ~/.cache',
      description: '清空用户 .cache 目录内容',
      path: path.join(HOME, '.cache'),
      risk: 'low',
      mode: 'direct',
      action: 'empty-dir',
    },
    {
      id: 'clean-crash-dumps',
      category: 'crash-dumps',
      label: '清理崩溃转储',
      description: '删除 Local\\CrashDumps',
      path: path.join(localApp, 'CrashDumps'),
      risk: 'low',
      mode: 'direct',
      action: 'empty-dir',
    },
    {
      id: 'clean-windows-temp',
      category: 'system-temp',
      label: '清理 Windows\\Temp',
      description: '尝试清空 C:\\Windows\\Temp（可能需管理员，跳过占用文件）',
      path: 'C:\\Windows\\Temp',
      risk: 'medium',
      mode: 'quarantine',
      action: 'empty-dir',
    },
    {
      id: 'clean-windows-logs',
      category: 'temp-logs',
      label: '清理 Windows\\Logs（部分）',
      description: '清理明显临时日志；不确定项进隔离区',
      path: 'C:\\Windows\\Logs',
      risk: 'medium',
      mode: 'quarantine',
      action: 'empty-dir',
    },

    {
      id: 'clean-docker-build-cache',
      category: 'docker-cache',
      label: '清理 Docker Build Cache',
      description: '执行 docker builder prune -f（仅构建缓存，需确认；不自动执行）',
      path: '(docker build cache)',
      risk: 'low',
      mode: 'direct',
      action: 'docker-prune',
      pruneKind: 'build-cache',
    },
    {
      id: 'clean-docker-dangling-images',
      category: 'docker-cache',
      label: '清理 Docker dangling 镜像',
      description: '执行 docker image prune -f（仅无标签镜像，需确认）',
      path: '(docker dangling images)',
      risk: 'low',
      mode: 'direct',
      action: 'docker-prune',
      pruneKind: 'dangling-images',
    },
    {
      id: 'clean-docker-unused-images',
      category: 'docker-prune',
      label: '清理 Docker 未使用镜像',
      description: '执行 docker image prune -a -f（删除所有未被容器使用的镜像，需确认；比 dangling 更激进）',
      path: '(docker unused images)',
      risk: 'medium',
      mode: 'quarantine',
      action: 'docker-prune',
      pruneKind: 'unused-images',
    },

  ].map((item) => {
    // Enforce policy from config
    const mode = config.LOW_RISK_CATEGORIES.has(item.category) ? 'direct' : 'quarantine';
    return { ...item, mode, checked: false };
  });
}

async function buildChecklist() {
  const items = cleanCatalog();
  const out = [];
  let df = null;
  const needsDf = items.some((i) => i.action === 'docker-prune');
  const totalSteps = items.length + (needsDf ? 1 : 0);
  checklistProgress.begin(totalSteps, '准备清单…');
  let step = 0;
  try {
  if (needsDf) {
    checklistProgress.step(++step, '查询 Docker 占用…');
    try {
      df = await docker.dockerSystemDf();
    } catch (_) {
      df = { ok: false };
    }
  }
  for (const item of items) {
    checklistProgress.step(++step, item.label || item.id);

    if (item.action === 'docker-prune') {
      const cliOk = df && df.ok;
      let size = 0;
      let sizeLabel = '0 B';
      let exists = !!cliOk;
      let extra = { dockerCli: !!cliOk };
      if (cliOk) {
        if (item.pruneKind === 'build-cache') {
          const c = df.byType['Build Cache'] || {};
          size = c.reclaimable || c.size || 0;
          sizeLabel = c.reclaimableLabel || c.sizeLabel || formatBytes(size);
        } else if (item.pruneKind === 'dangling-images') {
          const img = df.byType.Images || {};
          size = 0;
          sizeLabel = 'dangling（见镜像可回收 ' + (img.reclaimableLabel || '0') + '）';
          extra.imagesReclaimableLabel = img.reclaimableLabel || null;
        } else if (item.pruneKind === 'unused-images') {
          const img = df.byType.Images || {};
          size = img.reclaimable || 0;
          sizeLabel = img.reclaimableLabel || formatBytes(size);
        }
      }
      // Enforce: medium unused-images stay quarantine mode via config policy
      const mode = require('./config').LOW_RISK_CATEGORIES.has(item.category) && item.risk === 'low'
        ? 'direct'
        : item.risk === 'low'
          ? 'direct'
          : 'quarantine';
      out.push({
        ...item,
        mode: item.risk === 'low' ? 'direct' : 'quarantine',
        exists,
        size,
        sizeLabel,
        selectable: exists && (size > 0 || item.pruneKind === 'dangling-images'),
        extra,
      });
      continue;
    }
    const exists = fs.existsSync(item.path);
    let size = 0;
    if (exists) size = await dirSizeBytes(item.path);
    out.push({
      ...item,
      exists,
      size,
      sizeLabel: formatBytes(size),
      selectable: exists && size > 0,
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

async function emptyDirContents(dirPath, { dryRun = true } = {}) {
  if (!fs.existsSync(dirPath)) return { deleted: 0, skipped: 0, bytes: 0, dryRun, errors: [] };
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let deleted = 0;
  let skipped = 0;
  let bytes = 0;
  const errors = [];
  for (const ent of entries) {
    const full = path.join(dirPath, ent.name);
    try {
      let sz = 0;
      try {
        if (ent.isFile()) sz = fs.statSync(full).size;
      } catch (_) {
        /* ignore */
      }
      if (dryRun) {
        deleted += 1;
        bytes += sz;
        continue;
      }
      fs.rmSync(full, { recursive: true, force: true });
      deleted += 1;
      bytes += sz;
    } catch (err) {
      skipped += 1;
      errors.push({ path: full, error: String(err.message || err) });
    }
  }
  return { deleted, skipped, bytes, dryRun, errors };
}

async function quarantineThenEmpty(dirPath, { dryRun = true } = {}) {
  if (dryRun) {
    const size = await dirSizeBytes(dirPath);
    return {
      dryRun: true,
      wouldQuarantine: dirPath,
      size,
      sizeLabel: formatBytes(size),
    };
  }
  // Move whole directory aside, recreate empty dir
  const meta = quarantine.moveToQuarantine(dirPath);
  fs.mkdirSync(dirPath, { recursive: true });
  return { dryRun: false, quarantine: meta };
}

/**
 * Execute selected clean items.
 * Requires confirmToken === 'CONFIRM' and dryRun flag.
 */
async function executeClean({ ids = [], dryRun = true, confirmToken } = {}) {
  if (!dryRun && confirmToken !== 'CONFIRM') {
    const err = new Error('需要 confirmToken === "CONFIRM" 才能真实执行');
    err.code = 'NEED_CONFIRM';
    throw err;
  }
  const catalog = cleanCatalog();
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const results = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      results.push({ id, ok: false, error: '未知项目' });
      continue;
    }
    if (item.action === 'docker-prune') {
      try {
        const detail = await docker.runDockerPrune(item.pruneKind, { dryRun });
        logger.info('clean docker prune', { id, dryRun, detail });
        results.push({ id, ok: true, label: item.label, mode: item.mode, detail });
      } catch (err) {
        logger.error('docker prune failed', { id, error: String(err.message || err) });
        results.push({ id, ok: false, error: String(err.message || err) });
      }
      continue;
    }
    if (!fs.existsSync(item.path)) {
      results.push({ id, ok: false, error: '路径不存在', path: item.path });
      continue;
    }
    try {
      let detail;
      if (item.mode === 'direct') {
        detail = await emptyDirContents(item.path, { dryRun });
      } else {
        detail = await quarantineThenEmpty(item.path, { dryRun });
      }
      logger.info('clean execute', { id, dryRun, detail });
      results.push({ id, ok: true, label: item.label, mode: item.mode, detail });
    } catch (err) {
      logger.error('clean failed', { id, error: String(err.message || err) });
      results.push({ id, ok: false, error: String(err.message || err) });
    }
  }
  return { dryRun, results, at: new Date().toISOString() };
}


function getCachedResult() {
  return resultCache.get();
}

function setCachedResult(value) {
  return resultCache.set(value);
}

function clearResultCache() {
  resultCache.clear();
}

module.exports = {
  cleanCatalog,
  buildChecklist,
  getChecklistProgress,
  getCachedResult,
  setCachedResult,
  clearResultCache,
  executeClean,
  emptyDirContents,
};
