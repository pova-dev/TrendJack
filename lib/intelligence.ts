import 'server-only';
import { prisma } from './db';
import { ACTIONABLE } from './today';
import type { Recommendation, SourceId } from '@/types';

// Strategy intelligence, computed from what the database already holds.
//
// The board shows individual signals and the landing view ranks today's. This
// answers the questions above both: where does useful signal actually come
// from, who is taking up the space you want, and what is the funnel losing.
//
// Everything is arithmetic. No model is consulted, which is why it works with
// no API keys and why a number here cannot be invented. Where a figure would
// be misleading without context, the context is computed too rather than left
// for the reader to assume.

/** Percentages below this are reported but flagged, since a rate over a small
 *  denominator is noise dressed as a finding. */
const MIN_SAMPLE_FOR_CONFIDENCE = 50;

export interface SourceYield {
  source: SourceId;
  signals: number;
  /** Share of total intake. */
  intakeShare: number;
  avgOpportunity: number;
  brandRelevantRate: number;
  actionableRate: number;
  competitorRate: number;
  /** False when the denominator is too small to draw a conclusion from. */
  confident: boolean;
}

export interface KeywordHit { keyword: string; hits: number }
export interface RivalShare { name: string; mentions: number; share: number }

export interface Funnel {
  scanned: number;
  brandRelevant: number;
  actionable: number;
  drafted: number;
  actedOn: number;
  outcomesRecorded: number;
}

export interface Intelligence {
  sources: SourceYield[];
  keywords: { hitting: KeywordHit[]; silent: string[] };
  rivals: RivalShare[];
  funnel: Funnel;
  /** Signal arrival by local hour, so "when is our market awake" is answerable
   *  without mental timezone arithmetic. */
  arrivalByHour: { hour: number; count: number }[];
  timezone: { label: string; offsetMinutes: number };
  totalSignals: number;
}

/**
 * Offset for the brand's primary market.
 *
 * Arrival times are stored in UTC. Reporting them that way makes an Indian
 * operator do timezone arithmetic to answer "when does our audience wake up",
 * which is exactly the sort of friction that stops a chart being used.
 */
const MARKET_OFFSETS: Record<string, { label: string; offsetMinutes: number }> = {
  India: { label: 'IST', offsetMinutes: 330 },
  'United States': { label: 'ET', offsetMinutes: -300 },
  'United Kingdom': { label: 'GMT', offsetMinutes: 0 },
};

