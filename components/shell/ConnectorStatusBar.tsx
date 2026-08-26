import * as React from 'react';
import type { SourceId } from '@/types';
import { sourceLabel } from '@/components/trend/SourceIcon';
import { cn } from '@/lib/utils';

interface ConnectorStatus {
  source: SourceId;
  /** Optional human label override. Used for niche connectors (Meta Ad
   *  Library, X-Trending24) that don't map cleanly to the canonical
   *  SourceId taxonomy and need their own pill. Falls back to
   *  sourceLabel(source) when omitted. */
  label?: string;
  /** Optional unique key — defaults to `source` for back-compat. Required
   *  when multiple statuses share a SourceId (e.g. X-Official + X-Trending
   *  both use source='x'). */
  id?: string;
  mode: 'live' | 'mock' | 'sim';
  ok: boolean;
  lastRunAt?: string;
}

export function ConnectorStatusBar({ statuses }: { statuses: ConnectorStatus[] }) {
  // A strip listing all nine sources with LIVE beside each spent twenty words
  // saying "everything is fine". Healthy sources collapse to a single count;
  // only the ones that need attention are named, so the strip is worth a
  // glance instead of being tuned out.
  const live = statuses.filter(s => s.ok && s.mode !== 'mock');
  const degraded = statuses.filter(s => !s.ok || s.mode === 'mock');

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-7 py-1 px-4 border-t border-ink-700 bg-ink-950 text-2xs text-ink-400">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-signal-green" />
        <span className="font-mono tabular-nums text-ink-200">{live.length}</span>
        <span>live</span>
      </span>

      {degraded.map(s => (
        <span key={s.id ?? s.source} className="flex items-center gap-1.5" title={s.ok ? 'Using bundled fixtures' : 'Source unavailable'}>
          <span className={cn('w-1.5 h-1.5 rounded-full', s.ok ? 'bg-signal-amber' : 'bg-signal-red')} />
          <span className="text-ink-300">{s.label ?? sourceLabel(s.source)}</span>
          <span className={cn('font-mono', s.ok ? 'text-signal-amber' : 'text-signal-red')}>
            {s.ok ? 'mock' : 'down'}
          </span>
        </span>
      ))}

      <span className="ml-auto font-mono text-ink-500">60s · 5m · 15m · 60m</span>
    </footer>
  );
}
