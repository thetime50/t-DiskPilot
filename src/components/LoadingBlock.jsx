export default function LoadingBlock({ title = '加载中…', progress }) {
  const pct = progress?.percent != null ? progress.percent : 0;
  const hasTotal = progress?.total > 0;
  const indeterminate = !hasTotal || (progress?.status === 'running' && pct === 0 && !progress?.label);
  const label = progress?.label || title;
  const detail = hasTotal
    ? `${progress.current || 0} / ${progress.total}${progress?.durationLabel ? ` · 用时 ${progress.durationLabel}` : ''}`
    : progress?.durationLabel
      ? `用时 ${progress.durationLabel}`
      : '';

  return (
    <div className="loading-block" role="status" aria-live="polite">
      <div className="loading-block-row">
        <span className="spinner" aria-hidden="true" />
        <div className="loading-block-text">
          <div>{label}</div>
          {detail ? <div className="muted text-sm mt-1">{detail}</div> : null}
        </div>
        {hasTotal ? <span className="mono text-sm">{pct}%</span> : null}
      </div>
      <div className="progress-bar mt-2">
        <i
          className={indeterminate || !hasTotal ? 'indeterminate' : ''}
          style={{ width: hasTotal && !indeterminate ? `${Math.min(100, pct)}%` : undefined }}
        />
      </div>
    </div>
  );
}
