'use client';
import * as React from 'react';
import type { ColumnConfig, Trend } from '@/types';
import { TrendCard } from '@/components/trend/TrendCard';
import { cn } from '@/lib/utils';

// Per-column sort options. Persisted to localStorage so each operator's
// preference survives reloads. Default is "latest" (firstSeenAt DESC).
export type ColumnSortKey =
  | 'latest'        // newest by firstSeenAt
  | 'oldest'        // oldest by firstSeenAt
  | 'volume'        // highest velocity first
  | 'reach'         // highest reach first
  | 'opportunity'   // highest opportunity score
  | 'relevance';    // highest brandFit

const SORT_LABELS: Record<ColumnSortKey, string> = {
  latest:      'Latest first',
  oldest:      'Oldest first',
  volume:      'Highest volume',
  reach:       'Highest reach',
  opportunity: 'Best opportunity',
  relevance:   'Most relevant',
};

function sortTrends(trends: Trend[], key: ColumnSortKey): Trend[] {
  const t = (s: string | Date) => (typeof s === 'string' ? new Date(s) : s).getTime();
  const arr = [...trends];
  switch (key) {
    case 'latest':      return arr.sort((a, b) => t(b.firstSeenAt) - t(a.firstSeenAt));
    case 'oldest':      return arr.sort((a, b) => t(a.firstSeenAt) - t(b.firstSeenAt));
    case 'volume':      return arr.sort((a, b) => b.velocity - a.velocity);
    case 'reach':       return arr.sort((a, b) => Number(b.reach) - Number(a.reach));
    case 'opportunity': return arr.sort((a, b) => b.scores.opportunity - a.scores.opportunity);
    case 'relevance':   return arr.sort((a, b) => b.scores.brandFit - a.scores.brandFit);
  }
}

interface Props {
  column: ColumnConfig;
  trends: Trend[];
  activeTrendId?: string | null;
  lastTickAt?: Date;
  dragging?: boolean;
  onOpenTrend: (id: string) => void;
  onAction: (id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') => void;
  onEditColumn?: () => void;
  onDeleteColumn?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

const COLUMN_ICONS: Record<string, string> = {
  brand_matches: '◆', rising_trends: '▲', competitor_activity: '⚔', emerging_memes: '☄',
  high_velocity: '⚡', risk_watch: '⚠', creator_signals: '☆', approved_opportunities: '✓',
  draft_ideas: '✎', alerts: '◉', first_mover_window: '⌖', decay_watch: '↓',
  compliance_hold: '⛨', localization_queue: '◎', crisis_watch: '✕', custom: '·',
};

export function BoardColumn({
  column, trends, activeTrendId, lastTickAt, dragging,
  onOpenTrend, onAction, onEditColumn, onDeleteColumn,
  onDragStart, onDragEnd,
}: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const sortStorageKey = `tj.col-sort.${column.id}`;
  const [sortKey, setSortKey] = React.useState<ColumnSortKey>('latest');

  // Restore the operator's sort preference on mount + persist on change.
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(sortStorageKey);
      if (v && v in SORT_LABELS) setSortKey(v as ColumnSortKey);
    } catch { /* localStorage may be unavailable in private mode */ }
  }, [sortStorageKey]);
  const updateSort = (k: ColumnSortKey) => {
    setSortKey(k);
    setSortOpen(false);
    try { localStorage.setItem(sortStorageKey, k); } catch {}
  };

  const sortedTrends = React.useMemo(() => sortTrends(trends, sortKey), [trends, sortKey]);
  const tickLabel = lastTickAt
    ? `${Math.max(0, Math.floor((Date.now() - lastTickAt.getTime()) / 1000))}s`
    : '—';

  return (
    <section
      className={cn(
        'flex flex-col flex-shrink-0 w-[360px] h-[calc(100%-12px)] my-1.5 mx-1 rounded-xl bg-ink-850 border border-ink-700/60 shadow-col overflow-hidden transition-opacity',
        dragging && 'opacity-40 ring-1 ring-flare-500',
      )}
      aria-label={column.title}
    >
      <header
        draggable
        onDragStart={e => {
          // dataTransfer.setData is required by Firefox/Safari to actually
          // begin a drag operation. Without it, dragstart fires but no drag
          // session is initiated.
          e.dataTransfer.setData('text/plain', column.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart?.();
        }}
        onDragEnd={onDragEnd}
        className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2.5 border-b border-ink-700 bg-ink-850/95 backdrop-blur relative cursor-grab active:cursor-grabbing select-none rounded-t-xl"
        title="Drag column header to reorder"
      >
        <span className="text-flare-400 font-mono text-sm select-none">⠿</span>
        <span className="text-ink-300 font-mono text-xs">{COLUMN_ICONS[column.type] ?? '·'}</span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-100 truncate">{column.title}</h2>
        <span className="text-2xs font-mono text-ink-400 tabular-nums ml-auto">{trends.length}</span>
        <span className="text-2xs font-mono text-ink-500 tabular-nums">⏱{tickLabel}</span>
        {/* Sort selector — title attribute shows the current key on hover */}
        <button
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setSortOpen(v => !v); }}
          className="text-2xs font-mono text-ink-400 hover:text-ink-100 px-1"
          title={`Sort: ${SORT_LABELS[sortKey]}`}
        >
          {sortKey === 'latest'      ? '↓⏱'
           : sortKey === 'oldest'    ? '↑⏱'
           : sortKey === 'volume'    ? '↓vol'
           : sortKey === 'reach'     ? '↓reach'
           : sortKey === 'opportunity' ? '↓opp'
           :                          '↓fit'}
        </button>
        {sortOpen && (
          <div
            onMouseDown={e => e.stopPropagation()}
            className="absolute right-12 top-9 z-20 w-36 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-1"
          >
            {(Object.keys(SORT_LABELS) as ColumnSortKey[]).map(k => (
              <button
                key={k}
                onClick={() => updateSort(k)}
                className={cn(
                  'block w-full text-left px-2 py-1.5 text-xs rounded',
                  k === sortKey ? 'text-flare-400 bg-ink-700' : 'text-ink-200 hover:bg-ink-700',
                )}
              >
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        )}
        {(onEditColumn || onDeleteColumn) && (
          // Mark non-draggable so the menu button works without starting a drag.
          <button
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            className="text-ink-400 hover:text-ink-100 px-1"
          >⋯</button>
        )}
        {menuOpen && (
          <div className="absolute right-2 top-9 z-20 w-36 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-1">
            {onEditColumn && (
              <button onClick={() => { setMenuOpen(false); onEditColumn(); }}
                className="block w-full text-left px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-700 rounded">Edit column</button>
            )}
            {onDeleteColumn && (
              <button onClick={() => { setMenuOpen(false); onDeleteColumn(); }}
                className="block w-full text-left px-2 py-1.5 text-xs text-signal-red hover:bg-ink-700 rounded">Remove</button>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto divide-y divide-ink-700/40">
        {sortedTrends.length === 0 && (
          <div className="px-3 py-6 text-center text-2xs text-ink-400 font-mono">no signals match this column&apos;s filters</div>
        )}
        {sortedTrends.map(t => (
          <TrendCard
            key={t.id}
            trend={t}
            active={activeTrendId === t.id}
            onOpen={onOpenTrend}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}
