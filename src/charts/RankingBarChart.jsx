import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

/**
 * Horizontal bar chart of directory / file sizes (top N).
 */
export default function RankingBarChart({ children = [], height = 280 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const data = (children || [])
      .filter((c) => c && (c.size || 0) > 0)
      .slice(0, 16)
      .map((c) => ({
        name: c.name || pathTail(c.path) || '?',
        size: Number(c.size) || 0,
        label: c.sizeLabel || formatBytes(c.size),
        isDir: !!c.isDir,
      }));

    const width = Math.max(el.clientWidth || 640, 320);
    const margin = { top: 8, right: 72, bottom: 8, left: 120 };
    const innerW = width - margin.left - margin.right;
    const barH = Math.max(18, Math.floor((height - margin.top - margin.bottom) / Math.max(data.length, 1)));
    const innerH = barH * Math.max(data.length, 1);

    d3.select(el).selectAll('*').remove();
    if (!data.length) {
      d3.select(el)
        .append('p')
        .attr('class', 'muted')
        .text('暂无排行数据可绘制');
      return;
    }

    const svg = d3
      .select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', innerH + margin.top + margin.bottom);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.size) || 1])
      .range([0, innerW]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.name))
      .range([0, innerH])
      .padding(0.18);

    // Teal for dirs, slate for files — matches otter/teal theme
    const color = d3.scaleOrdinal().domain([true, false]).range(['#14b8a6', '#64748b']);

    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => y(d.name))
      .attr('height', y.bandwidth())
      .attr('width', (d) => x(d.size))
      .attr('rx', 4)
      .attr('fill', (d) => color(d.isDir));

    g.selectAll('text.name')
      .data(data)
      .join('text')
      .attr('class', 'name')
      .attr('x', -8)
      .attr('y', (d) => (y(d.name) || 0) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', '#8aa3ad')
      .attr('font-size', 11)
      .text((d) => truncate(d.name, 16));

    g.selectAll('text.val')
      .data(data)
      .join('text')
      .attr('class', 'val')
      .attr('x', (d) => x(d.size) + 6)
      .attr('y', (d) => (y(d.name) || 0) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .text((d) => d.label);
  }, [children, height]);

  return <div className="chart-wrap" ref={ref} />;
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function pathTail(p) {
  if (!p) return '';
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i += 1;
  }
  return x.toFixed(x >= 10 ? 0 : 1) + ' ' + u[i];
}
