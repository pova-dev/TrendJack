// Data retention.
//
// Nothing removed anything, ever. TrendSample appends a row per trend per
// ingest tick, so the table grew to 2.26M rows (66 samples per trend) and the
// database from 370MB to 512MB in five days. Left alone it reaches multiple
// gigabytes, and every query, backup and restore pays for history nobody
// reads.
//
// Two safety rules shape everything here:
//
//   1. Operator investment is never deleted. A pinned trend, or one with a
//      draft or a recorded action, is something a human touched. Those stay
//      regardless of age.
//   2. Forecasting keeps working. forecastPeak needs at least 3 samples, so
//      the most recent N samples of every trend survive the age cutoff. A
//      trend that stops updating keeps its tail rather than losing its chart.
//
// Both windows are configurable, and nothing runs unless retention is
// explicitly enabled, because silently deleting a user's data on upgrade
// would be a nasty surprise.

import 'server-only';
import { prisma } from './db';

export interface RetentionPolicy {
  /** Drop samples older than this. Default 14 days. */
  sampleRetentionDays: number;
  /** Drop untouched trends older than this. Default 30 days. */
  trendRetentionDays: number;
  /** Always keep at least this many recent samples per trend. Default 5,
   *  comfortably above forecastPeak's minimum of 3. */
  minSamplesPerTrend: number;
}

export const DEFAULT_POLICY: RetentionPolicy = {
  sampleRetentionDays: 14,
  trendRetentionDays: 30,
  minSamplesPerTrend: 5,
};

export function policyFromEnv(): RetentionPolicy {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    sampleRetentionDays: num(process.env.TJ_SAMPLE_RETENTION_DAYS, DEFAULT_POLICY.sampleRetentionDays),
    trendRetentionDays: num(process.env.TJ_TREND_RETENTION_DAYS, DEFAULT_POLICY.trendRetentionDays),
    minSamplesPerTrend: num(process.env.TJ_MIN_SAMPLES_PER_TREND, DEFAULT_POLICY.minSamplesPerTrend),
  };
}

export interface RetentionResult {
  samplesDeleted: number;
  trendsDeleted: number;
  socialSamplesDeleted: number;
  dryRun: boolean;
  policy: RetentionPolicy;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * Count what a run would remove, without removing it.
 *
 * Worth having on its own: retention is irreversible, so the first thing an
 * operator should be able to do is ask how much it would take.
 */
export async function previewRetention(policy = policyFromEnv()): Promise<RetentionResult> {
  const sampleCut = daysAgo(policy.sampleRetentionDays);
  const trendCut = daysAgo(policy.trendRetentionDays);

  const [samples, trends, socialSamples] = await Promise.all([
    countExpiredSamples(sampleCut, policy.minSamplesPerTrend),
    countExpiredTrends(trendCut),
    prisma.socialSample.count({ where: { sampledAt: { lt: sampleCut } } }),
  ]);

  return { samplesDeleted: samples, trendsDeleted: trends, socialSamplesDeleted: socialSamples, dryRun: true, policy };
}

/** Rows older than the cutoff, excluding each trend's most recent N. */
async function countExpiredSamples(cutoff: Date, keepPerTrend: number): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) n FROM TrendSample
      WHERE sampledAt < ?
        AND id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY trendId ORDER BY sampledAt DESC) rn
              FROM TrendSample
          ) WHERE rn <= ?
        )`,
    cutoff, keepPerTrend,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Trends past the cutoff that no human has touched. */
async function countExpiredTrends(cutoff: Date): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) n FROM Trend t
      WHERE t.firstSeenAt < ?
        AND t.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM Draft d WHERE d.trendId = t.id)
        AND NOT EXISTS (SELECT 1 FROM TrendAction a WHERE a.trendId = t.id)`,
    cutoff,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Delete expired data.
 *
 * Trends go first: their samples cascade, which removes far more rows than the
 * sample sweep would have to touch individually.
 */
export async function runRetention(policy = policyFromEnv()): Promise<RetentionResult> {
  const sampleCut = daysAgo(policy.sampleRetentionDays);
  const trendCut = daysAgo(policy.trendRetentionDays);

  const trendsDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM Trend
      WHERE firstSeenAt < ?
        AND pinned = 0
        AND NOT EXISTS (SELECT 1 FROM Draft d WHERE d.trendId = Trend.id)
        AND NOT EXISTS (SELECT 1 FROM TrendAction a WHERE a.trendId = Trend.id)`,
    trendCut,
  );

  const samplesDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM TrendSample
      WHERE sampledAt < ?
        AND id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY trendId ORDER BY sampledAt DESC) rn
              FROM TrendSample
          ) WHERE rn <= ?
        )`,
    sampleCut, policy.minSamplesPerTrend,
  );

  // Social counters follow the same age rule, but every account keeps its
  // recent tail so the sparkline never empties.
  const socialSamplesDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM SocialSample
      WHERE sampledAt < ?
        AND id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY accountId ORDER BY sampledAt DESC) rn
              FROM SocialSample
          ) WHERE rn <= ?
        )`,
    sampleCut, policy.minSamplesPerTrend,
  );

  return { samplesDeleted, trendsDeleted, socialSamplesDeleted, dryRun: false, policy };
}

declare global {
  // eslint-disable-next-line no-var
  var __tj_retention_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __tj_retention_last: (RetentionResult & { at: string }) | undefined;
}

export function getRetentionStatus() {
  return {
    enabled: process.env.TJ_RETENTION_ENABLED === '1',
    started: !!global.__tj_retention_started,
    last: global.__tj_retention_last ?? null,
    policy: policyFromEnv(),
  };
}

/**
 * Daily sweep. Opt-in via TJ_RETENTION_ENABLED=1.
 *
 * Off by default on purpose: an upgrade that silently deleted a month of
 * someone's history would be indefensible. previewRetention() lets an operator
 * see the number first.
 */
export function startRetentionCron(): void {
  if (global.__tj_retention_started) return;
  if (process.env.TJ_RETENTION_ENABLED !== '1') return;
  global.__tj_retention_started = true;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const run = async () => {
    try {
      const res = await runRetention();
      global.__tj_retention_last = { ...res, at: new Date().toISOString() };
      // eslint-disable-next-line no-console
      console.log(`[retention] removed ${res.trendsDeleted} trends, ${res.samplesDeleted} samples, ${res.socialSamplesDeleted} social samples`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[retention] sweep failed', (e as Error).message);
    }
  };

  const t = setInterval(run, DAY_MS);
  if (t.unref) t.unref();
  setTimeout(run, 60_000);   // first sweep a minute after boot, not during it
}
