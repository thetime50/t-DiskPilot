'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatBytes, dirSizeBytes } = require('./scan');
const docker = require('./docker');
const logger = require('./logger');
const { createLoadProgress } = require('./loadProgress');
const { createResultCache } = require('./resultCache');
const resultCache = createResultCache();

const loadProgress = createLoadProgress();

const HOME = os.homedir();
const localApp = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

function suggestCatalog() {
  return [
    {
      id: 'sug-pip-cache-relocate',
      label: '将 Pip 缓存迁移到其他盘',
      category: 'relocate',
      relatedPath: path.join(localApp, 'pip', 'Cache'),
      risk: 'low',
      guidance: {
        summary: '通过环境变量 PIP_CACHE_DIR 把缓存放到空间更充足的盘（如 D:）',
        steps: [
          '在目标盘创建目录，例如 D:\\caches\\pip',
          '系统设置 → 系统 → 关于 → 高级系统设置 → 环境变量',
          '新建用户变量：PIP_CACHE_DIR = D:\\caches\\pip',
          '或在 PowerShell 用户配置中：[Environment]::SetEnvironmentVariable("PIP_CACHE_DIR","D:\\caches\\pip","User")',
          '确认新缓存生效后，可勾选清理项删除旧的 Local\\pip\\Cache',
        ],
        commands: [
          'New-Item -ItemType Directory -Force -Path "D:\\caches\\pip"',
          '[Environment]::SetEnvironmentVariable("PIP_CACHE_DIR","D:\\caches\\pip","User")',
          'pip cache dir',
        ],
      },
      applyAction: 'set-env-pip-cache',
      applyDefault: { value: 'D:\\caches\\pip' },
    },
    {
      id: 'sug-npm-cache-relocate',
      label: '将 npm 缓存迁移到其他盘',
      category: 'relocate',
      relatedPath: path.join(localApp, 'npm-cache'),
      risk: 'low',
      guidance: {
        summary: '使用 npm config 设置 cache 到 D 盘',
        steps: [
          '创建 D:\\caches\\npm',
          '执行: npm config set cache "D:\\caches\\npm" --global',
          '验证: npm config get cache',
          '确认后可清理旧 npm-cache',
        ],
        commands: [
          'New-Item -ItemType Directory -Force -Path "D:\\caches\\npm"',
          'npm config set cache "D:\\caches\\npm" --global',
          'npm config get cache',
        ],
      },
      applyAction: 'npm-set-cache',
      applyDefault: { value: 'D:\\caches\\npm' },
    },
    {
      id: 'sug-android',
      label: '.android 体积较大 — 评估迁移或清理 AVD',
      category: 'review',
      relatedPath: path.join(HOME, '.android'),
      risk: 'high',
      guidance: {
        summary: 'Android SDK/AVD 数据通常很大；不要直接删整个目录',
        steps: [
          '用 Android Studio → Device Manager 删除不用的模拟器',
          '可将 ANDROID_SDK_ROOT / ANDROID_AVD_HOME 指到 D 盘后迁移',
          '保留 licenses 与必要 platform；清理 system-images 中不用的 API',
        ],
        commands: [
          'Write-Output "请在 Android Studio 中管理 AVD；勿直接 rm .android"',
        ],
      },
      applyAction: null,
    },
    {
      id: 'sug-rustup',
      label: '.rustup / .cargo — 清理旧 toolchain',
      category: 'review',
      relatedPath: path.join(HOME, '.rustup'),
      risk: 'medium',
      guidance: {
        summary: '用 rustup 管理，勿手删关键目录',
        steps: [
          'rustup toolchain list',
          'rustup toolchain uninstall <旧版本>',
          'cargo cache -a（若已安装 cargo-cache）',
        ],
        commands: [
          'rustup toolchain list',
          'rustup help toolchain',
        ],
      },
      applyAction: null,
    },
    {
      id: 'sug-gradle',
      label: '.gradle caches — 可清理缓存',
      category: 'review',
      relatedPath: path.join(HOME, '.gradle'),
      risk: 'medium',
      guidance: {
        summary: '可删 caches 与 wrapper/dists 中旧版本；项目会重新下载',
        steps: [
          '检查 .gradle\\caches 大小',
          '确认无正在运行的 Gradle 构建后，可清理 caches',
          '或设置 GRADLE_USER_HOME 到 D 盘',
        ],
        commands: [
          '[Environment]::SetEnvironmentVariable("GRADLE_USER_HOME","D:\\caches\\gradle","User")',
        ],
      },
      applyAction: 'set-env-gradle-home',
      applyDefault: { value: 'D:\\caches\\gradle' },
    },
    {
      id: 'sug-vscode',
      label: '.vscode / 扩展缓存复查',
      category: 'review',
      relatedPath: path.join(HOME, '.vscode'),
      risk: 'medium',
      guidance: {
        summary: '卸载不用的扩展；清理 CachedExtensionVSIXs 等',
        steps: [
          '在 VS Code / Cursor 中卸载不用扩展',
          '可检查 AppData\\Roaming\\Code\\CachedExtensionVSIXs',
        ],
        commands: [],
      },
      applyAction: null,
    },
    {
      id: 'sug-docker-prune',
      label: 'Docker 未使用镜像/构建缓存可清理',
      category: 'review',
      relatedPath: null,
      risk: 'medium',
      guidance: {
        summary: '用 docker system df 查看占用；清理前请确认没有需要的未运行容器/镜像',
        steps: [
          '查看: docker system df',
          '仅构建缓存: docker builder prune -f（可在「清理」页勾选确认）',
          '仅 dangling 镜像: docker image prune -f',
          '所有未使用镜像: docker image prune -a -f（更激进，需确认）',
          '勿加 --volumes，除非你明确要删匿名卷',
        ],
        commands: [
          'docker system df',
          'docker builder prune -f',
          'docker image prune -f',
          'docker image prune -a -f',
        ],
      },
      applyAction: null,
      dockerRelated: true,
    },
    {
      id: 'sug-docker-relocate',
      label: 'Docker 数据盘迁移（WSL vhdx / DataFolder）',
      category: 'relocate',
      relatedPath: null,
      risk: 'high',
      guidance: {
        summary: 'Docker Desktop 数据常在 WSL ext4.vhdx；可迁到空间更大的盘，不要直接删 vhdx',
        steps: [
          'Docker Desktop → Settings → Resources → Advanced / Disk image location（或 WSL 数据位置）',
          '也可: wsl --shutdown 后，用 wsl --manage <distro> --move <目标目录>（Windows 11）',
          '本机若已迁到其他盘，建议页会显示检测到的 vhdx 路径与大小',
          '迁移完成后可用「清理」页 prune 未使用镜像进一步回收',
        ],
        commands: [
          'wsl -l -v',
          'docker system df',
        ],
      },
      applyAction: null,
      dockerRelated: true,
    },

  ];
}

