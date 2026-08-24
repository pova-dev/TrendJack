'use client';
import * as React from 'react';
import type { BoardConfig, ColumnConfig, Trend } from '@/types';
import { BoardColumn } from './BoardColumn';
import { DetailDrawer } from '@/components/drawer/DetailDrawer';
import { applyColumnFilter, assignTrendsToColumns } from '@/lib/columns';
import { useBoardStream } from '@/lib/realtime/use-board-stream';
import { createCoalescer } from '@/lib/realtime/coalesce';
import { ColumnBuilder } from './ColumnBuilder';

interface Props {
  initialBoard: BoardConfig;
  initialTrends: Trend[];
  brandId: string;
}

export function Board({ initialBoard, initialTrends, brandId }: Props) {
  const [board, setBoard] = React.useState<BoardConfig>(initialBoard);
  const [trends, setTrends] = React.useState<Trend[]>(initialTrends);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [tickAt, setTickAt] = React.useState<Date>(new Date());
  const [columnEditor, setColumnEditor] = React.useState<{ open: boolean; col?: ColumnConfig } | null>(null);

  // Refresh failure, surfaced instead of swallowed. Previously a dead API left
  // the board showing stale cards forever with nothing to indicate it had
  // stopped updating, which is the worst possible failure for a war room.
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  // Ingestion arrives in bursts: one cron tick inserts 100+ trends and every
  // insert publishes its own SSE event. Refetching per event produced ~125
  // requests per minute from a single idle tab, each one a ~840ms scan over
  // the trend table. Measured at ~7,500 requests/hour with nobody touching it.
  //
  // Coalesce instead. Burst events collapse into one refetch, and only one
  // request is ever in flight: anything that arrives mid-flight sets a flag so
  // exactly one more run follows, which keeps the board current without
  // stampeding the API.
  const coalescer = React.useMemo(() => createCoalescer(async () => {
    try {
      const res = await fetch('/api/trends?excludeDismissed=true&limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(`refresh failed (HTTP ${res.status})`);
      const json = await res.json() as { items: Trend[] };
      setTrends(json.items);
      setTickAt(new Date());
      setRefreshError(null);
    } catch (e) {
      setRefreshError((e as Error).message || 'refresh failed');
    }
  }, 1_500), []);

  const refetch = React.useCallback(() => coalescer.trigger(), [coalescer]);
  React.useEffect(() => () => coalescer.cancel(), [coalescer]);

  // Realtime: any trend or weight or profile change → refetch the slice.
  useBoardStream(board.id, {
    onTrendChange: refetch,
    onProfileChange: refetch,
    onWeightsChange: refetch,
    onTick: at => setTickAt(new Date(at)),
  });

  // Keyboard nav across columns
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'j' || e.key === 'k') {
        const flat = collectVisibleTrendIds(board.columns, trends);
        if (!flat.length) return;
        const idx = activeId ? flat.indexOf(activeId) : -1;
        const next = e.key === 'j'
          ? flat[Math.min(flat.length - 1, idx + 1)] ?? flat[0]
          : flat[Math.max(0, idx - 1)] ?? flat[0];
        setActiveId(next);
      } else if (e.key === 'Escape') {
        setActiveId(null);
      } else if (e.key === 'c' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setColumnEditor({ open: true });
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeId, board.columns, trends]);

  // Dismiss intercept — when the operator clicks Dismiss, surface a
  // reason-chip modal first (Feature D Phase 3). The reason is
  // forwarded to the action payload so the calibration agent can
  // disambiguate "off-brand" vs "saturated" vs "wrong audience" etc.
  // (see lib/store.ts:recordAction publisher → STREAMS.operatorFeedback).
  // Skipping the modal still works — empty reason = generic dismiss.
  const [pendingDismissId, setPendingDismissId] = React.useState<string | null>(null);

  async function onAction(id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') {
    // Dismiss → ask why first (the reason feeds calibration). Skip the
    // modal when something else has already opened it (defensive — caller
    // can pass a payload with reason directly via doAction).
    if (type === 'dismiss' && !pendingDismissId) {
      setPendingDismissId(id);
      return;
    }
    return doAction(id, type);
  }

  async function doAction(
    id: string,
    type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin',
    payload?: Record<string, unknown>,
  ) {
    if (type === 'dismiss') {
      setTrends(prev => prev.filter(t => t.id !== id));
    } else if (type === 'pin') {
      setTrends(prev => prev.map(t => (t.id === id ? { ...t, pinned: !t.pinned } : t)));
    }
    await fetch(`/api/trends/${id}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
    if (type === 'generate') {
      await fetch(`/api/trends/${id}/generate`, { method: 'POST' });
      setActiveId(id);
    }
  }

  async function saveColumn(col: ColumnConfig) {
    const next: BoardConfig = {
      ...board,
      columns: columnEditor?.col
        ? board.columns.map(c => (c.id === columnEditor.col!.id ? col : c))
        : [...board.columns, col],
    };
    setBoard(next);
    setColumnEditor(null);
    await fetch('/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
  }

  async function deleteColumn(colId: string) {
    const next = { ...board, columns: board.columns.filter(c => c.id !== colId) };
    setBoard(next);
    await fetch('/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
  }

  // Drag-and-drop reorder. We use HTML5 native DnD — no external lib.
  // dragColId tracks which column is being dragged; overIdx is the insert
  // position the user is hovering. We splice optimistically and persist.
  const [dragColId, setDragColId] = React.useState<string | null>(null);
  const [overIdx, setOverIdx] = React.useState<number | null>(null);

  function onDragStart(colId: string) { setDragColId(colId); }
  function onDragEnd() { setDragColId(null); setOverIdx(null); }
  function onDragOverIdx(idx: number, e: React.DragEvent) {
    if (!dragColId) return;
    e.preventDefault();
    setOverIdx(idx);
  }
  async function onDrop(idx: number) {
    if (!dragColId) return;
    const cols = board.columns.slice();
    const fromIdx = cols.findIndex(c => c.id === dragColId);
    if (fromIdx < 0) return;
    const [moved] = cols.splice(fromIdx, 1);
    const insertAt = idx > fromIdx ? idx - 1 : idx;
    cols.splice(insertAt, 0, moved);
    const next = { ...board, columns: cols };
    setBoard(next);
    setDragColId(null);
    setOverIdx(null);
    await fetch('/api/boards', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
  }

  const active = trends.find(t => t.id === activeId) ?? null;

  // Expose addColumn so the parent (page) can wire the +Column button if needed.
  React.useEffect(() => {
    function handler() { setColumnEditor({ open: true }); }
    window.addEventListener('tj:add-column', handler);
    return () => window.removeEventListener('tj:add-column', handler);
  }, []);

  // Cross-column priority assignment — each trend appears in exactly ONE
  // column (its highest-priority match). Computed once per render against
  // the current trends list; columns render in user's configured order
  // but the claim phase iterates by priority.
  const columnAssignments = React.useMemo(
    () => assignTrendsToColumns(board.columns, trends),
    [board.columns, trends],
  );

  // Board scroll container.
  //   Mobile (<sm): columns are full-screen-width with scroll-snap so
  //   swiping moves between exactly one column at a time.
  //   Desktop (≥sm): traditional horizontal scroll, multiple columns visible.
  return (
    <div className="flex flex-1 h-full overflow-x-auto overflow-y-hidden bg-ink-900 snap-x snap-mandatory sm:snap-none">
      {refreshError && (
        <div
          role="status"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-40 rounded-md border border-signal-amber/40 bg-signal-amber/10 px-3 py-1.5 text-2xs font-mono text-signal-amber"
        >
          Showing last known data. {refreshError}
        </div>
      )}
      {board.columns.map((col, idx) => (
        <React.Fragment key={col.id}>
          {/* Drop slot before this column */}
          <DropSlot active={overIdx === idx && dragColId !== null}
            onDragOver={e => onDragOverIdx(idx, e)} onDrop={() => onDrop(idx)} />
          {/* Hovering over the column itself snaps the indicator to its right edge */}
          <div
            onDragOver={dragColId ? e => onDragOverIdx(idx + 1, e) : undefined}
            onDrop={dragColId ? () => onDrop(idx + 1) : undefined}
            className="flex-shrink-0 snap-start sm:snap-align-none"
          >
            <BoardColumn
              column={col}
              trends={columnAssignments.get(col.id) ?? []}
              activeTrendId={activeId}
              lastTickAt={tickAt}
              dragging={dragColId === col.id}
              onOpenTrend={setActiveId}
              onAction={onAction}
              onEditColumn={() => setColumnEditor({ open: true, col })}
              onDeleteColumn={() => deleteColumn(col.id)}
              onDragStart={() => onDragStart(col.id)}
              onDragEnd={onDragEnd}
            />
          </div>
        </React.Fragment>
      ))}
      <DropSlot active={overIdx === board.columns.length && dragColId !== null}
        onDragOver={e => onDragOverIdx(board.columns.length, e)} onDrop={() => onDrop(board.columns.length)} />
      <button
        onClick={() => setColumnEditor({ open: true })}
        className="flex-shrink-0 w-12 hover:bg-ink-800 border-r border-ink-700/60 flex items-center justify-center text-ink-500 hover:text-flare-400"
        title="Add column (Cmd+Shift+C)"
      >
        +
      </button>
      <DetailDrawer trend={active} open={!!active} onClose={() => setActiveId(null)} onAction={onAction} />
      {columnEditor?.open && (
        <ColumnBuilder
          open
          initial={columnEditor.col}
          onClose={() => setColumnEditor(null)}
          onSave={saveColumn}
        />
      )}
      <DismissReasonModal
        trendId={pendingDismissId}
        onCancel={() => setPendingDismissId(null)}
        onSubmit={(reason) => {
          const id = pendingDismissId;
          setPendingDismissId(null);
          if (id) void doAction(id, 'dismiss', reason ? { reason } : undefined);
        }}
      />
    </div>
  );
}

function DropSlot({ active, onDragOver, onDrop }: { active: boolean; onDragOver: (e: React.DragEvent) => void; onDrop: () => void }) {
  return (
    <div
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        'flex-shrink-0 self-stretch transition-all ' +
        (active ? 'w-2 bg-flare-500' : 'w-2 bg-transparent hover:bg-ink-700/30')
      }
    />
  );
}

function collectVisibleTrendIds(cols: ColumnConfig[], trends: Trend[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cols) {
    for (const t of applyColumnFilter(c, trends)) {
      if (!seen.has(t.id)) { seen.add(t.id); out.push(t.id); }
    }
  }
  return out;
}

// Reason-chip modal — Feature D Phase 3. Operator picks one chip
// (no free-text required) and the reason flows into the dismiss
// action's payload, which the publisher includes in the
// OperatorFeedbackMessage. The calibration agent doesn't currently
// use the reason field for bucket math (Phase 4 will), but capturing
// it now means the dataset is ready when we do.
const DISMISS_REASONS = [
  { id: 'off_brand',  label: 'Off-brand' },
  { id: 'cringe',     label: 'Too cringe' },
  { id: 'saturated',  label: 'Already saturated' },
  { id: 'wrong_audience', label: 'Wrong audience' },
  { id: 'not_now',    label: 'Not now' },
  { id: 'low_fit',    label: 'Weak topical fit' },
] as const;

function DismissReasonModal({
  trendId,
  onCancel,
  onSubmit,
}: {
  trendId: string | null;
  onCancel: () => void;
  onSubmit: (reason: string | null) => void;
}) {
  if (!trendId) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 motion-safe:transition-opacity pointer-events-auto"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tj-dismiss-title"
    >
      <div
        className="w-full sm:max-w-sm rounded-t-xl sm:rounded-xl bg-ink-900 border border-ink-700 shadow-pop p-4 m-2"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="tj-dismiss-title" className="text-sm font-semibold text-ink-100 mb-2">Why dismiss?</h2>
        <p className="text-2xs text-ink-400 mb-3">
          Optional — picking a reason teaches the dashboard to surface fewer
          trends like this. Skip if it's a one-off.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DISMISS_REASONS.map(r => (
            <button
              key={r.id}
              onClick={() => onSubmit(r.id)}
              className="rounded-md px-2.5 h-9 text-xs font-medium text-ink-200 bg-ink-800 hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 px-3 rounded-md text-xs font-medium text-ink-300 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(null)}
            className="h-9 px-3 rounded-md text-xs font-medium bg-ink-700 text-ink-100 hover:bg-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            Dismiss without reason
          </button>
        </div>
      </div>
    </div>
  );
}
