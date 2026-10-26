/* t-DiskPilot UI */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const state = {
    cleanItems: [],
    optItems: [],
    sugItems: [],
    pollTimer: null,
    uiDebounceTimer: null,
    lastUiProgress: null,
  };

  const UI_DEBOUNCE_MS = 150;
  const POLL_MS = 200;

  function log(el, data) {
    el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  async function api(url, opts) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
      ...opts,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
    return data;
  }

  // Tabs
  $$('#tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#tabs .tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
      if (btn.dataset.tab === 'clean' && !state.cleanItems.length) refreshClean();
      if (btn.dataset.tab === 'optimize' && !state.optItems.length) refreshOpt();
      if (btn.dataset.tab === 'suggest' && !state.sugItems.length) refreshSug();
      if (btn.dataset.tab === 'quarantine') refreshQ();
    });
  });

  async function initHealth() {
    try {
      const h = await api('/api/health');
      $('#healthBadge').textContent = `就绪 · 隔离区 ${h.quarantineRoot}`;
      $('#qRoot').textContent = h.quarantineRoot;
      if (h.scan && h.scan.status === 'running') {
        setScanningUi(true);
        startPolling();
      }
    } catch (err) {
      $('#healthBadge').textContent = '无法连接后端';
    }
  }

  async function loadDrives() {
    const { drives } = await api('/api/drives');
    const sel = $('#driveSelect');
    sel.innerHTML = '';
    (drives || []).forEach((d) => {
      if (!d.name) return;
      const opt = document.createElement('option');
      opt.value = d.name;
      opt.textContent = `${d.name}:  ${d.usedLabel || ''} / ${d.totalLabel || ''} (剩余 ${d.freeLabel || ''})`;
      if (String(d.name).toUpperCase() === 'C') opt.selected = true;
      sel.appendChild(opt);
    });
    renderDriveCards(drives || []);
  }

  function renderDriveCards(drives) {
    const wrap = $('#driveCards');
    wrap.innerHTML = '';
    drives.forEach((d) => {
      if (!d.name) return;
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `
        <div class="label">${d.name}:</div>
        <div class="value">${d.freeLabel || '—'} 可用</div>
        <div class="muted" style="font-size:0.8rem;margin-top:4px">已用 ${d.usedLabel || '—'} / ${d.totalLabel || '—'}</div>
        <div class="bar"><i style="width:${Math.min(100, d.usedPct || 0)}%"></i></div>
      `;
      wrap.appendChild(el);
    });
  }

  function renderRanking(ranking, scanMeta) {
    const wrap = $('#rankingWrap');
    if (!ranking) {
      wrap.textContent = '无数据';
      return;
    }
    if (ranking.error) {
      wrap.innerHTML = '<span class="muted">错误：' + escapeHtml(ranking.error) + '</span>';
      return;
    }
    const rows = (ranking.children || [])
      .slice(0, 40)
      .map(
        (c) =>
          '<tr>' +
          '<td>' + (c.isDir ? '📁' : '📄') + ' ' + escapeHtml(c.name) + '</td>' +
          '<td>' + (c.sizeLabel || '—') + '</td>' +
          '<td class="mono duration-cell">' + (c.durationLabel || '—') + '</td>' +
          '<td class="mono">' + escapeHtml(c.path) + '</td>' +
          '</tr>'
      )
      .join('');
    const partial = ranking.partial ? ' <span class="tag medium">部分结果</span>' : '';
    const rankingDur =
      ranking.durationLabel ||
      (scanMeta && scanMeta.rankingDurationLabel) ||
      '—';
    const totalDur =
      (scanMeta && scanMeta.durationLabel) ||
      ranking.durationLabel ||
      '—';
    const durLine =
      totalDur !== rankingDur && scanMeta && scanMeta.durationLabel
        ? ' · 扫描用时 ' + totalDur + '（排行 ' + rankingDur + '）'
        : ' · 扫描用时 ' + (rankingDur !== '—' ? rankingDur : totalDur);
    wrap.innerHTML =
      '<p class="muted">路径：<span class="mono">' +
      escapeHtml(ranking.path || '') +
      '</span> · 合计 ' +
      (ranking.totalLabel || '—') +
      durLine +
      partial +
      '</p>' +
      '<table>' +
      '<thead><tr><th>名称</th><th>大小</th><th>用时</th><th>路径</th></tr></thead>' +
      '<tbody>' +
      (rows || '<tr><td colspan="4">空</td></tr>') +
      '</tbody></table>';
  }

