import * as React from 'react';
import type { SourceId } from '@/types';
import { sourceLabel } from '@/components/trend/SourceIcon';
import { cn } from '@/lib/utils';

interface ConnectorStatus {
  source: SourceId;
  mode: 'live' | 'mock' | 'sim';
  ok: boolean;
  lastRunAt?: string;
}

export function ConnectorStatusBar({ statuses }: { statuses: ConnectorStatus[] }) {
  return (
    <footer className="flex items-center gap-3 h-7 px-4 border-t border-ink-700 bg-ink-950 text-2xs font-mono text-ink-400">
      <span className="uppercase tracking-widest">connectors</span>
      {statuses.map(s => (
        <span key={s.source} className="flex items-center gap-1">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            s.ok ? (s.mode === 'mock' ? 'bg-signal-amber' : 'bg-signal-green') : 'bg-signal-red',
          )} />
          <span className="text-ink-300">{sourceLabel(s.source)}</span>
          <span className="uppercase text-ink-500">{s.mode}</span>
        </span>
      ))}
      <span className="ml-auto">⟳ tiered: 60s · 5m · 15m · 60m</span>
    </footer>
  );
}
