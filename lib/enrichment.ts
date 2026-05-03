// Enrichment computes the Phase-4 cascade inputs the scoring engine
// accepts (reproductionRate, crossSourceCount, hoursSinceCompetitorClaim,
// competitorShareOfVoice). These travel through ScoringContext and feed
// the CVS formula's VEL_eff, Sp, SAT_eff terms.
//
// Pure-DB-driven: no LLM calls, no external API. Cheap to run per-tick.
// The Filter Agent calls enrichSignal() before invoking score().

import 'server-only';
import { prisma } from './db';
import { analyzeCascade } from '@/src/core/scoring/cascade';
import { contentFingerprint } from '@/src/agents/scout/dedup';
import { getCachedLineage } from './lineage-cron';
import type { RawSignal } from '@/src/core/scoring/types';

export interface SignalEnrichment {
  reproductionRate?: number;
  crossSourceCount?: number;
  hoursSinceCompetitorClaim?: number;
  competitorShareOfVoice?: number;
  brandPostCountForTrend?: number;
}

/**
 * Build enrichment inputs for a single signal. Looks up:
 *   - the trend's prior TrendSample history → reproductionRate via cascade
 *   - cross-source siblings via contentFingerprint → crossSourceCount + SoV
 *
 * Returns an empty object when there isn't enough history yet (cold start).
 */
export async function enrichSignal(
  signal: RawSignal,
  brandId: string,
): Promise<SignalEnrichment> {
  const out: SignalEnrichment = {};

  const externalKey = signal.externalId ?? `${signal.source}:${signal.url}`;

  // 1. Reproduction rate (R₀) from TrendSample time-series.
  //    Look up the trend by externalKey; if found, pull last 5 samples.
  const trend = await prisma.trend.findFirst({
    where: { brandId, sourceRef: externalKey },
    select: { id: true },
  });
  if (trend) {
    const samples = await prisma.trendSample.findMany({
      where: { trendId: trend.id },
      orderBy: { sampledAt: 'desc' },
      take: 5,
      select: { sampledAt: true, velocity: true, reach: true },
    });
    if (samples.length >= 2) {
      const cascade = analyzeCascade(samples.map(s => ({
        sampledAt: s.sampledAt,
        velocity: s.velocity,
        reach: Number(s.reach),
      })));
      if (cascade.R != null) out.reproductionRate = cascade.R;
    }
  }

  // 2. Cross-source spillover + competitor SoV.
  //    Fast path: the LineageCron pre-computes a per-brand map every
  //    60s. We try that first to avoid the per-trend fingerprint scan.
  const cached = trend ? getCachedLineage(brandId, trend.id) : undefined;
  if (cached) {
    if (cached.siblings.length + 1 > 1) {
      out.crossSourceCount = new Set([
        cached.patientZero.source,
        ...cached.siblings.map(s => s.source),
      ]).size;
    }
    if (cached.competitorShareOfVoice > 0) {
      out.competitorShareOfVoice = cached.competitorShareOfVoice;
    }
  } else {
    // Fallback path — cache miss (cold start, brand-new trend not yet
    // in the lineage build). Per-trend fingerprint scan over the last
    // 24h. Same logic as before, just gated.
    const fp = contentFingerprint({ title: signal.title });
    if (fp) {
      const since = new Date(Date.now() - 24 * 3_600_000);
      const siblings = await prisma.trend.findMany({
        where: { brandId, firstSeenAt: { gte: since } },
        select: { source: true, title: true, competitorClaimants: true },
        take: 200,
      });
      const matchingSources = new Set<string>();
      let totalMatching = 0;
      let claimedMatching = 0;
      for (const t of siblings) {
        if (contentFingerprint({ title: t.title }) !== fp) continue;
        matchingSources.add(t.source);
        totalMatching++;
        try {
          const claimants = JSON.parse(t.competitorClaimants) as string[];
          if (claimants.length > 0) claimedMatching++;
        } catch { /* malformed JSON */ }
      }
      if (matchingSources.size > 0) out.crossSourceCount = matchingSources.size;
      if (totalMatching > 0) out.competitorShareOfVoice = claimedMatching / totalMatching;
    }
  }

  return out;
}
