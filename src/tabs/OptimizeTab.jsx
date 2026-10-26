import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock.jsx';
import { useLoadProgress } from '../hooks/useLoadProgress.js';
import { useScanFreshness } from '../hooks/useScanFreshness.js';
import { api, formatLog } from '../api.js';

export default function OptimizeTab() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmToken, setConfirmToken] = useState('');
  const [log, setLog] = useState('');

  const { progress: loadProgress, start: startLoadProgress, stop: stopLoadProgress } = useLoadProgress('/api/optimize/checklist/progress');
  const { freshness, refreshFreshness, canAct, stale } = useScanFreshness();

  async function refresh(force = false) {
    setLoading(true);
    setError('');
    startLoadProgress();
    try {
      const data = await api('/api/optimize/checklist' + (force ? '?refresh=1' : ''));
      setItems(data.items || []);
      setSelected(new Set());
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      stopLoadProgress();
      setLoading(false);
      refreshFreshness();
    }
  }

  useEffect(() => {
    if (items.length) return;
    refresh(false);
  }, []);

  function toggle(id, on) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function dryRun() {
    if (!canAct) return alert(freshness?.reason || '扫描已过期，请先重新扫描');
    const ids = [...selected];
    if (!ids.length) return alert('请先勾选');
    try {
      setLog(formatLog(await api('/api/optimize/execute', { method: 'POST', body: JSON.stringify({ ids, dryRun: true }) })));
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  async function doOpt() {
    if (!canAct) return alert(freshness?.reason || '扫描已过期，请先重新扫描');
    if (confirmToken.trim() !== 'CONFIRM') return alert('请输入 CONFIRM');
    try {
      setLog(
        formatLog(
          await api('/api/optimize/execute', {
            method: 'POST',
            body: JSON.stringify({ ids: [...selected], dryRun: false, confirmToken: 'CONFIRM' }),
          })
        )
      );
      setShowConfirm(false);
      setConfirmToken('');
      refresh(true);
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  return (
    <div className="panel">
      <h2>优化清单（逐条勾选）</h2>
      <div className={`scan-freshness${stale || !canAct ? ' is-stale' : ''}`}>
        {freshness?.reason || (stale ? '扫描结果不可用' : '扫描结果有效')}
        {freshness?.scannedAt ? ` · 扫描于 ${freshness.scannedAt}` : ''}
      </div>
      <p className="muted">包含传递优化缓存、缩略图、回收站、存储感知等。更改前需确认。</p>
      <div className="flex flex-wrap gap-2.5 items-center mb-3">
        <button type="button" className="btn secondary" onClick={() => refresh(true)}>
          刷新
        </button>
      </div>
      {loading && <LoadingBlock title="加载优化清单…" progress={loadProgress} />}
      {error && <p className="muted">{error}</p>}
      {!loading &&
        items.map((item) => (
          <div key={item.id} className={`item-card ${item.selectable ? '' : 'disabled'}`}>
            <div>
              <input
                type="checkbox"
                disabled={!item.selectable}
                checked={selected.has(item.id)}
                onChange={(e) => toggle(item.id, e.target.checked)}
              />
            </div>
            <div>
              <h3>{item.label}</h3>
              <p>{item.description || ''}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className={`tag ${item.risk}`}>风险 {item.risk}</span>
                <span className="tag">{item.sizeLabel}</span>
              </div>
              {item.path ? <p className="mono muted mt-1.5">{item.path}</p> : null}
              {item.notes ? <p className="muted mt-1">{item.notes}</p> : null}
              {item.extra ? (
                <pre className="log-box mt-2" style={{ maxHeight: 120 }}>
                  {JSON.stringify(item.extra, null, 2)}
                </pre>
              ) : null}
            </div>
            <div />
          </div>
        ))}

      <div className="sticky bottom-1.5 flex flex-wrap gap-2.5 items-center py-1.5 px-3 bg-[rgba(26,35,50,0.95)] border border-border rounded-xl">
        <button type="button" className="btn" onClick={dryRun} disabled={!canAct}>
          预演（dry-run）
        </button>
        <button
          type="button"
          className="btn ok"
          disabled={!canAct}
          onClick={() => {
            if (![...selected].length) return alert('请先勾选');
            setShowConfirm(true);
          }}
        >
          确认执行所选
        </button>
      </div>

      {showConfirm && (
        <div className="confirm-box">
          <p>
            输入 <code>CONFIRM</code> 后真实执行优化项。
          </p>
          <div className="flex flex-wrap gap-2.5 items-center mt-2">
            <input
              type="text"
              className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[160px]"
              placeholder="CONFIRM"
              value={confirmToken}
              onChange={(e) => setConfirmToken(e.target.value)}
            />
            <button type="button" className="btn danger" onClick={doOpt} disabled={!canAct}>
              执行优化
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setShowConfirm(false);
                setConfirmToken('');
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {log ? <pre className="log-box mt-3">{log}</pre> : null}
    </div>
  );
}
