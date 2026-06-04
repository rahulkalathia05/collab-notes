'use client';

import { useMemo, useState } from 'react';

// ── shared types ──────────────────────────────────────────────────────────────

interface Point { date: string; count: number; }
interface NamedPoint { name: string; value: number; }

// ── utilities ─────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pathFromPoints(
  data: Point[],
  W: number,
  H: number,
  padX = 0,
): { line: string; area: string } {
  if (data.length === 0) return { line: '', area: '' };
  const max = Math.max(...data.map((d) => d.count), 1);
  const pts = data.map((d, i) => ({
    x: padX + (i / Math.max(data.length - 1, 1)) * (W - padX),
    y: H - (d.count / max) * H * 0.9 - H * 0.05,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area =
    `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
  return { line, area };
}

// ── LineChart ─────────────────────────────────────────────────────────────────

interface LineChartProps {
  data: Point[];
  color?: string;
  label?: string;
  height?: number;
  showXLabels?: boolean;
}

export function LineChart({
  data,
  color = '#6366f1',
  label,
  height = 160,
  showXLabels = true,
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 120;
  const padBottom = showXLabels ? 24 : 0;
  const totalH = H + padBottom;

  const { line, area } = useMemo(() => pathFromPoints(data, W, H), [data]);
  const max = Math.max(...data.map((d) => d.count), 1);

  if (data.length === 0) return null;

  // Show every Nth x-label to avoid crowding
  const step = Math.ceil(data.length / 8);

  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${totalH}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`grad-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal grid */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0} y1={H - f * H * 0.9 - H * 0.05}
            x2={W} y2={H - f * H * 0.9 - H * 0.05}
            stroke="currentColor" strokeOpacity="0.07" strokeWidth="1"
          />
        ))}

        {/* Area fill */}
        {area && <path d={area} fill={`url(#grad-${color.slice(1)})`} />}

        {/* Line */}
        {line && (
          <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        )}

        {/* Interactive points */}
        {data.map((d, i) => {
          const x = (i / Math.max(data.length - 1, 1)) * W;
          const y = H - (d.count / max) * H * 0.9 - H * 0.05;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <circle cx={x} cy={y} r="12" fill="transparent" />
              {hover === i && (
                <>
                  <line x1={x} y1={0} x2={x} y2={H} stroke={color} strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 2" />
                  <circle cx={x} cy={y} r="4" fill={color} />
                  <rect x={Math.min(x + 6, W - 120)} y={Math.max(y - 28, 2)} width="110" height="22" rx="4" fill="#1e293b" opacity="0.9" />
                  <text x={Math.min(x + 61, W - 65)} y={Math.max(y - 13, 17)} fill="white" fontSize="11" textAnchor="middle">
                    {shortDate(d.date)}: {d.count}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {showXLabels && data.map((d, i) => {
          if (i % step !== 0 && i !== data.length - 1) return null;
          const x = (i / Math.max(data.length - 1, 1)) * W;
          return (
            <text key={i} x={x} y={H + 18} fontSize="10" fill="currentColor" opacity="0.4" textAnchor="middle">
              {shortDate(d.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── BarChart ──────────────────────────────────────────────────────────────────

interface BarChartProps {
  data: NamedPoint[];
  color?: string;
  height?: number;
}

export function BarChart({ data, color = '#8b5cf6', height = 160 }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 110;
  const padBottom = 28;
  const totalH = H + padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max((W / data.length) * 0.6, 8);
  const gap = W / data.length;

  if (data.length === 0) return null;

  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${totalH}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} y1={H - f * H * 0.88} x2={W} y2={H - f * H * 0.88}
            stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
        ))}

        {data.map((d, i) => {
          const barH = (d.value / max) * H * 0.88;
          const x = gap * i + gap / 2 - barW / 2;
          const y = H - barH;
          const isHover = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y} width={barW} height={barH} rx="3"
                fill={color} opacity={isHover ? 1 : 0.75} />
              {isHover && (
                <>
                  <rect x={Math.min(x, W - 110)} y={Math.max(y - 26, 2)} width="105" height="20" rx="3" fill="#1e293b" opacity="0.9" />
                  <text x={Math.min(x + 52, W - 55)} y={Math.max(y - 12, 17)} fill="white" fontSize="11" textAnchor="middle">
                    {d.name}: {d.value}
                  </text>
                </>
              )}
              <text x={x + barW / 2} y={H + 18} fontSize="9" fill="currentColor" opacity="0.45" textAnchor="middle">
                {d.name.length > 8 ? d.name.slice(0, 7) + '…' : d.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Sparkline (mini inline chart for cards) ───────────────────────────────────

export function Sparkline({ data, color }: { data: Point[]; color: string }) {
  const W = 80;
  const H = 28;
  const { line } = useMemo(() => pathFromPoints(data, W, H, 2), [data]);
  if (!line || data.length < 2) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-20 h-7 shrink-0">
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
