// Social intelligence tests.
//
// This layer produces the numbers an operator will make decisions on, so the
// bar is exactness, not plausibility. Two properties matter most:
//
//   1. Arithmetic is right. Growth, engagement and gaps are checked against
//      hand-computed values, not against whatever the function happens to
//      return.
//   2. Insufficient data yields null, never zero. Reporting "0% growth" for an
//      account polled once is a false claim, and it is the kind that looks
//      entirely normal on a dashboard.

import { describe, expect, it } from 'vitest';
import {
  growth, engagementRate, rankPlatform, findOpportunities, buildDailyBrief,
  type AccountSeries, type SamplePoint,
} from '@/lib/social/analytics';

const DAY = 86_400_000;
const now = Date.now();

/** n readings, `perDay` followers gained each day, ending now. */
function series(start: number, perDay: number, days: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let d = days; d >= 0; d--) {
    out.push({ at: new Date(now - d * DAY), followers: Math.round(start + perDay * (days - d)) });
  }
  return out;
}

const acct = (over: Partial<AccountSeries>): AccountSeries => ({
  accountId: 'a1', platform: 'instagram', handle: 'h', label: 'L',
  isOwn: false, samples: [], latestPost: null, ...over,
});

describe('growth', () => {
  it('computes absolute, percent and per-day exactly', () => {
    // 1000 -> 1700 over 7 days: +700, +70%, 100/day.
    // The boundary sample must be included: measuring "change over 7 days"
    // from the first sample INSIDE the window would report +600.
    const g = growth(series(1000, 100, 7));
    expect(g.current).toBe(1700);
    expect(g.absolute).toBe(700);
    expect(g.percent).toBeCloseTo(70, 5);
    expect(g.perDay).toBeCloseTo(100, 5);
  });

  it('returns null rates for a single reading, never zero', () => {
    // The failure this guards: "0% growth" rendered for an account polled once
    // reads as a real, flat result.
    const g = growth([{ at: new Date(now), followers: 5000 }]);
    expect(g.current).toBe(5000);
    expect(g.absolute).toBeNull();
    expect(g.percent).toBeNull();
    expect(g.perDay).toBeNull();
  });

  it('returns everything null with no readings at all', () => {
    const g = growth([]);
    expect(g.current).toBeNull();
    expect(g.perDay).toBeNull();
  });

  it('leaves percent null when the starting value is zero', () => {
    // Percent change from zero is undefined, not infinite.
    const g = growth([
      { at: new Date(now - 2 * DAY), followers: 0 },
      { at: new Date(now - DAY), followers: 50 },
      { at: new Date(now), followers: 100 },
    ]);
    expect(g.absolute).toBe(100);
    expect(g.percent).toBeNull();
    expect(g.perDay).toBeCloseTo(50, 5);
  });

  it('handles decline without sign errors', () => {
    const g = growth(series(10_000, -200, 5));
    expect(g.absolute).toBe(-1000);
    expect(g.perDay).toBeCloseTo(-200, 5);
    expect(g.percent).toBeCloseTo(-10, 5);
  });

  it('detects acceleration', () => {
    const flat = [
      { at: new Date(now - 4 * DAY), followers: 1000 },
      { at: new Date(now - 3 * DAY), followers: 1100 },
      { at: new Date(now - 2 * DAY), followers: 1200 },
      { at: new Date(now - DAY), followers: 1500 },
      { at: new Date(now), followers: 2000 },
    ];
    expect(growth(flat).accelerating).toBe(true);
    expect(growth(series(1000, 100, 6)).accelerating).toBe(false); // perfectly linear
  });

  it('normalizes per-day across different polling cadences', () => {
    // Same +700 over 7 days, sampled hourly vs daily, must agree.
    const daily = series(1000, 100, 7);
    const hourly: SamplePoint[] = [];
    for (let h = 7 * 24; h >= 0; h--) {
      hourly.push({ at: new Date(now - h * 3_600_000), followers: Math.round(1000 + (100 / 24) * (7 * 24 - h)) });
    }
    expect(growth(daily).perDay).toBeCloseTo(growth(hourly).perDay!, 0);
  });
});