function renderHotspots(hotspots) {
    const wrap = $('#hotspotWrap');
    if (!hotspots) {
      wrap.textContent = '无数据';
      return;
    }
    const rows = hotspots
      .map(
        (h) => `<tr>
        <td>${escapeHtml(h.label)}</td>
        <td>${h.exists ? h.sizeLabel : '不存在'}</td>
        <td><span class="tag ${h.risk}">${h.risk}</span>
            <span class="tag">${h.category}</span></td>
        <td class="mono">${escapeHtml(h.path)}</td>
      </tr>`
      )
      .join('');
    wrap.innerHTML = `<table>
      <thead><tr><th>热点</th><th>大小</th><th>标记</th><th>路径</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function setScanningUi(running) {
    $('#btnScanDrive').disabled = running;
    $('#btnScanPath').disabled = running;
    $('#btnScanHotspots').disabled = running;
    $('#btnCancelScan').disabled = !running;
  }

  function applyProgressToDom(p) {
    const statusMap = {
      idle: '空闲',
      running: '扫描中…',
      done: '完成',
      error: '出错',
      cancelled: '已取消',
    };
    $('#scanStatusText').textContent = statusMap[p.status] || p.status;
    const pct = p.percent != null ? p.percent : 0;
    const bar = $('#scanProgressBar');
    if (p.status === 'running' && (!p.totalBytes || p.percent === 0)) {
      bar.style.width = '100%';
      bar.classList.add('indeterminate');
      $('#scanPercentText').textContent = '…';
    } else {
      bar.classList.remove('indeterminate');
      bar.style.width = `${Math.min(100, pct)}%`;
      $('#scanPercentText').textContent = `${pct}%`;
    }
    const durPart = p.durationLabel ? ` · 用时 ${p.durationLabel}` : '';
    $('#scanBytesText').textContent = `已扫描 ${p.scannedLabel || '—'} / ${p.totalLabel || '—'} · 文件 ${p.fileCount || 0} · 目录 ${p.dirCount || 0}${durPart}`;
    const bc = p.breadcrumb || '—';
    const cp = p.currentPath || '—';
    const bcEl = $('#scanBreadcrumb');
    const cpEl = $('#scanCurrentPath');
    bcEl.textContent = bc;
    bcEl.title = bc;
    cpEl.textContent = `当前位置：${cp}`;
    cpEl.title = cp;
  }

  /** Debounce DOM updates so tiny-file storms don't thrash the UI. */
  function scheduleProgressUi(p) {
    state.lastUiProgress = p;
    if (state.uiDebounceTimer) return;
    state.uiDebounceTimer = setTimeout(() => {
      state.uiDebounceTimer = null;
      if (state.lastUiProgress) applyProgressToDom(state.lastUiProgress);
    }, UI_DEBOUNCE_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(pollProgress, POLL_MS);
    pollProgress();
  }

  async function pollProgress() {
    try {
      const p = await api('/api/scan/progress');
      scheduleProgressUi(p);
      if (p.status === 'running') {
        setScanningUi(true);
        return;
      }
      // terminal
      stopPolling();
      setScanningUi(false);
      if (state.uiDebounceTimer) {
        clearTimeout(state.uiDebounceTimer);
        state.uiDebounceTimer = null;
      }
      applyProgressToDom(p);
      if (p.status === 'done' || p.status === 'cancelled') {
        const full = await api('/api/scan/result');
        const result = full.result;
        if (result) {
          if (result.drives) renderDriveCards(result.drives);
          if (result.rootRanking) renderRanking(result.rootRanking, result);
          if (result.hotspots) renderHotspots(result.hotspots);
          else if (p.status === 'cancelled') {
            $('#hotspotWrap').textContent = '已取消，热点未测完';
          }
        }
      } else if (p.status === 'error') {
        $('#rankingWrap').innerHTML = `<span class="muted">错误：${escapeHtml(p.error || '未知')}</span>`;
      }
    } catch (err) {
      // keep polling briefly on transient errors
      console.warn('progress poll', err);
    }
  }

  async function startScan(body) {
    $('#rankingWrap').textContent = '扫描中…';
    $('#hotspotWrap').textContent = body.path ? '路径扫描不测热点' : '扫描中…';
    applyProgressToDom({
      status: 'running',
      percent: 0,
      scannedLabel: '0 B',
      totalLabel: '—',
      breadcrumb: '启动中',
      currentPath: body.path || `${body.drive || 'C'}:\\`,
      fileCount: 0,
      dirCount: 0,
    });
    setScanningUi(true);
    try {
      await api('/api/scan/start', { method: 'POST', body: JSON.stringify(body) });
      startPolling();
    } catch (err) {
      setScanningUi(false);
      $('#rankingWrap').textContent = String(err.message || err);
    }
  }

  $('#btnScanDrive').addEventListener('click', () => {
    const drive = $('#driveSelect').value || 'C';
    startScan({ drive, hotspots: true });
  });

  $('#btnScanPath').addEventListener('click', () => {
    const p = $('#pathInput').value.trim();
    if (!p) return alert('请输入路径');
    startScan({ path: p, hotspots: false });
  });

  $('#btnScanHotspots').addEventListener('click', async () => {
    $('#hotspotWrap').textContent = '扫描热点中…';
    try {
      const data = await api('/api/hotspots');
      renderHotspots(data.hotspots);
    } catch (err) {
      $('#hotspotWrap').textContent = String(err.message || err);
    }
  });

  $('#btnCancelScan').addEventListener('click', async () => {
    try {
      await api('/api/scan/cancel', { method: 'POST', body: '{}' });
    } catch (err) {
      console.warn(err);
    }
  });

  // ---- Clean ----
  function selectedCleanIds() {
    return $$('#cleanList input[type=checkbox]:checked').map((c) => c.value);
  }

  function updateCleanCount() {
    $('#cleanSelCount').textContent = `已选 ${selectedCleanIds().length} 项`;
  }

  function renderCleanList(items) {
    state.cleanItems = items;
    const wrap = $('#cleanList');
    wrap.innerHTML = '';
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'item' + (item.selectable ? '' : ' disabled');
      el.innerHTML = `
        <div><input type="checkbox" value="${item.id}" ${item.selectable ? '' : 'disabled'} /></div>
        <div>
          <h3>${escapeHtml(item.label)}</h3>
          <p>${escapeHtml(item.description || '')}</p>
          <div class="meta">
            <span class="tag ${item.risk}">风险 ${item.risk}</span>
            <span class="tag ${item.mode}">${item.mode === 'direct' ? '确认后直接删' : '先隔离'}</span>
            <span class="tag">${item.sizeLabel}</span>
          </div>
          <p class="mono muted" style="margin-top:6px">${escapeHtml(item.path)}</p>
        </div>
        <div></div>`;
      wrap.appendChild(el);
    });
    $$('#cleanList input[type=checkbox]').forEach((c) => c.addEventListener('change', updateCleanCount));
    updateCleanCount();
  }

  async function refreshClean() {
    $('#cleanList').innerHTML = '<p class="muted">加载清理清单并估算大小…</p>';
    try {
      const data = await api('/api/clean/checklist');
      renderCleanList(data.items || []);
    } catch (err) {
      $('#cleanList').textContent = String(err.message || err);
    }
  }

  $('#btnRefreshClean').addEventListener('click', refreshClean);
  $('#btnSelectAllClean').addEventListener('click', () => {
    $$('#cleanList input[type=checkbox]:not(:disabled)').forEach((c) => {
      c.checked = true;
    });
    updateCleanCount();
  });
  $('#btnClearClean').addEventListener('click', () => {
    $$('#cleanList input[type=checkbox]').forEach((c) => {
      c.checked = false;
    });
    updateCleanCount();
  });

  $('#btnDryClean').addEventListener('click', async () => {
    const ids = selectedCleanIds();
    if (!ids.length) return alert('请先勾选项目');
    try {
      const result = await api('/api/clean/execute', {
        method: 'POST',
        body: JSON.stringify({ ids, dryRun: true }),
      });
      log($('#cleanLog'), result);
    } catch (err) {
      log($('#cleanLog'), err.data || err.message);
    }
  });

  $('#btnConfirmClean').addEventListener('click', () => {
    if (!selectedCleanIds().length) return alert('请先勾选项目');
    $('#cleanConfirm').classList.add('show');
  });
  $('#btnCancelClean').addEventListener('click', () => {
    $('#cleanConfirm').classList.remove('show');
    $('#cleanConfirmInput').value = '';
  });
  $('#btnDoClean').addEventListener('click', async () => {
    const token = $('#cleanConfirmInput').value.trim();
    if (token !== 'CONFIRM') return alert('请输入 CONFIRM');
    const ids = selectedCleanIds();
    try {
      const result = await api('/api/clean/execute', {
        method: 'POST',
        body: JSON.stringify({ ids, dryRun: false, confirmToken: 'CONFIRM' }),
      });
      log($('#cleanLog'), result);
      $('#cleanConfirm').classList.remove('show');
      $('#cleanConfirmInput').value = '';
      refreshClean();
    } catch (err) {
      log($('#cleanLog'), err.data || err.message);
    }
  });

  // ---- Optimize ----
  function selectedOptIds() {
    return $$('#optList input[type=checkbox]:checked').map((c) => c.value);
  }

  function renderOptList(items) {
    state.optItems = items;
    const wrap = $('#optList');
    wrap.innerHTML = '';
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'item' + (item.selectable ? '' : ' disabled');
      const extra = item.extra ? `<pre class="log" style="max-height:120px">${escapeHtml(JSON.stringify(item.extra, null, 2))}</pre>` : '';
      el.innerHTML = `
        <div><input type="checkbox" value="${item.id}" ${item.selectable ? '' : 'disabled'} /></div>
        <div>
          <h3>${escapeHtml(item.label)}</h3>
          <p>${escapeHtml(item.description || '')}</p>
          <div class="meta">
            <span class="tag ${item.risk}">风险 ${item.risk}</span>
            <span class="tag">${item.sizeLabel}</span>
          </div>
          ${item.path ? `<p class="mono muted" style="margin-top:6px">${escapeHtml(item.path)}</p>` : ''}
          ${item.notes ? `<p class="muted" style="margin-top:4px">${escapeHtml(item.notes)}</p>` : ''}
          ${extra}
        </div>
        <div></div>`;
      wrap.appendChild(el);
    });
  }

  async function refreshOpt() {
    $('#optList').innerHTML = '<p class="muted">加载优化清单…</p>';
    try {
      const data = await api('/api/optimize/checklist');
      renderOptList(data.items || []);
    } catch (err) {
      $('#optList').textContent = String(err.message || err);
    }
  }

  $('#btnRefreshOpt').addEventListener('click', refreshOpt);
  $('#btnDryOpt').addEventListener('click', async () => {
    const ids = selectedOptIds();
    if (!ids.length) return alert('请先勾选');
    try {
      log($('#optLog'), await api('/api/optimize/execute', { method: 'POST', body: JSON.stringify({ ids, dryRun: true }) }));
    } catch (err) {
      log($('#optLog'), err.data || err.message);
    }
  });
  $('#btnConfirmOpt').addEventListener('click', () => {
    if (!selectedOptIds().length) return alert('请先勾选');
    $('#optConfirm').classList.add('show');
  });
  $('#btnCancelOpt').addEventListener('click', () => {
    $('#optConfirm').classList.remove('show');
    $('#optConfirmInput').value = '';
  });
  $('#btnDoOpt').addEventListener('click', async () => {
    if ($('#optConfirmInput').value.trim() !== 'CONFIRM') return alert('请输入 CONFIRM');
    try {
      log(
        $('#optLog'),
        await api('/api/optimize/execute', {
          method: 'POST',
          body: JSON.stringify({ ids: selectedOptIds(), dryRun: false, confirmToken: 'CONFIRM' }),
        })
      );
      $('#optConfirm').classList.remove('show');
      refreshOpt();
    } catch (err) {
      log($('#optLog'), err.data || err.message);
    }
  });

  // ---- Suggest ----
  function renderSugList(items) {
    state.sugItems = items;
    const wrap = $('#sugList');
    wrap.innerHTML = '';
    items.forEach((item) => {
      const g = item.guidance || {};
      const steps = (g.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
      const cmds = (g.commands || []).map((c) => `<div><code>${escapeHtml(c)}</code></div>`).join('');
      const applyBtn = item.canApply
        ? `<div class="row" style="margin-top:8px">
            <input type="text" data-apply-value="${item.id}" value="${escapeHtml((item.applyDefault && item.applyDefault.value) || '')}" />
            <button class="btn secondary" data-dry-apply="${item.id}">预演应用</button>
            <button class="btn ok" data-apply="${item.id}">确认应用…</button>
          </div>`
        : '<p class="muted" style="margin-top:8px">仅指导，无自动应用</p>';
      const el = document.createElement('div');
      el.className = 'item';
      el.style.gridTemplateColumns = '1fr';
      el.innerHTML = `
        <div>
          <h3>${escapeHtml(item.label)} <span class="tag">${item.sizeLabel}</span>
            <span class="tag ${item.risk}">${item.risk}</span></h3>
          <p class="mono muted">${escapeHtml(item.relatedPath || '')}</p>
          <div class="guide">
            <strong>${escapeHtml(g.summary || '')}</strong>
            <ol>${steps}</ol>
            ${cmds ? `<div style="margin-top:8px">${cmds}</div>` : ''}
          </div>
          ${applyBtn}
        </div>`;
      wrap.appendChild(el);
    });

    $$('[data-dry-apply]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-dry-apply');
        const value = $(`[data-apply-value="${id}"]`).value.trim();
        try {
          log($('#sugLog'), await api('/api/suggest/apply', { method: 'POST', body: JSON.stringify({ id, dryRun: true, params: { value } }) }));
        } catch (err) {
          log($('#sugLog'), err.data || err.message);
        }
      });
    });
    $$('[data-apply]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-apply');
        const value = $(`[data-apply-value="${id}"]`).value.trim();
        if (!confirm('将真实修改配置/环境变量。继续？请在下一步输入 CONFIRM。')) return;
        const token = prompt('输入 CONFIRM 确认应用：');
        if (token !== 'CONFIRM') return alert('已取消');
        try {
          log(
            $('#sugLog'),
            await api('/api/suggest/apply', {
              method: 'POST',
              body: JSON.stringify({ id, dryRun: false, confirmToken: 'CONFIRM', params: { value } }),
            })
          );
        } catch (err) {
          log($('#sugLog'), err.data || err.message);
        }
      });
    });
  }

  async function refreshSug() {
    $('#sugList').innerHTML = '<p class="muted">加载建议…</p>';
    try {
      const data = await api('/api/suggest');
      renderSugList(data.items || []);
    } catch (err) {
      $('#sugList').textContent = String(err.message || err);
    }
  }
  $('#btnRefreshSug').addEventListener('click', refreshSug);

  // ---- Quarantine ----
  async function refreshQ() {
    try {
      const data = await api('/api/quarantine');
      $('#qRoot').textContent = data.root;
      const wrap = $('#qList');
      if (!data.items || !data.items.length) {
        wrap.innerHTML = '<p class="muted">隔离区为空</p>';
        return;
      }
      wrap.innerHTML = data.items
        .map(
          (it) => `<div class="item" style="grid-template-columns:1fr auto">
          <div>
            <h3>${escapeHtml(it.name)}</h3>
            <p class="mono muted">${escapeHtml(it.path)}</p>
            ${it.meta ? `<p class="muted">来源：${escapeHtml(it.meta.src || '')}</p>` : ''}
          </div>
          <div class="row">
            <button class="btn secondary" data-q-restore="${escapeHtml(it.name)}">还原</button>
            <button class="btn danger" data-q-del="${escapeHtml(it.name)}">永久删除</button>
          </div>
        </div>`
        )
        .join('');
      $$('[data-q-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-q-del');
          if (prompt('永久删除隔离项。输入 CONFIRM：') !== 'CONFIRM') return;
          log($('#qLog'), await api('/api/quarantine/delete', { method: 'POST', body: JSON.stringify({ name, dryRun: false, confirmToken: 'CONFIRM' }) }));
          refreshQ();
        });
      });
      $$('[data-q-restore]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-q-restore');
          if (prompt('还原到原路径。输入 CONFIRM：') !== 'CONFIRM') return;
          log($('#qLog'), await api('/api/quarantine/restore', { method: 'POST', body: JSON.stringify({ name, dryRun: false, confirmToken: 'CONFIRM' }) }));
          refreshQ();
        });
      });
    } catch (err) {
      $('#qList').textContent = String(err.message || err);
    }
  }
  $('#btnRefreshQ').addEventListener('click', refreshQ);

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // boot
  initHealth();
  loadDrives().catch((err) => {
    $('#driveCards').textContent = String(err.message || err);
  });
})();