export async function buildIntelligence(brandId: string): Promise<Intelligence> {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error('brand_not_found');

  const [trends, draftCount, actionCount, outcomeCount] = await Promise.all([
    prisma.trend.findMany({
      where: { brandId },
      select: {
        source: true, scores: true, recommendation: true, brandKeywordHit: true,
        matchedBrandKeywords: true, competitorClaimed: true, competitorClaimants: true,
        firstSeenAt: true,
      },
    }),
    prisma.draft.count({ where: { brandId } }),
    prisma.trendAction.count({ where: { trend: { brandId } } }),
    prisma.trend.count({ where: { brandId, performanceMultiple: { not: null } } }),
  ]);

  const market = (parseJson<string[]>(brand.markets) ?? [])[0] ?? '';
  const tz = MARKET_OFFSETS[market] ?? { label: 'UTC', offsetMinutes: 0 };

  // One pass. Six aggregations over 6,900 rows is fast, but six passes is six
  // times the work for no clarity gained.
  const bySource = new Map<string, { n: number; opp: number; brand: number; act: number; rival: number }>();
  const keywordHits = new Map<string, number>();
  const rivalHits = new Map<string, number>();
  const hours = new Array(24).fill(0) as number[];
  let brandRelevant = 0;
  let actionable = 0;

  for (const t of trends) {
    const scores = parseJson<{ opportunity: number }>(t.scores);
    const opp = scores?.opportunity ?? 0;
    const isActionable = ACTIONABLE.has(t.recommendation as Recommendation);

    const row = bySource.get(t.source) ?? { n: 0, opp: 0, brand: 0, act: 0, rival: 0 };
    row.n++;
    row.opp += opp;
    if (t.brandKeywordHit) { row.brand++; brandRelevant++; }
    if (isActionable) { row.act++; actionable++; }
    if (t.competitorClaimed) row.rival++;
    bySource.set(t.source, row);

    for (const k of parseJson<string[]>(t.matchedBrandKeywords) ?? []) {
      keywordHits.set(k, (keywordHits.get(k) ?? 0) + 1);
    }
    for (const c of parseJson<string[]>(t.competitorClaimants) ?? []) {
      const name = c.toLowerCase();
      rivalHits.set(name, (rivalHits.get(name) ?? 0) + 1);
    }

    // Shifted into market time before bucketing, so the peak reads as a local
    // hour rather than something the reader has to convert.
    const local = new Date(t.firstSeenAt.getTime() + tz.offsetMinutes * 60_000);
    hours[local.getUTCHours()]++;
  }

  const total = trends.length;

  const sources: SourceYield[] = [...bySource.entries()]
    .map(([source, r]) => ({
      source: source as SourceId,
      signals: r.n,
      intakeShare: total ? r.n / total : 0,
      avgOpportunity: r.n ? r.opp / r.n : 0,
      brandRelevantRate: r.n ? r.brand / r.n : 0,
      actionableRate: r.n ? r.act / r.n : 0,
      competitorRate: r.n ? r.rival / r.n : 0,
      confident: r.n >= MIN_SAMPLE_FOR_CONFIDENCE,
    }))
    .sort((a, b) => b.signals - a.signals);

  const configured = parseJson<string[]>(brand.brandKeywords) ?? [];
  const hitting = [...keywordHits.entries()]
    .map(([keyword, hits]) => ({ keyword, hits }))
    .sort((a, b) => b.hits - a.hits);

  const totalRivalMentions = [...rivalHits.values()].reduce((a, b) => a + b, 0);
  const rivals: RivalShare[] = [...rivalHits.entries()]
    .map(([name, mentions]) => ({
      name,
      mentions,
      share: totalRivalMentions ? mentions / totalRivalMentions : 0,
    }))
    .sort((a, b) => b.mentions - a.mentions);

  return {
    sources,
    keywords: {
      hitting,
      // Configured and never matched. Either the wording is wrong or nobody
      // is saying it, and both are worth knowing.
      silent: configured.filter(k => !keywordHits.has(k)),
    },
    rivals,
    funnel: {
      scanned: total,
      brandRelevant,
      actionable,
      drafted: draftCount,
      actedOn: actionCount,
      outcomesRecorded: outcomeCount,
    },
    arrivalByHour: hours.map((count, hour) => ({ hour, count })),
    timezone: tz,
    totalSignals: total,
  };
}

/**
 * The single most useful thing the source table says, stated outright.
 *
 * A table of six rates leaves the reader to spot that one source converts two
 * orders of magnitude better than another. Naming it is the difference between
 * data and a finding, and this is a page whose whole job is findings.
 */
export function sourceVerdict(sources: SourceYield[]): { best: SourceYield; worst: SourceYield; ratio: number } | null {
  const usable = sources.filter(s => s.signals > 0);
  if (usable.length < 2) return null;

  // Ranked on actionable rate, which is the only column that means "produced
  // something a human should do". Volume is what the noisy sources win on.
  const ranked = [...usable].sort((a, b) => b.actionableRate - a.actionableRate);
  const best = ranked[0];

  // Worst among sources carrying real volume. A source with three signals and
  // a zero rate is not the problem, and naming it would misdirect.
  const heavy = usable.filter(s => s.intakeShare >= 0.1);
  const worst = heavy.length ? heavy.sort((a, b) => a.actionableRate - b.actionableRate)[0] : ranked[ranked.length - 1];

  if (best.source === worst.source || best.actionableRate === 0) return null;

  return {
    best,
    worst,
    // Guarded: a zero denominator would report Infinity, which renders as a
    // nonsense multiple.
    ratio: worst.actionableRate > 0 ? best.actionableRate / worst.actionableRate : Infinity,
  };
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}
