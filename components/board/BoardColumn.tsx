'use client';
import * as React from 'react';
import type { ColumnConfig, Trend } from '@/types';
import { TrendCard } from '@/components/trend/TrendCard';
import { cn } from '@/lib/utils';
import type { ClusteredTrend } from '@/lib/columns';

// Time-window options for Brand Matches column. Operator picks how far
// back to look — 'today' is the default reactive lens; '30d' is the
// retrospective audit lens. Stored per-column in localStorage so the
// preference survives reloads.
export type WindowDays = 1 | 7 | 15 | 30;
const WINDOW_LABELS: Record<WindowDays, string> = {
  1:  'Today',
  7:  '7 days',
  15: '15 days',
  30: '30 days',
};

// Per-column sort options. Persisted to localStorage so each operator's
// preference survives reloads. Default is "latest" (firstSeenAt DESC).
export type ColumnSortKey =
  | 'latest'        // newest by firstSeenAt
  | 'oldest'        // oldest by firstSeenAt
  | 'volume'        // highest velocity first
  | 'reach'         // highest reach first
  | 'opportunity'   // highest opportunity score
  | 'cvs'           // highest CVS / Jacking Score (canonical trigger)
  | 'relevance';    // highest brandFit

const SORT_LABELS: Record<ColumnSortKey, string> = {
  latest:      'Latest first',
  oldest:      'Oldest first',
  volume:      'Highest volume',
  reach:       'Highest reach',
  opportunity: 'Best opportunity',
  cvs:         'Highest CVS',
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
    case 'cvs':         return arr.sort((a, b) => (b.scores.jackingScore ?? 0) - (a.scores.jackingScore ?? 0));
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
  const [windowOpen, setWindowOpen] = React.useState(false);
  const sortStorageKey = `tj.col-sort.${column.id}`;
  const windowStorageKey = `tj.col-window.${column.id}`;
  const [sortKey, setSortKey] = React.useState<ColumnSortKey>('latest');
  // Brand Matches gets the window selector. Default 'Today' so the
  // reactive lens is the primary view; switch to 7/15/30d for audit.
  const showWindow = column.type === 'brand_matches';
  const [windowDays, setWindowDays] = React.useState<WindowDays>(1);

  // Restore preferences on mount + persist on change.
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(sortStorageKey);
      if (v && v in SORT_LABELS) setSortKey(v as ColumnSortKey);
      const w = localStorage.getItem(windowStorageKey);
      if (w && [1, 7, 15, 30].includes(Number(w))) setWindowDays(Number(w) as WindowDays);
    } catch { /* localStorage may be unavailable in private mode */ }
  }, [sortStorageKey, windowStorageKey]);
  const updateSort = (k: ColumnSortKey) => {
    setSortKey(k);
    setSortOpen(false);
    try { localStorage.setItem(sortStorageKey, k); } catch {}
  };
  const updateWindow = (d: WindowDays) => {
    setWindowDays(d);
    setWindowOpen(false);
    try { localStorage.setItem(windowStorageKey, String(d)); } catch {}
  };

  // Brand Matches: filter trends by the selected window before sorting.
  // Older trends in longer windows get a LEGACY treatment via TrendCard.
  const windowedTrends = React.useMemo(() => {
    if (!showWindow) return trends;
    const cutoff = Date.now() - windowDays * 24 * 3_600_000;
    return trends.filter(t => new Date(t.firstSeenAt).getTime() >= cutoff);
  }, [trends, showWindow, windowDays]);

  const sortedTrends = React.useMemo(() => sortTrends(windowedTrends, sortKey), [windowedTrends, sortKey]);
  const tickLabel = lastTickAt
    ? `${Math.max(0, Math.floor((Date.now() - lastTickAt.getTime()) / 1000))}s`
    : '—';

  return (
    <section
      className={cn(
        // Mobile (<sm): column fills the viewport minus the LeftRail
        //   (60px) and a small breathing margin (8px = 4px each side
        //   from mx-1). On a 390px iPhone this gives a 322px column.
        // Desktop (≥sm): fixed 360px so multiple columns fit on screen.
        'flex flex-col flex-shrink-0 w-[calc(100vw-72px)] sm:w-[360px] h-[calc(100%-12px)] my-1.5 mx-1',
        'rounded-lg bg-ink-900 border border-ink-700/70 overflow-hidden',
        'transition-[opacity,border-color] duration-150 hover:border-ink-600',
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
        className="group/hdr sticky top-0 z-10 flex items-center gap-2.5 px-3.5 py-3 border-b border-ink-700/70 bg-ink-850/90 backdrop-blur-sm relative cursor-grab active:cursor-grabbing select-none"
        title="Drag column header to reorder"
      >
        <span
          aria-hidden="true"
          className="w-[3px] h-4 rounded-full bg-flare-500/70 shrink-0 transition-colors group-hover/hdr:bg-flare-500"
        />
        <span className="text-ink-400 font-mono text-xs shrink-0">{COLUMN_ICONS[column.type] ?? '·'}</span>
        <h2 className="text-sm font-semibold text-ink-100 truncate tracking-[-0.01em]">{column.title}</h2>
        <span
          className="text-xs font-mono text-ink-400 tabular-nums shrink-0"
          title={`${windowedTrends.length} trends in this column`}
        >
          {windowedTrends.length}
        </span>
        {/* Controls are used rarely; keeping six of them permanently visible at
            the same weight as the title is what made the header read as a
            toolbar rather than a label. They reveal on hover, and stay put on
            touch where there is no hover to perform. */}
        <span
          className={cn(
            'ml-auto flex items-center gap-1.5 shrink-0 motion-safe:transition-opacity duration-150',
            // An open dropdown pins the controls visible. Without this,
            // moving the pointer down onto the menu leaves the header, the
            // reveal fades, and the menu vanishes mid-click.
            (windowOpen || sortOpen || menuOpen)
              ? 'opacity-100'
              : 'sm:opacity-0 sm:group-hover/hdr:opacity-100 sm:focus-within:opacity-100',
          )}
        >
        {/* Brand Matches: window selector (Today/7d/15d/30d). Operator
            picks the look-back lens — reactive (today) vs retrospective
            (30d). Per-column, persisted to localStorage. */}
        {showWindow && (
          <>
            <button
              draggable={false}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setWindowOpen(v => !v); }}
              className="flex items-center gap-1 text-2xs font-mono text-ink-300 hover:text-ink-100 hover:bg-ink-800 px-1.5 py-0.5 rounded border border-ink-700/60"
              title={`Window: ${WINDOW_LABELS[windowDays]} — click to change`}
            >
              <span className="text-ink-500">◷</span>
              <span>{WINDOW_LABELS[windowDays]}</span>
            </button>
            {windowOpen && (
              <div
                onMouseDown={e => e.stopPropagation()}
                className="absolute right-24 top-9 z-20 w-32 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-1"
              >
                {([1, 7, 15, 30] as WindowDays[]).map(d => (
                  <button
                    key={d}
                    onClick={() => updateWindow(d)}
                    className={cn(
                      'block w-full text-left px-2 py-1.5 text-xs rounded',
                      d === windowDays ? 'text-flare-400 bg-ink-700' : 'text-ink-200 hover:bg-ink-700',
                    )}
                  >
                    {WINDOW_LABELS[d]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {/* Sort selector — text label instead of cryptic glyph. Each
            sort key gets a short word so the operator can read what's
            active at a glance. */}
        <button
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setSortOpen(v => !v); }}
          className="flex items-center gap-1 text-2xs font-mono text-ink-300 hover:text-ink-100 hover:bg-ink-800 px-1.5 py-0.5 rounded border border-ink-700/60"
          title={`Sort: ${SORT_LABELS[sortKey]} — click to change`}
        >
          <span className="text-ink-500">⇅</span>
          <span>
            {sortKey === 'latest'      ? 'newest'
             : sortKey === 'oldest'    ? 'oldest'
             : sortKey === 'volume'    ? 'volume'
             : sortKey === 'reach'     ? 'reach'
             : sortKey === 'opportunity' ? 'OPP'
             : sortKey === 'cvs'       ? 'CVS'
             :                          'FIT'}
          </span>
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
        </span>
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

      <div className="flex-1 overflow-y-auto divide-y divide-ink-800/70">
        {sortedTrends.length === 0 && (
          <div className="px-6 py-12 text-center">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border border-dashed border-ink-600" aria-hidden="true" />
            <p className="text-sm text-ink-300">Nothing matches yet</p>
            <p className="mt-1 text-xs text-ink-500">This column&apos;s filters found no signals in the current window.</p>
          </div>
        )}
        {sortedTrends.map(t => {
          const c = t as ClusteredTrend;
          return (
            <TrendCard
              key={t.id}
              trend={t}
              active={activeTrendId === t.id}
              onOpen={onOpenTrend}
              onAction={onAction}
              clusterCount={c._clusterCount}
              showLegacyChip={showWindow && windowDays > 7}
            />
          );
        })}
      </div>
    </section>
  );
}