describe('engagementRate', () => {
  it('is (likes + comments) over followers, as a percent', () => {
    expect(engagementRate({ likes: 900, commentCount: 100 }, 20_000)).toBeCloseTo(5, 5);
  });

  it('excludes views on purpose', () => {
    // Views are absent on IG image posts and non-reel FB posts, so counting
    // them would quietly favour video-heavy accounts.
    const a = engagementRate({ likes: 100, commentCount: 10 }, 1000);
    const b = engagementRate({ likes: 100, commentCount: 10, views: 999_999 } as never, 1000);
    expect(a).toBe(b);
  });

  it('returns null rather than dividing by zero followers', () => {
    expect(engagementRate({ likes: 10, commentCount: 1 }, 0)).toBeNull();
    expect(engagementRate({ likes: 10, commentCount: 1 }, null)).toBeNull();
    expect(engagementRate(null, 5000)).toBeNull();
  });
});

describe('rankPlatform', () => {
  const rows = () => rankPlatform([
    acct({ accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 500, 7) }),
    acct({ accountId: 'iqoo', label: 'iQOO', samples: series(150_000, 100, 7) }),
    acct({ accountId: 'noth', label: 'Nothing', samples: series(50_000, 50, 7) }),
  ]);

  it('ranks by followers, highest first', () => {
    const r = rows();
    expect(r.map(x => x.label)).toEqual(['iQOO', 'POVA', 'Nothing']);
    expect(r.map(x => x.rank)).toEqual([1, 2, 3]);
  });

  it('computes gaps against the account above and the leader', () => {
    const r = rows();
    const pova = r.find(x => x.label === 'POVA')!;
    const iqoo = r.find(x => x.label === 'iQOO')!;
    expect(iqoo.gapToNext).toBeNull();       // leader has nothing above it
    expect(iqoo.gapToLeader).toBe(0);
    expect(pova.gapToNext).toBe(iqoo.followers - pova.followers);
    expect(pova.gapToLeader).toBe(iqoo.followers - pova.followers);
  });

  it('share of voice sums to 100', () => {
    const total = rows().reduce((a, r) => a + r.sharePct, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it('excludes accounts with no readings rather than ranking them at zero', () => {
    // Ranking an unpolled account last at 0 followers would be a fabrication.
    const r = rankPlatform([
      acct({ accountId: 'a', label: 'Has data', samples: series(1000, 10, 4) }),
      acct({ accountId: 'b', label: 'No data', samples: [] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe('Has data');
  });
});

describe('findOpportunities', () => {
  it('projects an overtake when closing fast enough', () => {
    // POVA +500/day, iQOO +100/day, gap 50,000 -> ~125 days, so "closing"
    // rather than "soon".
    const ops = findOpportunities(rankPlatform([
      acct({ accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 500, 7) }),
      acct({ accountId: 'iqoo', label: 'iQOO', samples: series(150_000, 100, 7) }),
    ]));
    const closing = ops.find(o => o.kind === 'gap-closing' || o.kind === 'overtake-soon');
    expect(closing).toBeDefined();
    expect(closing!.rival).toBe('iQOO');
    expect(closing!.detail).toMatch(/followers a day/);
  });

  it('flags a widening gap', () => {
    const ops = findOpportunities(rankPlatform([
      acct({ accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 50, 7) }),
      acct({ accountId: 'iqoo', label: 'iQOO', samples: series(150_000, 900, 7) }),
    ]));
    expect(ops.some(o => o.kind === 'gap-widening')).toBe(true);
  });

  it('separates an engagement lead from a follower deficit', () => {
    // Smaller account, far better engagement. The point of the metric.
    const ops = findOpportunities(rankPlatform([
      acct({
        accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 100, 7),
        latestPost: { likes: 9_000, commentCount: 1_000, views: 0 },
      }),
      acct({
        accountId: 'iqoo', label: 'iQOO', samples: series(400_000, 100, 7),
        latestPost: { likes: 4_000, commentCount: 200, views: 0 },
      }),
    ]));
    const lead = ops.find(o => o.kind === 'engagement-lead');
    expect(lead).toBeDefined();
    expect(lead!.detail).toMatch(/Reach is the constraint/);
  });

  it('flags lagging engagement', () => {
    const ops = findOpportunities(rankPlatform([
      acct({
        accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 100, 7),
        latestPost: { likes: 100, commentCount: 5, views: 0 },
      }),
      acct({
        accountId: 'iqoo', label: 'iQOO', samples: series(100_000, 100, 7),
        latestPost: { likes: 8_000, commentCount: 900, views: 0 },
      }),
    ]));
    expect(ops.some(o => o.kind === 'engagement-lag')).toBe(true);
  });

  it('says nothing when there is nothing to compare against', () => {
    const ops = findOpportunities(rankPlatform([
      acct({ accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 100, 7) }),
    ]));
    expect(ops).toEqual([]);
  });

  it('orders by weight, so the most actionable reads first', () => {
    const ops = findOpportunities(rankPlatform([
      acct({
        accountId: 'pova', label: 'POVA', isOwn: true, samples: series(100_000, 10, 7),
        latestPost: { likes: 10, commentCount: 1, views: 0 },
      }),
      acct({
        accountId: 'iqoo', label: 'iQOO', samples: series(120_000, 900, 7),
        latestPost: { likes: 9_000, commentCount: 900, views: 0 },
      }),
    ]));
    expect(ops.length).toBeGreaterThan(1);
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i - 1].weight).toBeGreaterThanOrEqual(ops[i].weight);
    }
  });
});

