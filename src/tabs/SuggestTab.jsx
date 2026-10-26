import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock.jsx';
import { useLoadProgress } from '../hooks/useLoadProgress.js';
import { api, formatLog } from '../api.js';
import { useDrive } from '../context/DriveContext.jsx';
import { maskPath } from '../utils/maskPath';

export default function SuggestTab() {
  const { drives, drive, setDrive } = useDrive();
  const [items, setItems] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [log, setLog] = useState('');

  const { progress: loadProgress, start: startLoadProgress, stop: stopLoadProgress } = useLoadProgress('/api/suggest/progress');

  async function refresh(force = false) {
    setLoading(true);
    setError('');
    startLoadProgress();
    try {
      const q = new URLSearchParams({ drive });
      if (force) q.set('refresh', '1');
      const data = await api('/api/suggest?' + q.toString());
      const list = data.items || [];
      setItems(list);
      const init = {};
      list.forEach((item) => {
        init[item.id] = (item.applyDefault && item.applyDefault.value) || '';
      });
      setValues(init);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      stopLoadProgress();
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drive]);

  async function dryApply(id) {
    const value = (values[id] || '').trim();
    try {
      setLog(
        formatLog(
          await api('/api/suggest/apply', {
            method: 'POST',
            body: JSON.stringify({ id, dryRun: true, params: { value }, drive }),
          })
        )
      );
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  async function apply(id) {
    if (!confirm('将真实修改配置/环境变量。继续？请在下一步输入 CONFIRM。')) return;
    const token = prompt('输入 CONFIRM 确认应用：');
    if (token !== 'CONFIRM') return alert('已取消');
    const value = (values[id] || '').trim();
    try {
      setLog(
        formatLog(
          await api('/api/suggest/apply', {
            method: 'POST',
            body: JSON.stringify({ id, dryRun: false, confirmToken: 'CONFIRM', params: { value }, drive }),
          })
        )
      );
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  return (
    <div className="panel">
      <h2>建议（可含路径迁移，非仅删除）</h2>

      <div className="drive-bound-bar flex flex-wrap gap-2.5 items-center mb-3">
        <label className="text-muted text-sm">当前盘</label>
        <select
          className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[120px]"
          value={drive}
          onChange={(e) => setDrive(e.target.value)}
          disabled={loading}
        >
          {(drives || []).map((d) =>
            d.name ? (
              <option key={d.name} value={String(d.name).toUpperCase()}>
                {String(d.name).toUpperCase()}:
              </option>
            ) : null
          )}
        </select>
        <span className="muted text-sm">清单仅含 {drive}: 盘路径；换盘会重新加载</span>
      </div>
      <p className="muted">例如把 Pip 缓存改到 D 盘。应用环境变量/配置更改仍需确认。</p>
      <div className="flex flex-wrap gap-2.5 items-center mb-3">
        <button type="button" className="btn secondary" onClick={() => refresh(true)}>
          刷新
        </button>
      </div>
      {loading && <LoadingBlock title="加载建议…" progress={loadProgress} />}
      {error && <p className="muted">{error}</p>}
      {!loading && !items.length && (
        <p className="muted">所选盘 {drive}: 暂无建议项</p>
      )}
      {!loading &&
        items.map((item) => {
          const g = item.guidance || {};
          return (
            <div key={item.id} className="item-card" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <h3>
                  {item.label} <span className="tag">{item.sizeLabel}</span>{' '}
                  <span className={`tag ${item.risk}`}>{item.risk}</span>
                </h3>
                <p className="mono muted">{maskPath(item.relatedPath || '')}</p>
                <div className="bg-[#0b1220] border-l-[3px] border-accent pl-3 pr-3 py-2.5 mt-2 rounded-r-lg">
                  <strong>{g.summary || ''}</strong>
                  <ol className="mt-1.5 mb-0 pl-[18px] text-muted">
                    {(g.steps || []).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {(g.commands || []).length ? (
                    <div className="mt-2">
                      {(g.commands || []).map((c, i) => (
                        <div key={i}>
                          <code className="bg-panel px-1.5 py-0.5 rounded text-sm">{c}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {item.canApply ? (
                  <div className="flex flex-wrap gap-2.5 items-center mt-2">
                    <input
                      type="text"
                      className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[220px]"
                      value={values[item.id] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                    />
                    <button type="button" className="btn secondary" onClick={() => dryApply(item.id)}>
                      预演应用
                    </button>
                    <button type="button" className="btn ok" onClick={() => apply(item.id)}>
                      确认应用…
                    </button>
                  </div>
                ) : (
                  <p className="muted mt-2">仅指导，无自动应用</p>
                )}
              </div>
            </div>
          );
        })}
      {log ? <pre className="log-box mt-3">{log}</pre> : null}
    </div>
  );
}
