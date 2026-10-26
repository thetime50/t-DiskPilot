import { useEffect, useState } from 'react';
import { api } from './api.js';
import TitleBar from './components/TitleBar.jsx';
import ScanTab from './tabs/ScanTab.jsx';
import CleanTab from './tabs/CleanTab.jsx';
import OptimizeTab from './tabs/OptimizeTab.jsx';
import SuggestTab from './tabs/SuggestTab.jsx';
import QuarantineTab from './tabs/QuarantineTab.jsx';

const TABS = [
  { id: 'scan', label: '扫描' },
  { id: 'clean', label: '清理' },
  { id: 'optimize', label: '优化' },
  { id: 'suggest', label: '建议' },
  { id: 'quarantine', label: '隔离区' },
];

export default function App() {
  const [tab, setTab] = useState('scan');
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api('/api/health');
        if (!cancelled) {
          setHealth(h);
          setHealthErr('');
        }
      } catch (err) {
        if (!cancelled) setHealthErr(String(err.message || err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-shell">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-5">
          <div className="app-brand">
            <img className="app-logo" src="/app-icon.png" alt="t-DiskPilot" width={40} height={40} />
            <h1>t-DiskPilot</h1>
          </div>
          <span className="text-muted text-[0.92rem]">通用磁盘空间工具 · 扫描 / 清理 / 优化 / 建议</span>
          <span className="health-pill">
            {healthErr
              ? '无法连接后端'
              : health
                ? `就绪 · 隔离区 ${health.quarantineRoot}`
                : '连接中…'}
          </span>
        </header>

        <nav className="flex flex-wrap gap-1.5 mb-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div hidden={tab !== 'scan'}>
          <ScanTab initialScan={health?.scan} />
        </div>
        <div hidden={tab !== 'clean'}>
          <CleanTab />
        </div>
        <div hidden={tab !== 'optimize'}>
          <OptimizeTab />
        </div>
        <div hidden={tab !== 'suggest'}>
          <SuggestTab />
        </div>
        <div hidden={tab !== 'quarantine'}>
          <QuarantineTab quarantineRoot={health?.quarantineRoot} />
        </div>

        <p className="mt-[18px] text-muted text-xs">
          t-DiskPilot 不会在未确认时删除或改配置。操作日志写在项目 <code>logs/</code> 目录。
        </p>
      </div>
    </div>
  );
}
