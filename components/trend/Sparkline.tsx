'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface Sample { t: string; velocity: number; reach: number; opportunity: number }

interface Props {
  samples: Sample[];
  metric?: 'velocity' | 'reach' | 'opportunity';
  height?: number;
  color?: string;
  showAxis?: boolean;
}

// Lightweight inline SVG sparkline with no chart-lib dep. Renders a single
// metric over time with optional baseline dots and value tooltip.
export function Sparkline({ samples, metric = 'velocity', height = 56, color = '#FF6A1A', showAxis = true }: Props) {
  if (!samples || samples.length < 2) {
    return (
      <div className="flex items-center justify-center text-2xs text-ink-500 italic" style={{ height }}>
        Not enough samples yet — refresh a few times to build history.
      </div>
    );
  }

  const values = samples.map(s => s[metric] as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const W = 320;
  const H = height;
  const padX = 4;
  const padY = 6;

  const xAt = (i: number) => padX + (i / (samples.length - 1)) * (W - 2 * padX);
  const yAt = (v: number) => H - padY - ((v - min) / span) * (H - 2 * padY);

  let pathD = '';
  samples.forEach((s, i) => {
    const x = xAt(i);
    const y = yAt(s[metric] as number);
    pathD += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
  });

  const last = samples[samples.length - 1];
  const first = samples[0];
  const delta = last[metric] - first[metric];
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <defs>
          <linearGradient id={`spark-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${pathD} L${xAt(samples.length - 1)},${H - padY} L${padX},${H - padY} Z`} fill={`url(#spark-${metric})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" />
        <circle cx={xAt(samples.length - 1)} cy={yAt(last[metric] as number)} r="2.5" fill={color} />
      </svg>
      {showAxis && (
        <div className="flex items-center justify-between text-2xs font-mono text-ink-400 mt-1">
          <span>{shortTime(first.t)}</span>
          <span className={cn(
            trend === 'up' ? 'text-signal-green' : trend === 'down' ? 'text-signal-red' : 'text-ink-300',
          )}>
            {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '→'} {fmt(last[metric] as number, metric)}
          </span>
          <span>now</span>
        </div>
      )}
    </div>
  );
}

function fmt(n: number, metric: string): string {
  if (metric === 'opportunity') return Math.round(n).toString();
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}
function shortTime(iso: string): string {
  const d = new Date(iso);
  const ago = Date.now() - d.getTime();
  const h = ago / 3_600_000;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
