'use strict';

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—';
  const n = Math.round(Number(ms));
  if (n < 1000) return n + ' ms';
  const s = n / 1000;
  if (s < 60) return s.toFixed(1) + ' s';
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return m + 'm ' + rem + 's';
}

/** Tiny in-memory progress for checklist / suggest loads. */
function createLoadProgress() {
  const state = {
    status: 'idle', // idle | running | done | error
    current: 0,
    total: 0,
    percent: 0,
    label: '',
    error: null,
    startedAt: null,
    finishedAt: null,
  };

  function snapshot() {
    let durationMs = null;
    if (state.startedAt) {
      const end = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
      durationMs = end - Date.parse(state.startedAt);
    }
    return {
      status: state.status,
      current: state.current,
      total: state.total,
      percent: state.percent,
      label: state.label,
      error: state.error,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      durationMs,
      durationLabel: formatDuration(durationMs),
    };
  }

  function begin(total, label) {
    state.status = 'running';
    state.current = 0;
    state.total = Math.max(0, Number(total) || 0);
    state.percent = 0;
    state.label = label || '';
    state.error = null;
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
  }

  function step(current, label) {
    state.current = current;
    if (label != null) state.label = label;
    if (state.total > 0) {
      state.percent = Math.min(100, Math.round((state.current / state.total) * 1000) / 10);
    }
  }

  function end() {
    state.status = 'done';
    if (state.total > 0) {
      state.current = state.total;
      state.percent = 100;
    }
    state.finishedAt = new Date().toISOString();
  }

  function fail(err) {
    state.status = 'error';
    state.error = String(err && err.message ? err.message : err || 'error');
    state.finishedAt = new Date().toISOString();
  }

  return { begin, step, end, fail, snapshot };
}

module.exports = { createLoadProgress, formatDuration };