describe('buildDailyBrief', () => {
  it('assembles facts the narrative layer can quote without recomputing', () => {
    const brief = buildDailyBrief([
      acct({ accountId: 'pi', platform: 'instagram', label: 'POVA', isOwn: true, samples: series(100_000, 100, 7) }),
      acct({ accountId: 'ii', platform: 'instagram', label: 'iQOO', samples: series(150_000, 100, 7) }),
      acct({ accountId: 'py', platform: 'youtube', label: 'POVA', isOwn: true, samples: series(50_000, 200, 7) }),
      acct({ accountId: 'iy', platform: 'youtube', label: 'iQOO', samples: series(20_000, 10, 7) }),
    ]);

    expect(brief.facts.ownFollowersTotal).toBe(100_700 + 51_400);
    expect(brief.facts.accountsTracked).toBe(4);
    // Rank 1 of 2 on YouTube beats rank 2 of 2 on Instagram.
    expect(brief.facts.bestPlatform?.platform).toBe('youtube');
    expect(brief.facts.worstPlatform?.platform).toBe('instagram');
  });

  it('never ranks the two platforms against each other', () => {
    const brief = buildDailyBrief([
      acct({ accountId: 'a', platform: 'instagram', label: 'A', samples: series(1000, 1, 4) }),
      acct({ accountId: 'b', platform: 'youtube', label: 'B', samples: series(9_000_000, 1, 4) }),
    ]);
    // 400k subscribers and 400k followers are not the same asset, so each
    // platform gets its own rank 1.
    expect(brief.rows.filter(r => r.rank === 1)).toHaveLength(2);
  });

  it('counts accounts still waiting for a first reading', () => {
    const brief = buildDailyBrief([
      acct({ accountId: 'a', label: 'A', samples: series(1000, 1, 4) }),
      acct({ accountId: 'b', label: 'B', samples: [] }),
      acct({ accountId: 'c', label: 'C', samples: [] }),
    ]);
    expect(brief.facts.accountsAwaitingData).toBe(2);
  });

  it('produces an empty but valid brief with no data at all', () => {
    const brief = buildDailyBrief([]);
    expect(brief.rows).toEqual([]);
    expect(brief.opportunities).toEqual([]);
    expect(brief.facts.ownFollowersTotal).toBeNull();
  });
});
