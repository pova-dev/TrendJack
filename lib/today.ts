import 'server-only';
import { prisma } from './db';
import { listTrends } from './store';
import type { Trend, Recommendation } from '@/types';

// What the operator needs to know on opening the app.
//
// The board surfaces 6,204 trends. Three were ever acted on. That gap is the
// product's real failure: it produces roughly two thousand times more than
// anyone consumes, so the default experience is a wall to scroll past rather
// than a decision to make.
//
// Everything here is arithmetic over data already in the database. No model is
// consulted, which matters for two reasons: it works with no API keys and no
// budget, and a count cannot hallucinate. Where a section genuinely has no
// source of truth yet, it reports that rather than inventing a plausible
// number.

/** How near a peak window must be to count as closing. Two hours is roughly
 *  the shortest useful notice for getting a post approved and out. */
const CLOSING_SOON_MS = 2 * 60 * 60_000;

/**
 * Recommendations that represent something a human should do today.
 *
 * IGNORE and MONITOR are deliberately absent. The first draft of this filtered
 * only on the peak window, which surfaced trends the engine had explicitly
 * marked IGNORE: "#BiharKiPoliceDidi" at topicalFit 0.05 appeared under
 * "window closing" purely because its window happened to be short. Putting a
 * rejected trend on the landing page is worse than showing nothing, because it
 * teaches the operator the ranking cannot be trusted.
 */
export const ACTIONABLE: ReadonlySet<Recommendation> =
  new Set<Recommendation>(['POST_NOW', 'PREP_1H', 'ESCALATE', 'SAFE_PIVOT']);

/**
 * Floor for appearing on the landing page at all.
 *
 * The engine scores opportunity 0..100. Anything under this is noise that the
 * board can still show, because browsing everything is the board's job.
 */
export const MIN_OPPORTUNITY = 40;

/**
 * The single admission rule, exported so it is testable on its own.
 *
 * Both lists route through this rather than each applying its own filter,
 * which is how the peak-window list ended up admitting IGNORE trends the
 * ranked list would have refused.
 */
export function isEligibleForToday(
  t: { recommendation: Recommendation; scores: { opportunity: number } },
): boolean {
  return ACTIONABLE.has(t.recommendation) && t.scores.opportunity >= MIN_OPPORTUNITY;
}

export interface ActionItem {
  trend: Trend;
  /** Why this made the list, in the operator's words rather than the
   *  scoring engine's. */
  reason: string;
  closesAt?: string;
}

export interface TodayBrief {
  actNow: ActionItem[];
  closingSoon: ActionItem[];
  /** Shipped work whose result was never recorded. Each one is a data point
   *  the calibration loop needed and did not get. */
  awaitingOutcome: { draftId: string; trendId: string; title: string; platform: string }[];
  counts: {
    totalSignals: number;
    postNow: number;
    draftsTotal: number;
    outcomesRecorded: number;
    actionsTaken: number;
  };
  /**
   * Why the lists are empty, when they are.
   *
   * "Nothing needs a decision" is honest but tells the operator nothing they
   * can act on. Knowing that 27 trends were actionable and the best scored 29
   * against a floor of 40 is the difference between a quiet day and a
   * misconfigured ingest, and only they can tell which.
   */
  nearMiss: {
    actionableCount: number;
    bestOpportunity: number | null;
    floor: number;
    /** Share of signals mentioning a brand keyword. A very low number means
     *  the ingest is pulling a category the brand does not sell into. */
    brandRelevantShare: number;
  };
  /** Competitor comparison needs social samples. Null means no data source is
   *  configured, which the UI must say plainly rather than render as zero. */
  competitors: {
    tracked: number;
    withData: number;
    ownAccounts: number;
    /** Configured but switched off, so collecting nothing. Distinct from
     *  "not configured", which needs a different fix. */
    paused: number;
  };
}

