import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const DriveContext = createContext(null);

export function DriveProvider({ children }) {
  const [drives, setDrives] = useState([]);
  const [drive, setDrive] = useState('C');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { drives: list } = await api('/api/drives');
        if (cancelled) return;
        setDrives(list || []);
        const names = (list || []).map((d) => String(d.name || '').toUpperCase()).filter(Boolean);
        setDrive((prev) => {
          const cur = String(prev || '').toUpperCase();
          if (cur && names.includes(cur)) return cur;
          if (names.includes('C')) return 'C';
          return names[0] || 'C';
        });
      } catch (_) {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      drives,
      setDrives,
      drive,
      setDrive: (v) => setDrive(String(v || 'C').replace(/:\\?$/, '').toUpperCase()),
    }),
    [drives, drive]
  );

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>;
}

export function useDrive() {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error('useDrive must be used within DriveProvider');
  return ctx;
}