async function buildSuggestions() {
  const items = suggestCatalog();
  const out = [];
  let dockerInfo = null;
  loadProgress.begin(items.length + 1, '准备建议…');
  let step = 0;
  try {
  loadProgress.step(++step, '查询 Docker / WSL…');
  try {
    dockerInfo = await docker.collectDockerHotspots({
      dirSizeBytes,
      formatBytes,
    });
  } catch (_) {
    dockerInfo = null;
  }

  for (const item of items) {
    loadProgress.step(++step, item.title || item.label || item.id);

    let exists = item.relatedPath ? fs.existsSync(item.relatedPath) : false;
    let size = 0;
    let extra = {};
    if (exists && item.relatedPath) size = await dirSizeBytes(item.relatedPath);

    if (item.dockerRelated && dockerInfo) {
      exists = !!(dockerInfo.dockerCli || (dockerInfo.wsl && dockerInfo.wsl.length));
      if (item.id === 'sug-docker-prune' && dockerInfo.df && dockerInfo.df.ok) {
        size = dockerInfo.df.reclaimableTotal || 0;
        extra.df = dockerInfo.df.rows;
        extra.reclaimableLabel = formatBytes(size);
      }
      if (item.id === 'sug-docker-relocate') {
        const vhdx = (dockerInfo.hotspots || []).filter(
          (h) => h.isFile || (h.path && /ext4\.vhdx$/i.test(h.path)) || (h.id && h.id.includes('wsl'))
        );
        // prefer largest vhdx hotspot
        const disks = (dockerInfo.hotspots || []).filter(
          (h) => h.path && /\.vhdx$/i.test(String(h.path))
        );
        let best = disks.sort((a, b) => b.size - a.size)[0];
        if (!best) {
          best = (dockerInfo.hotspots || []).find((h) => h.id && h.id.includes('docker-wsl-docker-desktop-data'));
        }
        if (best) {
          exists = !!best.exists;
          size = best.size || 0;
          extra.vhdxPath = best.path;
          extra.distro = best.meta && best.meta.distro;
        }
        if (dockerInfo.settings) {
          extra.settings = {
            dataFolder: dockerInfo.settings.dataFolder,
            customWslDistroDir: dockerInfo.settings.customWslDistroDir,
            diskSizeMiB: dockerInfo.settings.diskSizeMiB,
          };
        }
      }
    }

    out.push({
      ...item,
      exists,
      size,
      sizeLabel: formatBytes(size),
      canApply: Boolean(item.applyAction),
      extra: Object.keys(extra).length ? extra : undefined,
    });
  }
  out.sort((a, b) => b.size - a.size);
  loadProgress.end();
  return out;
  } catch (err) {
    loadProgress.fail(err);
    throw err;
  }
}

