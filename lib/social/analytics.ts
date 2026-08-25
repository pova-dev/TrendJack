// Social intelligence: the deterministic layer.
//
// Everything in this file is arithmetic over stored samples. No model is
// involved, on purpose. Growth rate, engagement rate, share of voice and the
// gap to a rival are all exactly computable, so computing them is both free
// and correct. Asking a language model to estimate them would be slower,
// costlier and only approximately right, and there is no version of "accurate
// insight" that starts by guessing a number you already have.
//
// Models are used one layer up, for the two things they are actually better at
// than arithmetic: writing the daily narrative, and describing what the
// high-performing posts have stylistically in common.
//
// The rule that runs through all of it: insufficient data returns null, never
// zero. A brand with one reading has no growth rate. Reporting 0% growth would
// be a claim, and a false one.

import type { SocialPlatform } from './types';

export interface SamplePoint {
  at: Date;
  followers: number;
  postCount?: number | null;
}

export interface AccountSeries {
  accountId: string;
  platform: SocialPlatform;
  handle: string;
  label: string;            // competitor name, or the brand's own name
  isOwn: boolean;
  samples: SamplePoint[];   // oldest first
  latestPost?: {
    likes: number;
    views: number;
    commentCount: number;
    postedAt?: Date | null;
  } | null;
}

/** Minimum readings before a rate means anything. Two points is a line
 *  through noise; three is the first number worth showing. */
const MIN_POINTS_FOR_RATE = 3;

export interface GrowthMetrics {
  /** Followers now. Null when never polled. */
  current: number | null;
  /** Absolute change across the window. Null when too few readings. */
  absolute: number | null;
  /** Percent change across the window. Null when too few readings, or when
   *  the starting value was 0 (percent change from zero is undefined, not
   *  infinite). */
  percent: number | null;
  /** Followers gained per day, normalized across the actual window length so
   *  accounts polled at different cadences stay comparable. */
  perDay: number | null;
  /** Hours actually covered by the readings used. */
  windowHours: number | null;
  /** True when the more recent half grew faster than the older half. Null
   *  when there are too few points to split. */
  accelerating: boolean | null;
}

export function growth(samples: SamplePoint[], windowDays = 7): GrowthMetrics {
  const empty: GrowthMetrics = {
    current: null, absolute: null, percent: null,
    perDay: null, windowHours: null, accelerating: null,
  };
  if (!samples.length) return empty;

  const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const current = sorted[sorted.length - 1].followers;
  if (sorted.length < MIN_POINTS_FOR_RATE) return { ...empty, current };

  // "Change over the last N days" means measured FROM N days ago, so the
  // baseline is the newest sample at or before the cutoff, not the oldest one
  // after it. Filtering to `>= cutoff` instead would drop the straddling
  // sample and report six days of change as seven, and would do it
  // intermittently, since whether a sample lands inside the boundary depends
  // on microseconds.
  const cutoff = Date.now() - windowDays * 86_400_000;
  const firstInside = sorted.findIndex(s => s.at.getTime() >= cutoff);
  const startIdx = firstInside <= 0 ? 0 : firstInside - 1;
  const windowed = sorted.slice(startIdx);
  // Fall back to the whole series when the window is emptier than the
  // minimum. Better to report a longer-range rate than none.
  const use = windowed.length >= MIN_POINTS_FOR_RATE ? windowed : sorted;

  const first = use[0];
  const last = use[use.length - 1];
  const ms = last.at.getTime() - first.at.getTime();
  if (ms <= 0) return { ...empty, current };

  const absolute = last.followers - first.followers;
  const windowHours = ms / 3_600_000;
  const perDay = absolute / (ms / 86_400_000);
  const percent = first.followers > 0 ? (absolute / first.followers) * 100 : null;

  // Split the window and compare halves for direction of travel.
  let accelerating: boolean | null = null;
  if (use.length >= 4) {
    const mid = Math.floor(use.length / 2);
    const older = use.slice(0, mid + 1);
    const newer = use.slice(mid);
    const rate = (arr: SamplePoint[]) => {
      const d = arr[arr.length - 1].at.getTime() - arr[0].at.getTime();
      return d > 0 ? (arr[arr.length - 1].followers - arr[0].followers) / d : null;
    };
    const a = rate(older), b = rate(newer);
    if (a !== null && b !== null) accelerating = b > a;
  }

  return { current, absolute, percent, perDay, windowHours, accelerating };
}

/**
 * Engagement rate on the latest post, as a percent of followers.
 *
 * Views are deliberately excluded. They are absent on Instagram image posts
 * and on non-reel Facebook posts, so including them would make accounts
 * incomparable in a way that silently favours video-heavy channels.
 */
