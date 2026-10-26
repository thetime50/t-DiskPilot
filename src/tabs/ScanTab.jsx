import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import RankingBarChart from '../charts/RankingBarChart.jsx';

const UI_DEBOUNCE_MS = 150;
const POLL_MS = 200;

const STATUS_MAP = {
  idle: '空闲',
  running: '扫描中…',
  done: '完成',
  error: '出错',
  cancelled: '已取消',
};

export default function ScanTab({ initialScan }) {
  const [drives, setDrives] = useState([]);
  const [drive, setDrive] = useState('C');
  const [pathInput, setPathInput] = useState('');
  const [progress, setProgress] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [scanMeta, setScanMeta] = useState(null);
  const [hotspots, setHotspots] = useState(null);
  const [rankingMsg, setRankingMsg] = useState('尚未扫描');
  const [hotspotMsg, setHotspotMsg] = useState('尚未扫描');
  const pollRef = useRef(null);
  const debounceRef = useRef(null);
  const lastProgressRef = useRef(null);
  const scanning = progress?.status === 'running';

  const applyProgress = useCallback((p) => setProgress(p), []);

  const scheduleProgress = useCallback(
    (p) => {
      lastProgressRef.current = p;
      if (debounceRef.current) return;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (lastProgressRef.current) applyProgress(lastProgressRef.current);
      }, UI_DEBOUNCE_MS);
    },
    [applyProgress]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const finishProgress = useCallback(
    async (p) => {
      stopPolling();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      applyProgress(p);
      if (p.status === 'done' || p.status === 'cancelled') {
        try {
          const full = await api('/api/scan/result');
          const result = full.result;
          if (result) {
            if (result.drives) setDrives(result.drives);
            if (result.rootRanking) {
              setRanking(result.rootRanking);
              setScanMeta(result);
              setRankingMsg('');
            }
            if (result.hotspots) {
              setHotspots(result.hotspots);
              setHotspotMsg('');
            } else if (p.status === 'cancelled') {
              setHotspotMsg('已取消，热点未测量');
            }
          }
        } catch (err) {
          setRankingMsg(String(err.message || err));
        }
      } else if (p.status === 'error') {
        setRankingMsg('错误：' + (p.error || '未知'));
      }
    },
    [applyProgress, stopPolling]
  );

  const pollProgress = useCallback(async () => {
    try {
      const p = await api('/api/scan/progress');
      if (p.status === 'running') {
        scheduleProgress(p);
        return;
      }
      await finishProgress(p);
    } catch (err) {
      console.warn('progress poll', err);
    }
  }, [finishProgress, scheduleProgress]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(pollProgress, POLL_MS);
    pollProgress();
  }, [pollProgress, stopPolling]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { drives: list } = await api('/api/drives');
        if (cancelled) return;
        setDrives(list || []);
        const hasC = (list || []).some((d) => String(d.name).toUpperCase() === 'C');
        if (hasC) setDrive('C');
        else if (list?.[0]?.name) setDrive(list[0].name);
      } catch (err) {
        if (!cancelled) setRankingMsg(String(err.message || err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialScan?.status === 'running') {
      setProgress(initialScan);
      startPolling();
    }
    return () => {
      stopPolling();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [initialScan, startPolling, stopPolling]);

  async function startScan(body) {
    setRanking(null);
    setHotspots(null);
    setRankingMsg('扫描中…');
    setHotspotMsg(body.path ? '路径扫描不测热点' : '扫描中…');
    applyProgress({
      status: 'running',
      percent: 0,
      scannedLabel: '0 B',
      totalLabel: '—',
      breadcrumb: '启动中',
      currentPath: body.path || `${body.drive || 'C'}:\\`,
      fileCount: 0,
      dirCount: 0,
    });
    try {
      await api('/api/scan/start', { method: 'POST', body: JSON.stringify(body) });
      startPolling();
    } catch (err) {
      applyProgress({ status: 'error', error: String(err.message || err), percent: 0 });
      setRankingMsg(String(err.message || err));
    }
  }

  async function cancelScan() {
    try {
      await api('/api/scan/cancel', { method: 'POST', body: '{}' });
    } catch (err) {
      console.warn(err);
    }
  }

  async function scanHotspotsOnly() {
    setHotspotMsg('扫描热点中…');
    try {
      const data = await api('/api/hotspots');
      setHotspots(data.hotspots);
      setHotspotMsg('');
    } catch (err) {
      setHotspotMsg(String(err.message || err));
    }
  }

  const pct = progress?.percent != null ? progress.percent : 0;
  const indeterminate =
    progress?.status === 'running' && (!progress.totalBytes || progress.percent === 0);

  return (
    <>
      <div className="panel">
        <h2>磁盘容量</h2>
        <div className="flex flex-wrap gap-2.5 items-center mb-3">
          <label className="text-muted text-sm">盘符</label>
          <select
            className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[220px]"
            value={drive}
            onChange={(e) => setDrive(e.target.value)}
            disabled={scanning}
          >
            {(drives || []).map((d) =>
              d.name ? (
                <option key={d.name} value={d.name}>
                  {d.name}: {d.usedLabel || ''} / {d.totalLabel || ''} (剩余 {d.freeLabel || ''})
                </option>
              ) : null
            )}
          </select>
          <button type="button" className="btn" disabled={scanning} onClick={() => startScan({ drive, hotspots: true })}>
            扫描盘符
          </button>
          <button type="button" className="btn secondary" disabled={scanning} onClick={scanHotspotsOnly}>
            仅热点
          </button>
          <button type="button" className="btn danger" disabled={!scanning} onClick={cancelScan}>
            取消扫描
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 items-center mb-3">
          <label className="text-muted text-sm">任意路径</label>
          <input
            type="text"
            className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[220px] flex-1"
            placeholder="例如 D:\资料 或 C:\Users\你的用户名"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            disabled={scanning}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={scanning}
            onClick={() => {
              const p = pathInput.trim();
              if (!p) return alert('请输入路径');
              startScan({ path: p, hotspots: false });
            }}
          >
            扫描路径
          </button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
          {(drives || []).map((d) =>
            d.name ? (
              <div key={d.name} className="bg-panel2 border border-border rounded-[10px] p-3">
                <div className="text-muted text-xs">{d.name}:</div>
                <div className="text-xl font-semibold mt-1">{d.freeLabel || '—'} 可用</div>
                <div className="text-muted text-xs mt-1">
                  已用 {d.usedLabel || '—'} / {d.totalLabel || '—'}
                </div>
                <div className="h-2 bg-[#0b1220] rounded-full overflow-hidden mt-2">
                  <i
                    className="block h-full bg-gradient-to-r from-ok via-warn to-danger"
                    style={{ width: `${Math.min(100, d.usedPct || 0)}%`, display: 'block' }}
                  />
                </div>
              </div>
            ) : null
          )}
        </div>
      </div>

      <div className="panel">
        <h2>扫描进度</h2>
        <div className="flex justify-between items-baseline gap-3 mb-2 text-sm">
          <span className="muted">{STATUS_MAP[progress?.status] || progress?.status || '空闲'}</span>
          <span className="mono">{indeterminate ? '…' : `${pct}%`}</span>
        </div>
        <div className="progress-bar">
          <i
            className={indeterminate ? 'indeterminate' : ''}
            style={{ width: indeterminate ? undefined : `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="muted text-sm mt-2">
          已扫描 {progress?.scannedLabel || '—'} / {progress?.totalLabel || '—'} · 文件{' '}
          {progress?.fileCount || 0} · 目录 {progress?.dirCount || 0}
          {progress?.durationLabel ? ` · 用时 ${progress.durationLabel}` : ''}
        </div>
        <div className="breadcrumb" title={progress?.breadcrumb || ''}>
          {progress?.breadcrumb || '—'}
        </div>
        <div className="current-path" title={progress?.currentPath || ''}>
          当前位置：{progress?.currentPath || '—'}
        </div>
      </div>

      <div className="panel">
        <h2>目录排行</h2>
        {ranking ? (
          <>
            <RankingMeta ranking={ranking} scanMeta={scanMeta} />
            <RankingBarChart children={ranking.children || []} />
            <RankingTable ranking={ranking} />
          </>
        ) : (
          <div className="muted">{rankingMsg}</div>
        )}
      </div>

      <div className="panel">
        <h2>热点规则</h2>
        {hotspots ? <HotspotTable hotspots={hotspots} /> : <div className="muted">{hotspotMsg}</div>}
      </div>
    </>
  );
}

function RankingMeta({ ranking, scanMeta }) {
  if (ranking.error) return <span className="muted">错误：{ranking.error}</span>;
  const rankingDur = ranking.durationLabel || scanMeta?.rankingDurationLabel || '—';
  const totalDur = scanMeta?.durationLabel || ranking.durationLabel || '—';
  const durLine =
    totalDur !== rankingDur && scanMeta?.durationLabel
      ? ` · 扫描用时 ${totalDur}（排行 ${rankingDur}）`
      : ` · 扫描用时 ${rankingDur !== '—' ? rankingDur : totalDur}`;
  return (
    <p className="muted">
      路径：<span className="mono">{ranking.path || ''}</span> · 合计 {ranking.totalLabel || '—'}
      {durLine}
      {ranking.partial ? <span className="tag medium ml-1">部分结果</span> : null}
    </p>
  );
}

function RankingTable({ ranking }) {
  const rows = (ranking.children || []).slice(0, 40);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>大小</th>
          <th>用时</th>
          <th>路径</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((c) => (
            <tr key={c.path || c.name}>
              <td>
                {c.isDir ? '📁' : '📄'} {c.name}
              </td>
              <td>{c.sizeLabel || '—'}</td>
              <td className="mono text-muted whitespace-nowrap text-right">{c.durationLabel || '—'}</td>
              <td className="mono">{c.path}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={4}>空</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function HotspotTable({ hotspots }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>热点</th>
          <th>大小</th>
          <th>标记</th>
          <th>路径</th>
        </tr>
      </thead>
      <tbody>
        {hotspots.map((h) => (
          <tr key={h.id || h.path || h.label}>
            <td>{h.label}</td>
            <td>{h.exists ? h.sizeLabel : '不存在'}</td>
            <td>
              <span className={`tag ${h.risk}`}>{h.risk}</span>{' '}
              <span className="tag">{h.category}</span>
            </td>
            <td className="mono">{h.path}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
