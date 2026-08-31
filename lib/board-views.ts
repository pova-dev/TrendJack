import type { ColumnConfig, ColumnType } from '@/types';

// Board views.
//
// Thirteen columns at a fixed 360px is 4,940px, of which a 1440px laptop shows
// under four. The rest were reachable only by scrolling sideways past columns
// you were not looking for, which is how a war room becomes a wall.
//
// Grouping is not arbitrary. Four of the thirteen are what the codebase itself
// calls observer lanes: they deliberately re-show trends other columns already
// own, filtered by a warning condition. They are monitors, not workstreams, and
// they were consuming a third of the horizontal space to repeat what was
// already on screen. Those move to a strip. The rest split by the question the
// operator is asking, because "what do I post" and "what are rivals doing" are
// different sittings, not different scroll positions.

export type ViewId = 'act' | 'discover' | 'rivals';

export interface BoardView {
  id: ViewId;
  label: string;
  /** Shown as the caption. Says what question the view answers. */
  caption: string;
  /** Column types this view claims, in display order. */
  types: ColumnType[];
  /** Titles for columns typed `custom`, which carry no type to match on. */
  titles?: string[];
}

export const VIEWS: BoardView[] = [
  {
    id: 'act',
    label: 'Act',
    caption: 'What to do something about',
    types: ['brand_matches', 'first_mover_window'],
    titles: ['📌 Pinned Watchlist'],
  },
  {
    id: 'discover',
    label: 'Discover',
    caption: 'What is moving that you have not caught',
    types: ['rising_trends'],
    titles: ['Trending Now', 'Sci & Tech Google'],
  },
  {
    id: 'rivals',
    label: 'Rivals',
    caption: 'What the competition is doing',
    types: ['competitor_activity'],
    titles: ['X Trending Now', 'Meta Ad Library · competitors'],
  },
];

/**
 * Columns that monitor rather than claim.
 *
 * Kept in sync with OBSERVER_TYPES in lib/columns.ts, which is the authority
 * for the dedup phase. A test pins the two together, because a column that
 * claims here but observes there would vanish from the board entirely.
 */
export const MONITOR_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'alerts', 'risk_watch', 'decay_watch', 'compliance_hold', 'crisis_watch', 'high_velocity',
]);

export function isMonitor(col: Pick<ColumnConfig, 'type'>): boolean {
  return MONITOR_TYPES.has(col.type);
}

/**
 * Split a board's columns into the three views plus the monitor strip.
 *
 * Anything unrecognised lands in Discover rather than disappearing. A custom
 * column an operator built themselves must remain reachable, and silently
 * dropping it would be the worst possible outcome of a layout change.
 */
export function partitionColumns(columns: ColumnConfig[]): {
  views: Record<ViewId, ColumnConfig[]>;
  monitors: ColumnConfig[];
} {
  const views: Record<ViewId, ColumnConfig[]> = { act: [], discover: [], rivals: [] };
  const monitors: ColumnConfig[] = [];

  for (const col of columns) {
    if (isMonitor(col)) { monitors.push(col); continue; }

    const view = VIEWS.find(v =>
      v.types.includes(col.type) || v.titles?.includes(col.title),
    );
    views[view?.id ?? 'discover'].push(col);
  }

  return { views, monitors };
}