export function engagementRate(
  post: { likes: number; commentCount: number } | null | undefined,
  followers: number | null,
): number | null {
  if (!post || !followers || followers <= 0) return null;
  return ((post.likes + post.commentCount) / followers) * 100;
}

export interface RankRow {
  accountId: string;
  label: string;
  handle: string;
  platform: SocialPlatform;
  isOwn: boolean;
  followers: number;
  /** 1-based, highest followers first. */
  rank: number;
  /** Percent of the total followers across everything tracked on this
   *  platform. A crude share-of-voice proxy, and honest about being one. */
  sharePct: number;
  /** Followers between this account and the one directly above it. Null for
   *  the leader. */
  gapToNext: number | null;
  /** Followers between this account and the leader. 0 for the leader. */
  gapToLeader: number;
  growth: GrowthMetrics;
  engagementRatePct: number | null;
}

/**
 * Rank every account on one platform together.
 *
 * Cross-platform ranking is deliberately not offered: 400k YouTube subscribers
 * and 400k Instagram followers are not the same asset, and a combined table
 * would invite exactly that comparison.
 */
export function rankPlatform(series: AccountSeries[], windowDays = 7): RankRow[] {
  const withData = series
    .map(s => ({ s, g: growth(s.samples, windowDays) }))
    .filter(x => x.g.current !== null) as { s: AccountSeries; g: GrowthMetrics & { current: number } }[];

  if (!withData.length) return [];

  const total = withData.reduce((a, x) => a + x.g.current, 0);
  const sorted = [...withData].sort((a, b) => b.g.current - a.g.current);
  const leader = sorted[0].g.current;

  return sorted.map((x, i) => ({
    accountId: x.s.accountId,
    label: x.s.label,
    handle: x.s.handle,
    platform: x.s.platform,
    isOwn: x.s.isOwn,
    followers: x.g.current,
    rank: i + 1,
    sharePct: total > 0 ? (x.g.current / total) * 100 : 0,
    gapToNext: i === 0 ? null : sorted[i - 1].g.current - x.g.current,
    gapToLeader: leader - x.g.current,
    growth: x.g,
    engagementRatePct: engagementRate(x.s.latestPost, x.g.current),
  }));
}

export type OpportunityKind =
  | 'gap-closing' | 'gap-widening' | 'engagement-lead' | 'engagement-lag'
  | 'growth-lead' | 'growth-lag' | 'overtake-soon' | 'cadence-lag';

export interface Opportunity {
  kind: OpportunityKind;
  /** Higher is more worth acting on. Used only for ordering. */
  weight: number;
  /** Written for an operator, with the number that justifies it. */
  headline: string;
  detail: string;
  platform: SocialPlatform;
  /** Competitor this concerns, when it concerns one. */
  rival?: string;
}

/**
 * Derive opportunities from the ranked table.
 *
 * Rules, not inference. Every statement here is backed by a number that is
 * shown alongside it, which is what makes the panel checkable rather than
 * something you have to take on faith.
 */
