import { useEffect, useState } from 'react';
import { api, formatLog } from '../api.js';

export default function CleanTab() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmToken, setConfirmToken] = useState('');
  const [log, setLog] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/clean/checklist');
      setItems(data.items || []);
      setSelected(new Set());
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggle(id, on) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.filter((i) => i.selectable).map((i) => i.id)));
  }

  async function dryRun() {
    const ids = [...selected];
    if (!ids.length) return alert('请先勾选项目');
    try {
      setLog(formatLog(await api('/api/clean/execute', { method: 'POST', body: JSON.stringify({ ids, dryRun: true }) })));
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  async function doClean() {
    if (confirmToken.trim() !== 'CONFIRM') return alert('请输入 CONFIRM');
    const ids = [...selected];
    try {
      setLog(
        formatLog(
          await api('/api/clean/execute', {
            method: 'POST',
            body: JSON.stringify({ ids, dryRun: false, confirmToken: 'CONFIRM' }),
          })
        )
      );
      setShowConfirm(false);
      setConfirmToken('');
      refresh();
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  return (
    <div className="panel">
      <h2>清理清单（逐条勾选）</h2>
      <p className="muted">低风险项确认后可直接删除；其余先移入隔离区。默认不会自动执行。</p>
      <div className="flex flex-wrap gap-2.5 items-center mb-3">
        <button type="button" className="btn secondary" onClick={refresh}>
          刷新大小
        </button>
        <button type="button" className="btn secondary" onClick={selectAll}>
          全选可选
        </button>
        <button type="button" className="btn secondary" onClick={() => setSelected(new Set())}>
          清空勾选
        </button>
      </div>

      {loading && <p className="muted">加载清理清单并估算大小…</p>}
      {error && <p className="muted">{error}</p>}

      {!loading &&
        items.map((item) => (
          <div key={item.id} className={`item-card ${item.selectable ? '' : 'disabled'}`}>
            <div>
              <input
                type="checkbox"
                value={item.id}
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
                <span className={`tag ${item.mode}`}>
                  {item.mode === 'direct' ? '确认后直接删' : '先隔离'}
                </span>
                <span className="tag">{item.sizeLabel}</span>
              </div>
              <p className="mono muted mt-1.5">{item.path}</p>
            </div>
            <div />
          </div>
        ))}

      <div className="sticky bottom-3 flex flex-wrap gap-2.5 items-center p-3 bg-[rgba(26,35,50,0.95)] border border-border rounded-xl backdrop-blur-sm">
        <button type="button" className="btn" onClick={dryRun}>
          预演（dry-run）
        </button>
        <button
          type="button"
          className="btn ok"
          onClick={() => {
            if (![...selected].length) return alert('请先勾选项目');
            setShowConfirm(true);
          }}
        >
          确认执行所选
        </button>
        <span className="muted">已选 {selected.size} 项</span>
      </div>

      {showConfirm && (
        <div className="confirm-box">
          <p>
            将<strong>真实执行</strong>勾选的清理项。请在下方输入 <code>CONFIRM</code> 后点执行。
          </p>
          <div className="flex flex-wrap gap-2.5 items-center mt-2">
            <input
              type="text"
              className="bg-bg border border-border text-white rounded-lg px-2.5 py-2 min-w-[160px]"
              placeholder="CONFIRM"
              autoComplete="off"
              value={confirmToken}
              onChange={(e) => setConfirmToken(e.target.value)}
            />
            <button type="button" className="btn danger" onClick={doClean}>
              执行清理
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
