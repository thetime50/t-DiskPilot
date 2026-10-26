import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export function useScanFreshness() {
  const [freshness, setFreshness] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setFreshness(await api('/api/scan/freshness'));
    } catch (_) {
      setFreshness({ hasScan: false, canAct: false, stale: true, reason: '无法获取扫描时效' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { freshness, refreshFreshness: refresh, canAct: !!freshness?.canAct, stale: freshness ? !!freshness.stale : true };
}
