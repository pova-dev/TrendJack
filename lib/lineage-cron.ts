// Lineage Agent — scheduled run.
//
// Once per ingest cycle (default 90s, same as the ingest cron) we
// rebuild the cross-source lineage map for each brand:
//   - Group trends by contentFingerprint
//   - Identify Patient Zero (earliest sibling)
//   - Compute competitor share-of-voice within each cluster
//   - Flag clusters as Dilutive when SoV ≥ 0.40
//
// The output is cached in-memory (per-brand) and queried by the Filter
// Agent's enrichSignal hook (lib/enrichment.ts) — that hook currently
// computes per-trend lineage on the fly with a fingerprint scan,
// which is correct but expensive at scale. With this cron caching the
// LineageReport map, enrichSignal becomes a Map.get() instead of a
// 200-row scan per signal.

import 'server-only';
import { prisma } from './db';
import { buildLineageLookup, type LineageReport } from '@/src/agents/lineage';
import { listTrends } from './store';
import { getBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';

interface BrandLineage {
  brandId: string;
  builtAt: Date;
  reports: Map<string, LineageReport>;
}

const CACHE = new Map<string, BrandLineage>();
const TICK_MS = 60_000; // 60s — slightly less than the 90s ingest tick so a
                        // fresh lineage map is always available before the
                        // next score+persist round.
let started = false;

export function startLineageCron(): void {
  if (started) return;
  started = true;
  // Run immediately so the first ingest after boot has lineage data.
  void runOnce();
  const t = setInterval(runOnce, TICK_MS);
  if (t.unref) t.unref();
  // eslint-disable-next-line no-console
  console.log('[lineage-cron] started — first build now, then every 60s');
}

async function runOnce(): Promise<void> {
  try {
    const bus = getBus();
    const brands = await prisma.brand.findMany({ select: { id: true } });
    for (const b of brands) {
      const trends = await listTrends(b.id, { limit: 500, excludeDismissed: true });
      const reports = buildLineageLookup(trends);
      const prev = CACHE.get(b.id)?.reports;
      CACHE.set(b.id, { brandId: b.id, builtAt: new Date(), reports });

      // Battle-Card trigger emission. For each report whose isDilutive
      // flag flipped from false → true (or that's newly seen as dilutive),
      // publish to STREAMS.lineage so the BattleCard agent can react.
      // Skipping previously-emitted dilutive reports keeps fan-out
      // bounded — the agent's own 6h debounce is the second guard.
      for (const [trendId, report] of reports.entries()) {
        if (!report.isDilutive && report.competitorClaimants.length === 0) continue;
        const wasDilutive = prev?.get(trendId)?.isDilutive ?? false;
        const wasCompetitorClaimed = (prev?.get(trendId)?.competitorClaimants.length ?? 0) > 0;
        const justBecame = (report.isDilutive && !wasDilutive)
                        || (report.competitorClaimants.length > 0 && !wasCompetitorClaimed);
        if (!justBecame && prev) continue;  // already emitted on a previous tick
        await bus.publish(STREAMS.lineage, {
          trendId,
          brandId: b.id,
          patientZero: {
            source: report.patientZero.source,
            url: report.patientZero.url,
            publishedAt: report.patientZero.publishedAt,
            excerpt: report.patientZero.excerpt ?? '',
          },
          siblings: report.siblings.map(s => ({
            source: s.source, url: s.url, firstSeenAt: s.firstSeenAt,
          })),
          competitorShareOfVoice: report.competitorShareOfVoice,
          competitorClaimants: report.competitorClaimants,
          isDilutive: report.isDilutive,
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lineage-cron] tick failed:', (err as Error).message);
  }
}

/** Get the cached LineageReport for a trend, if available. Used by
 *  enrichSignal to short-circuit the per-trend fingerprint scan. */
export function getCachedLineage(brandId: string, trendId: string): LineageReport | undefined {
  return CACHE.get(brandId)?.reports.get(trendId);
}

export function getLineageCacheState(): Array<{
  brandId: string;
  builtAt: Date;
  reportCount: number;
  dilutive: number;
}> {
  return Array.from(CACHE.values()).map(b => ({
    brandId: b.brandId,
    builtAt: b.builtAt,
    reportCount: b.reports.size,
    dilutive: Array.from(b.reports.values()).filter(r => r.isDilutive).length,
  }));
}
