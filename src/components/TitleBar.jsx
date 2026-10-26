import { useEffect, useState } from 'react';

/** Custom chrome matching SquirrelDisk: undecorated window + dark drag titlebar */
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [win, setWin] = useState(null);

  useEffect(() => {
    let unlisten;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        if (cancelled) return;
        setWin(w);
        setMaximized(await w.isMaximized());
        unlisten = await w.onResized(async () => {
          try {
            setMaximized(await w.isMaximized());
          } catch {
            /* ignore */
          }
        });
      } catch {
        // Running in browser (npm run dev) — no Tauri window APIs
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const minimize = () => win?.minimize();
  const toggleMax = () => win?.toggleMaximize();
  const close = () => win?.close();

  return (
    <div data-tauri-drag-region className="titlebar">
      <div className="titlebar-left" data-tauri-drag-region>
        <img className="titlebar-logo" src="/app-icon.png" alt="" width={20} height={20} draggable={false} />
        <span className="titlebar-title" data-tauri-drag-region>
          t-DiskPilot
        </span>
      </div>
      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" aria-label="Minimize" onClick={minimize}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="5.5" width="10" height="1.2" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className="titlebar-btn" aria-label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMax}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3.5 3.5h5v5h-5zM2 4.5V2h7.5v7.5H7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button type="button" className="titlebar-btn titlebar-btn-close" aria-label="Close" onClick={close}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
