'use client';
import * as React from 'react';

/** Follower trend. Deliberately axis-less — at 15-minute resolution the shape
 *  is the information; exact values live in the counter above it. */
export function Sparkline({
  points,
  className,
  width = 120,
  height = 28,
}: {
  points: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat line would divide by zero and also render as a spike; draw it
  // through the middle instead.
  const span = max - min || 1;
  const stepX = width / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  const rising = points[points.length - 1] >= points[0];
  const stroke = rising ? 'var(--sparkline-up)' : 'var(--sparkline-down)';
  const gradId = React.useId();

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      role="img"
      aria-label={`Follower trend, ${rising ? 'rising' : 'falling'}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Emphasized endpoint — the reader's eye should land on "now". */}
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.2" fill={stroke} />
    </svg>
  );
}