export async function buildTodayBrief(brandId: string): Promise<TodayBrief> {
  const [trends, drafts, outcomesRecorded, actionsTaken, accounts, sampledAccountIds] = await Promise.all([
    listTrends(brandId, { excludeDismissed: true, limit: 200 }),
    prisma.draft.findMany({
      where: { brandId, status: 'shipped' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { trend: { select: { id: true, title: true, performanceMultiple: true } } },
    }),
    prisma.trend.count({ where: { brandId, performanceMultiple: { not: null } } }),
    prisma.trendAction.count({ where: { trend: { brandId } } }),
    // Every configured account, not just active ones. All seven of POVA's are
    // currently inactive, so filtering on active reported "none tracked" when
    // the truth is "seven configured and none collecting" — a different
    // problem with a different fix.
    prisma.socialAccount.findMany({ where: { brandId }, select: { id: true, isOwn: true, active: true } }),
    prisma.socialSample.findMany({ distinct: ['accountId'], select: { accountId: true } }),
  ]);

  // Relevance is measured across the brand's whole corpus, not the list above.
  // listTrends returns a priority union that deliberately pulls brand-keyword
  // hits in regardless of the limit, so measuring the share within it would
  // report the bias rather than the intake.
  const [corpusTotal, corpusBrandHits] = await Promise.all([
    prisma.trend.count({ where: { brandId } }),
    prisma.trend.count({ where: { brandId, brandKeywordHit: true } }),
  ]);

  const now = Date.now();
  const sampled = new Set(sampledAccountIds.map(s => s.accountId));

  // Ranked by opportunity, which is the additive composite the dashboard sorts
  // on. Deliberately not jackingScore: that gates whether a draft may be
  // generated, and conflating the two is what CLAUDE.md hard-rule 4 forbids.
  const ranked = [...trends].sort((a, b) => b.scores.opportunity - a.scores.opportunity);

  const eligible = ranked.filter(isEligibleForToday);

  // Measured before the floor is applied, so the empty state can explain
  // itself rather than just reporting absence.
  const actionable = ranked.filter(t => ACTIONABLE.has(t.recommendation));

  const actNow: ActionItem[] = eligible
    .filter(t => t.recommendation === 'POST_NOW' || t.recommendation === 'PREP_1H' || t.recommendation === 'ESCALATE')
    .slice(0, 5)
    .map(t => ({
      trend: t,
      reason: describeWhy(t),
      closesAt: t.peakWindowEnd,
    }));

  const actNowIds = new Set(actNow.map(a => a.trend.id));

  // A window about to shut is worth surfacing even at lower opportunity,
  // because the cost of missing it is total rather than proportional.
  const closingSoon: ActionItem[] = eligible
    .filter(t => {
      if (actNowIds.has(t.id)) return false;          // never list a trend twice
      if (!t.peakWindowEnd) return false;
      const left = new Date(t.peakWindowEnd).getTime() - now;
      return left > 0 && left <= CLOSING_SOON_MS;
    })
    .slice(0, 5)
    .map(t => ({ trend: t, reason: describeWhy(t), closesAt: t.peakWindowEnd }));

  const awaitingOutcome = drafts
    .filter(d => d.trend && d.trend.performanceMultiple == null)
    .slice(0, 5)
    .map(d => ({
      draftId: d.id,
      trendId: d.trendId,
      title: d.trend!.title,
      platform: d.platform,
    }));

  return {
    actNow,
    closingSoon,
    awaitingOutcome,
    counts: {
      totalSignals: trends.length,
      postNow: trends.filter(t => t.recommendation === 'POST_NOW').length,
      draftsTotal: await prisma.draft.count({ where: { brandId } }),
      outcomesRecorded,
      actionsTaken,
    },
    nearMiss: {
      actionableCount: actionable.length,
      bestOpportunity: actionable.length ? Math.round(actionable[0].scores.opportunity) : null,
      floor: MIN_OPPORTUNITY,
      brandRelevantShare: corpusTotal ? corpusBrandHits / corpusTotal : 0,
    },
    competitors: {
      tracked: accounts.filter(a => !a.isOwn).length,
      withData: accounts.filter(a => sampled.has(a.id)).length,
      ownAccounts: accounts.filter(a => a.isOwn).length,
      paused: accounts.filter(a => !a.active).length,
    },
  };
}

/**
 * Plain-language justification.
 *
 * The scoring engine speaks in axes (topicalFit, firstMover, saturation). A
 * marketing lead does not, and a row labelled "opportunity 78 / CVS 0.42" is
 * why people open a dashboard once and never again. This says the single
 * strongest true thing about the trend instead.
 */
function describeWhy(t: Trend): string {
  if (t.brandKeywordHit && t.matchedBrandKeywords?.length) {
    return `Mentions ${t.matchedBrandKeywords.slice(0, 2).join(' and ')}`;
  }
  if (t.competitorClaimed && t.competitorClaimants.length) {
    return `${t.competitorClaimants[0]} is already on this`;
  }
  if (t.scores.firstMover >= 0.7) return 'Nobody in your category has posted yet';
  if (t.cascadePhase === 'peaking') return 'Peaking right now';
  if (t.velocity > 0 && t.velocityDelta && t.velocityDelta > 20) {
    return `Accelerating, up ${Math.round(t.velocityDelta)}% since last check`;
  }
  if (t.scores.topicalFit >= 0.7) return 'Close fit with what your brand talks about';
  return t.recommendationReason || 'Ranked highest on current signals';
}
