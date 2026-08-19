'use client';
import * as React from 'react';

/** A number that tweens when it changes, so a follower moving 412,003 → 412,004
 *  is *seen* rather than silently swapped.
 *
 *  Hydration: SSR and the first client render both emit the raw formatted
 *  value — no Date.now(), no animation state — so the markup matches. The
 *  tween only starts on a subsequent value change (CLAUDE.md hard-rule 10). */
export function LiveCounter({
  value,
  className,
  durationMs = 900,
}: {
  value: number | null;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = React.useState(value);
  const prev = React.useRef(value);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    const from = prev.current;
    prev.current = value;

    // First real value, or cleared — snap, don't tween from nothing.
    if (from == null || value == null) { setShown(value); return; }
    if (from === value) return;

    // A huge jump (first backfill, or an account swap) reads as noise when
    // animated. Only tween changes small enough to follow.
    if (Math.abs(value - from) > Math.max(1000, from * 0.05)) { setShown(value); return; }

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      // easeOutCubic — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [value, durationMs]);

  if (shown == null) return <span className={className}>—</span>;
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {shown.toLocaleString('en-US')}
    </span>
  );
}

/** Compact form for big counts: 412,003 → 412K. Used where space is tight. */
export function compact(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}
