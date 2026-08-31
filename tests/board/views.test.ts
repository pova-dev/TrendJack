// Board view partitioning.
//
// Every column must land somewhere. A column that falls between the views and
// the monitor strip is not merely misplaced, it is gone: the board renders one
// view at a time, so anything unclaimed is invisible with no way to reach it.
//
// The monitor set also has to agree with the dedup phase in lib/columns.ts. If
// a type observes there but is treated as a view column here it would render
// inline while claiming nothing, showing an empty column forever. If it claims
// there and monitors here, the trends it took would disappear from the board.

import { describe, expect, it } from 'vitest';
import { partitionColumns, VIEWS, MONITOR_TYPES, isMonitor } from '@/lib/board-views';
import { assignTrendsToColumns } from '@/lib/columns';
import type { ColumnConfig, ColumnType } from '@/types';

function col(id: string, type: ColumnType, title = id): ColumnConfig {
  return { id, type, title, refreshSec: 60, filters: {}, sort: { key: 'opportunity', dir: 'desc' } } as ColumnConfig;
}

/** The thirteen columns a real POVA board carries. */
const REAL_BOARD: ColumnConfig[] = [
  col('c1', 'custom', '📌 Pinned Watchlist'),
  col('c2', 'brand_matches', 'Brand Matches'),
  col('c3', 'first_mover_window', 'First-Mover Window'),
  col('c4', 'rising_trends', 'Rising Trends'),
  col('c5', 'custom', 'Trending Now'),
  col('c6', 'custom', 'X Trending Now'),
  col('c7', 'custom', 'Meta Ad Library · competitors'),
  col('c8', 'competitor_activity', 'Competitor Activity'),
  col('c9', 'custom', 'Sci & Tech Google'),
  col('c10', 'high_velocity', 'High Velocity Posts'),
  col('c11', 'risk_watch', 'Trend Risk Watch'),
  col('c12', 'decay_watch', 'Decay Watch'),
  col('c13', 'alerts', 'Alerts'),
];

describe('partitioning', () => {
  it('places every column exactly once', () => {
    const { views, monitors } = partitionColumns(REAL_BOARD);
    const placed = [...VIEWS.flatMap(v => views[v.id]), ...monitors].map(c => c.id);

    expect(placed.sort()).toEqual(REAL_BOARD.map(c => c.id).sort());
    expect(new Set(placed).size, 'a column appears in more than one place').toBe(placed.length);
  });

  it('keeps every view within what a laptop can show', () => {
    // Four columns at the 320px floor is 1,280px, which still fits the 1,368px
    // a 1440px laptop leaves after the rail. Five would not.
    const { views } = partitionColumns(REAL_BOARD);
    for (const v of VIEWS) {
      expect(views[v.id].length, `${v.id} holds too many columns to fit`).toBeLessThanOrEqual(4);
      expect(views[v.id].length, `${v.id} is empty, so the tab leads nowhere`).toBeGreaterThan(0);
    }
  });

  it('routes an unrecognised column somewhere reachable rather than dropping it', () => {
    // An operator-built column must never vanish because it matched no rule.
    const custom = col('mine', 'custom', 'My Own Lane');
    const { views, monitors } = partitionColumns([...REAL_BOARD, custom]);
    const placed = [...VIEWS.flatMap(v => views[v.id]), ...monitors].map(c => c.id);
    expect(placed).toContain('mine');
  });

  it('moves the four observer lanes off the columns', () => {
    const { monitors } = partitionColumns(REAL_BOARD);
    expect(monitors.map(c => c.id).sort()).toEqual(['c10', 'c11', 'c12', 'c13']);
  });
});

describe('agreement with the dedup phase', () => {
  it('treats as a monitor exactly what assignTrendsToColumns refuses to let claim', () => {
    // Probed rather than compared against the private set: a monitor type must
    // not take exclusive ownership of a trend away from a claiming column.
    const trend = {
      id: 't1', brandId: 'b', source: 'news', sourceRef: 'r', title: 'x', summary: '',
      hashtags: [], lineage: '', firstSeenAt: new Date().toISOString(),
      velocity: 1, reach: 0, sentiment: 0, audienceOverlap: 0,
      scores: { opportunity: 80, risk: 0.1, cringe: 0.1, saturation: 0.1, virality: 0.5,
        topicalFit: 0.5, tonalFit: 0.5, audienceOverlap: 0.5, brandFit: 0.5, timing: 0.5,
        firstMover: 0.5, formatFatigue: 0.1, assetEffort: 0.1, approvalEffort: 0.1,
        productionEffort: 0.1 },
      rationale: [], recommendation: 'POST_NOW', recommendationReason: '',
      competitorClaimed: false, competitorClaimants: [], formatFatigue: 0.1,
      brandKeywordHit: true, matchedBrandKeywords: ['pova'],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never;

    for (const type of MONITOR_TYPES) {
      // A column only claims when it carries a specificity filter (isPrimary
      // in lib/columns.ts). A bare brand_matches column observes like the rest,
      // so the probe needs a real one to be measuring anything.
      const claiming = {
        ...col('claimer', 'brand_matches', 'Brand Matches'),
        filters: { brandKeywordOnly: true },
      } as ColumnConfig;
      const monitor = col('mon', type as ColumnType, String(type));
      // Monitor first, so if it could claim it would win on order alone.
      const assigned = assignTrendsToColumns([monitor, claiming], [trend]);

      expect(
        assigned.get('claimer')?.length,
        `${type} is treated as a monitor here but claimed the trend in the dedup phase, ` +
        'which would make it vanish from the board',
      ).toBe(1);
    }
  });

  it('agrees on the specific set the board ships with', () => {
    expect(isMonitor({ type: 'alerts' })).toBe(true);
    expect(isMonitor({ type: 'risk_watch' })).toBe(true);
    expect(isMonitor({ type: 'decay_watch' })).toBe(true);
    expect(isMonitor({ type: 'high_velocity' })).toBe(true);
    expect(isMonitor({ type: 'brand_matches' })).toBe(false);
    expect(isMonitor({ type: 'competitor_activity' })).toBe(false);
  });
});
