'use client';
import * as React from 'react';
import type { BoardConfig, ColumnConfig, Trend } from '@/types';
import { BoardColumn } from './BoardColumn';
import { DetailDrawer } from '@/components/drawer/DetailDrawer';
import { applyColumnFilter, assignTrendsToColumns } from '@/lib/columns';
import { useBoardStream } from '@/lib/realtime/use-board-stream';
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

  const refetch = React.useCallback(async () => {
    try {
      const res = await fetch('/api/trends?excludeDismissed=true&limit=200', { cache: 'no-store' });
      const json = await res.json();
      setTrends(json.items as Trend[]);
      setTickAt(new Date());
    } catch { /* swallow */ }
  }, []);

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

  async function onAction(id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') {
    // Optimistic local updates so the dashboard feels instant. The
    // server's SSE 'trend.updated' broadcast will reconcile if anything
    // diverges, but we don't wait for it.
    if (type === 'dismiss') {
      setTrends(prev => prev.filter(t => t.id !== id));
    } else if (type === 'pin') {
      // Toggle pin state in local list. With pin moving cards to the
      // Watchlist column exclusively, this makes the card visibly jump
      // (or disappear from Watchlist on unpin) without waiting for the
      // round-trip.
      setTrends(prev => prev.map(t => (t.id === id ? { ...t, pinned: !t.pinned } : t)));
    }
    await fetch(`/api/trends/${id}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
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
