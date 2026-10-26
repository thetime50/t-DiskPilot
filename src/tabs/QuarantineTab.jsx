import { useEffect, useState } from 'react';
import { api, formatLog } from '../api.js';

export default function QuarantineTab({ quarantineRoot }) {
  const [root, setRoot] = useState(quarantineRoot || '—');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [log, setLog] = useState('');

  async function refresh() {
    setError('');
    try {
      const data = await api('/api/quarantine');
      setRoot(data.root);
      setItems(data.items || []);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function permanentDelete(name) {
    if (prompt('永久删除隔离项。输入 CONFIRM：') !== 'CONFIRM') return;
    try {
      setLog(
        formatLog(
          await api('/api/quarantine/delete', {
            method: 'POST',
            body: JSON.stringify({ name, dryRun: false, confirmToken: 'CONFIRM' }),
          })
        )
      );
      refresh();
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  async function restore(name) {
    if (prompt('还原到原路径。输入 CONFIRM：') !== 'CONFIRM') return;
    try {
      setLog(
        formatLog(
          await api('/api/quarantine/restore', {
            method: 'POST',
            body: JSON.stringify({ name, dryRun: false, confirmToken: 'CONFIRM' }),
          })
        )
      );
      refresh();
    } catch (err) {
      setLog(formatLog(err.data || err.message));
    }
  }

  return (
    <div className="panel">
      <h2>隔离区</h2>
      <p className="muted">风险不明的清理会先移到这里。测试确认后可永久删除或还原。</p>
      <p>
        路径：<span className="mono">{root}</span>
      </p>
      <div className="flex flex-wrap gap-2.5 items-center mb-3">
        <button type="button" className="btn secondary" onClick={refresh}>
          刷新
        </button>
      </div>
      {error && <p className="muted">{error}</p>}
      {!error && !items.length ? <p className="muted">隔离区为空</p> : null}
      {items.map((it) => (
        <div key={it.name} className="item-card" style={{ gridTemplateColumns: '1fr auto' }}>
          <div>
            <h3>{it.name}</h3>
            <p className="mono muted">{it.path}</p>
            {it.meta ? <p className="muted">来源：{it.meta.src || ''}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className="btn secondary" onClick={() => restore(it.name)}>
              还原
            </button>
            <button type="button" className="btn danger" onClick={() => permanentDelete(it.name)}>
              永久删除
            </button>
          </div>
        </div>
      ))}
      {log ? <pre className="log-box mt-3">{log}</pre> : null}
    </div>
  );
}
