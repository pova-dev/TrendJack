'use client';
import * as React from 'react';
import type { ColumnConfig, ColumnType, Trend } from '@/types';
import { cn } from '@/lib/utils';
import { VIEWS, type ViewId } from '@/lib/board-views';
import { Drawer } from '@/components/ui/Drawer';
import { TrendCard } from '@/components/trend/TrendCard';

// The board's own navigation, plus the monitor strip.
//
// Views exist because thirteen columns do not fit on any screen anybody owns.
// The monitor strip exists because four of those thirteen never needed to be
// columns: they re-show trends the other columns already claim, filtered by a
// warning. As columns they cost a third of the width to repeat what was
// already on screen. As counts they cost one row and say the same thing.

interface MonitorSummary {
  id: string;
  title: string;
  type: ColumnType;
  count: number;
}

export function ViewTabs({
  active, onChange, counts, monitors, onOpenMonitor,
}: {
  active: ViewId;
  onChange: (v: ViewId) => void;
  counts: Record<ViewId, number>;
  monitors: MonitorSummary[];
  onOpenMonitor: (id: string) => void;
}) {
  // 1/2/3 jumps between views. The board already owns j/k and cmd+shift+c, so
  // this follows the same convention rather than inventing a modifier.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0 && VIEWS[idx]) onChange(VIEWS[idx].id);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onChange]);

  const caption = VIEWS.find(v => v.id === active)?.caption;

  return (
    <div className="shrink-0 border-b border-ink-700/70 bg-ink-950/40">
      <div className="flex items-center gap-1 px-2 sm:px-3 overflow-x-auto tj-scroll">
        {VIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onChange(v.id)}
            aria-current={v.id === active ? 'true' : undefined}
            className={cn(
              'relative shrink-0 px-3 h-10 flex items-center gap-2 text-sm',
              'motion-safe:transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-inset',
              v.id === active ? 'text-ink-100 font-medium' : 'text-ink-400 hover:text-ink-200',
            )}
          >
            {v.label}
            <span className={cn(
              'text-2xs font-mono tabular-nums',
              v.id === active ? 'text-ink-400' : 'text-ink-600',
            )}>
              {counts[v.id]}
            </span>
            <kbd className="hidden lg:inline text-[9px] font-mono text-ink-600">{i + 1}</kbd>
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-2 right-2 bottom-0 h-px',
                v.id === active ? 'bg-flare-500' : 'bg-transparent',
              )}
            />
          </button>
        ))}

        <p className="hidden xl:block ml-3 text-2xs text-ink-600 truncate">{caption}</p>

        {/* Monitors. Counts only, expanding on click. A lane with nothing in it
            is rendered dimmed rather than hidden, because a warning lane
            disappearing is indistinguishable from it being removed. */}
        {monitors.length > 0 && (
          <div className="ml-auto flex items-center gap-1 shrink-0 pl-3">
            {monitors.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenMonitor(m.id)}
                title={`${m.title} — ${m.count} signal${m.count === 1 ? '' : 's'}`}
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-mono',
                  'motion-safe:transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400',
                  m.count > 0
                    ? 'text-ink-300 hover:text-ink-100 hover:bg-ink-800'
                    : 'text-ink-600 hover:bg-ink-800/60',
                )}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  m.count === 0 ? 'bg-ink-700' : toneFor(m.type),
                )} />
                <span className="hidden sm:inline">{shortLabel(m.title, m.type)}</span>
                <span className="tabular-nums">{m.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * An expanded monitor lane.
 *
 * A drawer rather than a column: these are consulted when something looks
 * wrong, not read continuously, and giving them permanent width is what made
 * the board unusable in the first place.
 */
export function MonitorDrawer({
  column, trends, onClose, onOpenTrend, onAction,
}: {
  column: ColumnConfig | null;
  trends: Trend[];
  onClose: () => void;
  onOpenTrend: (id: string) => void;
  /** Threaded through so a signal can be acted on from the lane that raised
   *  it. Spotting a risk and then having to hunt for the same card in a column
   *  to dismiss it is the kind of dead end that makes people stop looking. */
  onAction: (id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') => void;
}) {
  return (
    <Drawer open={!!column} onClose={onClose} width={460}>
      {column && (
        <div className="flex flex-col h-full">
          <header className="shrink-0 px-4 py-3 border-b border-ink-700">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-ink-100">{column.title}</h2>
              <span className="text-2xs font-mono text-ink-500 tabular-nums">{trends.length}</span>
            </div>
            <p className="mt-0.5 text-2xs text-ink-500">
              A filtered view of signals other columns already hold. Nothing here is exclusive to this lane.
            </p>
          </header>
          <div className="flex-1 overflow-y-auto tj-scroll divide-y divide-ink-800/70">
            {trends.length === 0 ? (
              <p className="p-6 text-center text-xs text-ink-500">Nothing is matching this right now.</p>
            ) : (
              // TrendCard is already interactive. Wrapping it in a button
              // would nest controls, which breaks keyboard navigation and is
              // invalid markup.
              trends.map(t => (
                <TrendCard key={t.id} trend={t} onOpen={onOpenTrend} onAction={onAction} />
              ))
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Severity colour for the dot. Alerts and crisis read as red; decay and
 *  saturation are amber, since they mean "fading" rather than "danger". */
function toneFor(type: ColumnType): string {
  switch (type) {
    case 'alerts':
    case 'crisis_watch':
    case 'risk_watch':
      return 'bg-signal-red';
    case 'decay_watch':
    case 'compliance_hold':
      return 'bg-signal-amber';
    default:
      return 'bg-signal-blue';
  }
}

/**
 * One-word label for the strip.
 *
 * Keyed on type rather than parsed from the title. Taking the first word of an
 * operator-written title turned "Trend Risk Watch" into "Trend", which names
 * the wrong thing entirely: every lane is about trends, and the one word that
 * mattered was Risk. Falls back to the title only for a custom lane, where the
 * operator's own wording is all there is.
 */
const MONITOR_LABELS: Partial<Record<ColumnType, string>> = {
  alerts: 'Alerts',
  risk_watch: 'Risk',
  decay_watch: 'Decay',
  crisis_watch: 'Crisis',
  compliance_hold: 'Legal',
  high_velocity: 'Fast',
};

function shortLabel(title: string, type: ColumnType): string {
  const known = MONITOR_LABELS[type];
  if (known) return known;
  const cleaned = title.replace(/^[^\w]+\s*/, '');       // drop a leading emoji
  const first = cleaned.split(/[\s·]/)[0];
  return first.length > 10 ? `${first.slice(0, 9)}…` : first;
}
