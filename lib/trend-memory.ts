// Trend Memory — historical-analog lookup.
//
// When a new trend lands, fetch the brand's past trends with a similar
// content fingerprint AND a recorded performanceMultiple. Surfaces in
// the drawer Overview as: "A similar trend 6 weeks ago performed 0.4×
// — operator was too late." Closes the time-of-action loop the
// system has data for but never displayed.
//
// Lookup strategy:
//   1. Compute fingerprint of the current trend's title
//   2. Find the brand's other Trends with same fingerprint, NOT same id
//   3. Filter to trends with performanceMultiple set (= they were shipped
//      and outcome was reported via /api/trends/[id]/outcome)
//   4. Sort by createdAt DESC, return the latest 3
//   5. Compute action-timing delta: when did the operator act vs the
//      trend's peakWindowEnd? "shipped 4h after peak" = bad timing.
//
// Returns null when no analogs found (cold start / new fingerprint).
// Pure read; no writes.

import 'server-only';
import { prisma } from './db';
import { contentFingerprint } from '@/src/agents/scout/dedup';

export interface MemoryAnalog {
  trendId: string;
  title: string;
  source: string;
  performanceMultiple: number;
  /** ms epoch — when trend was created in our DB */
  firstSeenAt: number;
  /** ms epoch — when its peak window ended */
  peakWindowEnd: number | null;
  /** ms epoch — when the operator first acted on it (earliest TrendAction). */
  firstActionAt: number | null;
  /** Hours from peak to first action. Negative = ahead of peak (good). */
  hoursVsPeak: number | null;
  /** Days ago the analog landed in our DB. */
  daysAgo: number;
}

export async function findTrendMemory(
  brandId: string,
  trendId: string,
  trendTitle: string,
  windowDays = 180,
): Promise<MemoryAnalog[]> {
  const fp = contentFingerprint({ title: trendTitle });
  if (!fp) return [];

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // Read all the brand's recent shipped/measured trends; filter by
  // fingerprint client-side because Prisma doesn't have the helper.
  const candidates = await prisma.trend.findMany({
    where: {
      brandId,
      id: { not: trendId },
      performanceMultiple: { not: null },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const analogs: MemoryAnalog[] = [];
  for (const t of candidates) {
    if (contentFingerprint({ title: t.title }) !== fp) continue;
    // First action on this trend = earliest TrendAction with type ∈ {save, generate, approve, pin}
    const firstAction = await prisma.trendAction.findFirst({
      where: { trendId: t.id, type: { in: ['save', 'generate', 'approve', 'pin'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const firstActionAt = firstAction?.createdAt.getTime() ?? null;
    const peakEnd = t.peakWindowEnd?.getTime() ?? null;
    const hoursVsPeak = (firstActionAt && peakEnd)
      ? (firstActionAt - peakEnd) / 3_600_000
      : null;
    analogs.push({
      trendId: t.id,
      title: t.title,
      source: t.source,
      performanceMultiple: t.performanceMultiple ?? 0,
      firstSeenAt: t.firstSeenAt.getTime(),
      peakWindowEnd: peakEnd,
      firstActionAt,
      hoursVsPeak,
      daysAgo: Math.round((Date.now() - t.createdAt.getTime()) / 86_400_000),
    });
    if (analogs.length >= 3) break;
  }
  return analogs;
}
