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
    const brands = await prisma.brand.findMany({ select: { id: true } });
    for (const b of brands) {
      const trends = await listTrends(b.id, { limit: 500, excludeDismissed: true });
      const reports = buildLineageLookup(trends);
      CACHE.set(b.id, { brandId: b.id, builtAt: new Date(), reports });
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