export function findOpportunities(rows: RankRow[]): Opportunity[] {
  const own = rows.filter(r => r.isOwn);
  const out: Opportunity[] = [];

  for (const me of own) {
    const platform = me.platform;
    const rivals = rows.filter(r => !r.isOwn && r.platform === platform);
    if (!rivals.length) continue;

    // Closing on, or being caught by, the account directly above.
    const above = rows.find(r => r.platform === platform && r.rank === me.rank - 1);
    if (above && me.growth.perDay !== null && above.growth.perDay !== null) {
      const closing = me.growth.perDay - above.growth.perDay;
      const gap = me.gapToNext ?? 0;
      if (closing > 0 && gap > 0) {
        const days = Math.ceil(gap / closing);
        out.push({
          kind: days <= 90 ? 'overtake-soon' : 'gap-closing',
          weight: days <= 90 ? 95 : 70,
          platform,
          rival: above.label,
          headline: days <= 90
            ? `On pace to pass ${above.label} in about ${days} days`
            : `Closing on ${above.label}`,
          detail: `You are gaining ${Math.round(me.growth.perDay).toLocaleString('en-US')} followers a day against their ${Math.round(above.growth.perDay).toLocaleString('en-US')}, across a gap of ${gap.toLocaleString('en-US')}.`,
        });
      } else if (closing < 0) {
        out.push({
          kind: 'gap-widening', weight: 80, platform, rival: above.label,
          headline: `${above.label} is pulling away`,
          detail: `They are gaining ${Math.round(above.growth.perDay).toLocaleString('en-US')} a day to your ${Math.round(me.growth.perDay).toLocaleString('en-US')}, widening a ${gap.toLocaleString('en-US')} follower gap.`,
        });
      }
    }

    // Engagement rate against the field. This is the metric where a small
    // account can legitimately beat a large one, so it is worth its own call.
    const rivalEng = rivals.map(r => r.engagementRatePct).filter((v): v is number => v !== null);
    if (me.engagementRatePct !== null && rivalEng.length) {
      const avg = rivalEng.reduce((a, b) => a + b, 0) / rivalEng.length;
      const ratio = avg > 0 ? me.engagementRatePct / avg : null;
      if (ratio !== null && ratio >= 1.25) {
        out.push({
          kind: 'engagement-lead', weight: 85, platform,
          headline: `Your ${platform} audience engages ${ratio.toFixed(1)}x harder than theirs`,
          detail: `${me.engagementRatePct.toFixed(2)}% on your latest post against a ${avg.toFixed(2)}% field average. Reach is the constraint, not content.`,
        });
      } else if (ratio !== null && ratio <= 0.75) {
        out.push({
          kind: 'engagement-lag', weight: 90, platform,
          headline: `Engagement on ${platform} is running below the field`,
          detail: `${me.engagementRatePct.toFixed(2)}% against a ${avg.toFixed(2)}% average. Followers are not the problem; what you post to them is.`,
        });
      }
    }

    // Growth rate against the field.
    const rivalGrowth = rivals.map(r => r.growth.perDay).filter((v): v is number => v !== null);
    if (me.growth.perDay !== null && rivalGrowth.length) {
      const avg = rivalGrowth.reduce((a, b) => a + b, 0) / rivalGrowth.length;
      if (avg > 0 && me.growth.perDay > avg * 1.25) {
        out.push({
          kind: 'growth-lead', weight: 75, platform,
          // Named per platform: an operator scanning the feed sees these side
          // by side, and two identical headlines read as a duplicate rather
          // than as two findings.
          headline: `Growing faster than the field on ${platform}`,
          detail: `${Math.round(me.growth.perDay).toLocaleString('en-US')} followers a day against a field average of ${Math.round(avg).toLocaleString('en-US')}.`,
        });
      } else if (me.growth.perDay < avg * 0.75) {
        out.push({
          kind: 'growth-lag', weight: 88, platform,
          headline: `Growing slower than the field on ${platform}`,
          detail: `${Math.round(me.growth.perDay).toLocaleString('en-US')} a day against a field average of ${Math.round(avg).toLocaleString('en-US')}.`,
        });
      }
    }
  }

  return out.sort((a, b) => b.weight - a.weight);
}

export interface DailyBrief {
  generatedAt: string;
  platforms: SocialPlatform[];
  rows: RankRow[];
  opportunities: Opportunity[];
  /** Straight facts for the summary, so the narrative layer never has to
   *  compute anything and therefore can never get the arithmetic wrong. */
  facts: {
    ownFollowersTotal: number | null;
    ownFollowersDelta: number | null;
    bestPlatform: { platform: SocialPlatform; rank: number; of: number } | null;
    worstPlatform: { platform: SocialPlatform; rank: number; of: number } | null;
    accountsTracked: number;
    accountsAwaitingData: number;
  };
}

/** Assemble the brief. Deterministic end to end; the narrative is added by a
 *  separate layer that receives `facts` and is told not to do arithmetic. */
export function buildDailyBrief(series: AccountSeries[], windowDays = 7): DailyBrief {
  const platforms = [...new Set(series.map(s => s.platform))];
  const rows: RankRow[] = [];
  for (const p of platforms) {
    rows.push(...rankPlatform(series.filter(s => s.platform === p), windowDays));
  }

  const own = rows.filter(r => r.isOwn);
  const ranked = own.map(r => ({
    platform: r.platform, rank: r.rank,
    of: rows.filter(x => x.platform === r.platform).length,
  }));
  // Best and worst by relative position, so a 2-of-3 does not beat a 3-of-8.
  const byPosition = [...ranked].sort((a, b) => (a.rank / a.of) - (b.rank / b.of));

  const deltas = own.map(r => r.growth.absolute).filter((v): v is number => v !== null);

  return {
    generatedAt: new Date().toISOString(),
    platforms,
    rows,
    opportunities: findOpportunities(rows),
    facts: {
      ownFollowersTotal: own.length ? own.reduce((a, r) => a + r.followers, 0) : null,
      ownFollowersDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) : null,
      bestPlatform: byPosition[0] ?? null,
      worstPlatform: byPosition.length > 1 ? byPosition[byPosition.length - 1] : null,
      accountsTracked: series.length,
      accountsAwaitingData: series.filter(s => !s.samples.length).length,
    },
  };
}