function getLoadProgress() {
  return loadProgress.snapshot();
}

async function applySuggestion({ id, dryRun = true, confirmToken, params = {} } = {}) {
  if (!dryRun && confirmToken !== 'CONFIRM') {
    const err = new Error('需要 confirmToken === "CONFIRM" 才能真实执行');
    err.code = 'NEED_CONFIRM';
    throw err;
  }
  const item = suggestCatalog().find((s) => s.id === id);
  if (!item) throw new Error('未知建议');
  if (!item.applyAction) throw new Error('该建议仅供参考，无自动应用动作');

  const value = params.value || (item.applyDefault && item.applyDefault.value);
  if (!value) throw new Error('缺少目标路径 value');

  if (item.applyAction === 'set-env-pip-cache') {
    if (dryRun) {
      return { dryRun: true, wouldSet: { PIP_CACHE_DIR: value } };
    }
    await setUserEnv('PIP_CACHE_DIR', value);
    ensureDir(value);
    logger.info('applied pip cache relocate', { value });
    return { dryRun: false, set: { PIP_CACHE_DIR: value } };
  }
  if (item.applyAction === 'set-env-gradle-home') {
    if (dryRun) {
      return { dryRun: true, wouldSet: { GRADLE_USER_HOME: value } };
    }
    await setUserEnv('GRADLE_USER_HOME', value);
    ensureDir(value);
    logger.info('applied gradle home relocate', { value });
    return { dryRun: false, set: { GRADLE_USER_HOME: value } };
  }
  if (item.applyAction === 'npm-set-cache') {
    if (dryRun) {
      return { dryRun: true, wouldRun: `npm config set cache "${value}" --global` };
    }
    ensureDir(value);
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('npm', ['config', 'set', 'cache', value, '--global'], {
      windowsHide: true,
      shell: true,
    });
    logger.info('applied npm cache relocate', { value });
    return { dryRun: false, set: { npmCache: value } };
  }
  throw new Error('未实现的 applyAction');
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function setUserEnv(name, value) {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const ps = `[Environment]::SetEnvironmentVariable('${name.replace(/'/g, "''")}','${String(value).replace(/'/g, "''")}','User')`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
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
  suggestCatalog,
  buildSuggestions,
  getLoadProgress,
  getCachedResult,
  setCachedResult,
  clearResultCache,
  applySuggestion,
};
