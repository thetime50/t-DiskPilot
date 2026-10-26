'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SKIP_DIR_NAMES = new Set([
  '$Recycle.Bin',
  'System Volume Information',
  'Recovery',
  'Config.Msi',
  'PerfLogs',
]);

function shortName(name, max = 18) {
  const s = String(name || '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(4, max - 1)) + '…';
}

function formatBreadcrumb(stack) {
  // Long paths: first 5 segments ... last 5 segments
  const HEAD = 5;
  const TAIL = 5;
  const parts =
    stack.length > HEAD + TAIL
      ? [...stack.slice(0, HEAD), null, ...stack.slice(-TAIL)]
      : stack;
  return parts
    .map((s) =>
      s == null ? '...' : `${shortName(s.name)}(${s.index}/${s.count})`
    )
    .join('/')
    .replace('.../', '...\n');
}

/**
 * Async DFS walk with progress. Yields to event loop periodically.
 * @returns {{ totalSize, children, fileCount, dirCount, cancelled }}
 */
async function walkRank(root, options = {}) {
  const {
    onProgress,
    shouldCancel,
    totalBytesEstimate = 0,
    progressMinIntervalMs = 120,
    progressMinBytes = 8 * 1024 * 1024, // 8 MB
    yieldEvery = 64,
  } = options;

  const absRoot = path.resolve(root);
  let scannedBytes = 0;
  let fileCount = 0;
  let dirCount = 0;
  let entriesSeen = 0;
  let cancelled = false;
  let lastEmitAt = 0;
  let lastEmitBytes = 0;
  let currentPath = absRoot;
  let breadcrumb = '';

  const topChildren = []; // { name, path, isDir, size, durationMs }
  const topIndex = new Map(); // name -> index in topChildren
  const walkStartedAt = Date.now();

  function emit(force = false) {
    if (!onProgress) return;
    const now = Date.now();
    const bytesDelta = scannedBytes - lastEmitBytes;
    if (
      !force &&
      now - lastEmitAt < progressMinIntervalMs &&
      bytesDelta < progressMinBytes
    ) {
      return;
    }
    lastEmitAt = now;
    lastEmitBytes = scannedBytes;
    const total = totalBytesEstimate > 0 ? totalBytesEstimate : Math.max(scannedBytes, 1);
    const percent = Math.min(99.9, Math.round((scannedBytes / total) * 1000) / 10);
    onProgress({
      scannedBytes,
      totalBytes: totalBytesEstimate || scannedBytes,
      percent: totalBytesEstimate > 0 ? percent : 0,
      currentPath,
      breadcrumb,
      fileCount,
      dirCount,
    });
  }

  async function listDir(dir) {
    try {
      return await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  async function walkDir(dir, stack, topKey) {
    if (shouldCancel && shouldCancel()) {
      cancelled = true;
      return 0;
    }

    const entries = await listDir(dir);
    // Sort for stable sibling indices (dirs first then name)
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let dirSize = 0;
    const count = entries.length;

    for (let i = 0; i < count; i++) {
      if (shouldCancel && shouldCancel()) {
        cancelled = true;
        break;
      }

      const ent = entries[i];
      const full = path.join(dir, ent.name);
      currentPath = full;
      breadcrumb = formatBreadcrumb([
        ...stack,
        { name: ent.name, index: i + 1, count },
      ]);

      entriesSeen += 1;
      if (entriesSeen % yieldEvery === 0) {
        emit(false);
        await new Promise((r) => setImmediate(r));
      }

      let isDir = false;
      try {
        isDir = ent.isDirectory();
        // Follow neither junctions nor symlinks as directories to avoid cycles
        if (isDir && typeof ent.isSymbolicLink === 'function' && ent.isSymbolicLink()) {
          isDir = false;
        }
      } catch {
        continue;
      }

      if (isDir) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        // Skip symlinks / junctions (avoid cycles on Windows)
        try {
          const st = await fsp.lstat(full);
          if (st.isSymbolicLink()) continue;
        } catch {
          continue;
        }

        dirCount += 1;
        const childStack = [
          ...stack,
          { name: ent.name, index: i + 1, count },
        ];
        const childTopKey = topKey != null ? topKey : ent.name;
        const childStartedAt = Date.now();
        const sub = await walkDir(full, childStack, childTopKey);
        const childDurationMs = Date.now() - childStartedAt;
        dirSize += sub;

        // If this is a direct child of root, record it
        if (stack.length === 0) {
          const idx = topIndex.get(ent.name);
          if (idx != null) {
            topChildren[idx].size = sub;
            topChildren[idx].durationMs = childDurationMs;
          } else {
            topIndex.set(ent.name, topChildren.length);
            topChildren.push({
              name: ent.name,
              path: full,
              isDir: true,
              size: sub,
              durationMs: childDurationMs,
            });
          }
        }
      } else {
        // file or symlink-as-file
        let size = 0;
        try {
          const st = await fsp.lstat(full);
          if (st.isFile()) {
            size = Number(st.size) || 0;
          } else if (st.isSymbolicLink()) {
            size = 0;
          } else {
            size = Number(st.size) || 0;
          }
        } catch {
          size = 0;
        }
        fileCount += 1;
        scannedBytes += size;
        dirSize += size;

        if (stack.length === 0) {
          // file at root level
          topIndex.set(ent.name, topChildren.length);
          topChildren.push({
            name: ent.name,
            path: full,
            isDir: false,
            size,
            durationMs: 0,
          });
        } else if (topKey != null) {
          // size attributed via parent walk return value
        }
      }
    }

    emit(false);
    return dirSize;
  }

  // Seed: ensure we list root-level even if empty walk
  breadcrumb = shortName(path.basename(absRoot) || absRoot) + '(—)';
  currentPath = absRoot;
  emit(true);

  const rootSize = await walkDir(absRoot, [], null);

  // Sort children by size desc
  topChildren.sort((a, b) => b.size - a.size);

  emit(true);

  const durationMs = Date.now() - walkStartedAt;

  return {
    path: absRoot,
    total: rootSize,
    children: topChildren,
    fileCount,
    dirCount,
    scannedBytes,
    durationMs,
    cancelled,
  };
}

/**
 * Measure a single directory size with optional progress (no ranking).
 */
async function measureDir(target, options = {}) {
  const result = await walkRank(target, options);
  return {
    path: result.path,
    size: result.total,
    fileCount: result.fileCount,
    dirCount: result.dirCount,
    cancelled: result.cancelled,
  };
}

module.exports = {
  walkRank,
  measureDir,
  formatBreadcrumb,
  shortName,
  SKIP_DIR_NAMES,
};
