import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const POLL_MS = 200;

export function useLoadProgress(progressPath) {
  const [progress, setProgress] = useState(null);
  const timerRef = useRef(null);

  function stop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function start() {
    stop();
    setProgress({ status: 'running', current: 0, total: 0, percent: 0, label: '准备…' });
    timerRef.current = setInterval(async () => {
      try {
        const p = await api(progressPath);
        setProgress(p);
      } catch (_) {
        /* ignore poll errors */
      }
    }, POLL_MS);
  }

  useEffect(() => () => stop(), []);

  return { progress, start, stop, setProgress };
}
