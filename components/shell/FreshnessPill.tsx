'use client';
import * as React from 'react';
import { Chip } from '@/components/ui/Chip';

interface Status {
  cron: { started: boolean; lastRunAt: string | null; lastResult: { inserted: number; updated: number } | null };
  newLast10: number;
  updatedLast10: number;
  newLastHour: number;
  updatedLastHour: number;
}

// Polls /api/cron-status every 15s and renders a compact freshness indicator.
// Shows time since last server-side ingest tick + counts of fresh trends.
export function FreshnessPill() {
  const [s, setS] = React.useState<Status | null>(null);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const res = await fetch('/api/cron-status', { cache: 'no-store' });
        if (res.ok && !stop) setS(await res.json());
      } catch { /* ignore */ }
    }
    tick();
    const id = setInterval(tick, 15_000);
    const idNow = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(id); clearInterval(idNow); };
  }, []);

  if (!s) return null;
  const lastMs = s.cron.lastRunAt ? new Date(s.cron.lastRunAt).getTime() : 0;
  const ageMs = lastMs ? now - lastMs : 0;
  const ageLabel =
    !lastMs ? 'pending first tick' :
    ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s ago` :
    ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago` :
    `${Math.floor(ageMs / 3_600_000)}h ago`;

  const stale = ageMs > 10 * 60 * 1000;       // > 10 min since last cron tick
  const showNew = s.newLast10 > 0;
  const showUpd = s.updatedLast10 > 0;

  return (
    <span className="flex items-center gap-1.5 text-2xs font-mono text-ink-300">
      <Chip tone={stale ? 'warn' : 'good'}>fresh {ageLabel}</Chip>
      {showNew && <Chip tone="flare">+{s.newLast10} new</Chip>}
      {showUpd && <Chip tone="info">↻{s.updatedLast10} updated</Chip>}
      {!showNew && !showUpd && s.newLastHour > 0 && (
        <span className="text-ink-400">{s.newLastHour} new in last hour</span>
      )}
    </span>
  );
}
