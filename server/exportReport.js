'use strict';

const fs = require('fs');
const path = require('path');
const scanPersist = require('./scanPersist');
const clean = require('./clean');
const optimize = require('./optimize');
const suggest = require('./suggest');

function line(s) {
  return String(s == null ? '' : s).replace(/\r?\n/g, ' ');
}

function buildMarkdown() {
  const scan = scanPersist.loadScanResult();
  const fresh = scanPersist.freshness();
  const cleanHit = clean.getCachedResult && clean.getCachedResult();
  const optHit = optimize.getCachedResult && optimize.getCachedResult();
  const sugHit = suggest.getCachedResult && suggest.getCachedResult();

  const lines = [];
  lines.push('# t-DiskPilot 精简报告');
  lines.push('');
  lines.push('- 导出时间：' + new Date().toISOString());
  lines.push('- 扫描时效：' + (fresh.reason || '—'));
  if (fresh.scannedAt) lines.push('- 扫描时间：' + fresh.scannedAt);
  lines.push('');

  lines.push('## 扫描');
  if (!scan) {
    lines.push('（无缓存扫描结果）');
  } else {
    lines.push('- 模式：' + (scan.mode || '—'));
    lines.push('- 目标：' + (scan.target || scan.rootRanking?.path || '—'));
    lines.push('- 用时：' + (scan.durationLabel || '—'));
    if (scan.drive) {
      lines.push(
        '- 磁盘：' +
          [scan.drive.name, scan.drive.usedLabel, '/', scan.drive.totalLabel, '剩余', scan.drive.freeLabel]
            .filter(Boolean)
            .join(' ')
      );
    }
    lines.push('');
    lines.push('### 目录排行');
    const children = scan.rootRanking?.children || [];
    if (!children.length) lines.push('（无）');
    else {
      lines.push('| 名称 | 大小 | 路径 |');
      lines.push('| --- | --- | --- |');
      for (const c of children.slice(0, 40)) {
        lines.push(
          '| ' +
            line(c.name || path.basename(c.path || '')) +
            ' | ' +
            line(c.sizeLabel || c.size || '—') +
            ' | ' +
            line(c.path || '') +
            ' |'
        );
      }
    }
    lines.push('');
    lines.push('### 热点');
    const hs = scan.hotspots || [];
    if (!hs.length) lines.push('（无）');
    else {
      lines.push('| 项 | 大小 | 风险 | 路径 |');
      lines.push('| --- | --- | --- | --- |');
      for (const h of hs.slice(0, 30)) {
        lines.push(
          '| ' +
            line(h.label || h.id) +
            ' | ' +
            line(h.sizeLabel || '—') +
            ' | ' +
            line(h.risk || '—') +
            ' | ' +
            line(h.path || '') +
            ' |'
        );
      }
    }
  }

  lines.push('');
  lines.push('## 清理清单');
  appendChecklist(lines, cleanHit);
  lines.push('');
  lines.push('## 优化清单');
  appendChecklist(lines, optHit);
  lines.push('');
  lines.push('## 建议');
  appendSuggest(lines, sugHit);
  lines.push('');
  lines.push('---');
  lines.push('本报告为精简导出，仅含缓存摘要；完整树与明细以应用内为准。');
  lines.push('');

  const markdown = lines.join('\n');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return {
    markdown,
    suggestedName: 't-DiskPilot-report-' + stamp + '.md',
    bytes: Buffer.byteLength(markdown, 'utf8'),
  };
}

function appendChecklist(lines, hit) {
  const items = hit && hit.value ? hit.value : null;
  if (!items || !items.length) {
    lines.push('（尚未加载或无缓存；请先打开对应页刷新）');
    if (hit && hit.at) lines.push('- 缓存时间：' + hit.at);
    return;
  }
  if (hit.at) lines.push('- 缓存时间：' + hit.at);
  lines.push('| 项 | 大小 | 风险 | 可选 | 路径 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const it of items.slice(0, 50)) {
    lines.push(
      '| ' +
        line(it.label || it.id) +
        ' | ' +
        line(it.sizeLabel || '—') +
        ' | ' +
        line(it.risk || '—') +
        ' | ' +
        (it.selectable ? '是' : '否') +
        ' | ' +
        line(it.path || '') +
        ' |'
    );
  }
}

function appendSuggest(lines, hit) {
  const items = hit && hit.value ? hit.value : null;
  if (!items || !items.length) {
    lines.push('（尚未加载或无缓存；请先打开建议页刷新）');
    if (hit && hit.at) lines.push('- 缓存时间：' + hit.at);
    return;
  }
  if (hit.at) lines.push('- 缓存时间：' + hit.at);
  lines.push('| 建议 | 大小 | 风险 | 路径 |');
  lines.push('| --- | --- | --- | --- |');
  for (const it of items.slice(0, 50)) {
    lines.push(
      '| ' +
        line(it.label || it.title || it.id) +
        ' | ' +
        line(it.sizeLabel || it.extra?.reclaimableLabel || '—') +
        ' | ' +
        line(it.risk || '—') +
        ' | ' +
        line(it.relatedPath || it.path || '') +
        ' |'
    );
  }
}

function writeToPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    const err = new Error('需要保存路径');
    err.code = 'NEED_PATH';
    throw err;
  }
  const abs = path.resolve(filePath);
  if (!abs.toLowerCase().endsWith('.md')) {
    const err = new Error('仅允许保存为 .md 文件');
    err.code = 'BAD_EXT';
    throw err;
  }
  const { markdown, bytes, suggestedName } = buildMarkdown();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, markdown, 'utf8');
  return { ok: true, path: abs, bytes, suggestedName };
}

module.exports = { buildMarkdown, writeToPath };
