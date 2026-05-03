import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { rescoreBrandTrends, logAudit } from '@/lib/store';
import { publishBrandTrend } from '@/lib/realtime/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rescore — re-runs the scoring engine against EVERY trend in
// the active brand. Used after scoring-formula changes (which we ship
// often) to refresh recommendations / cringe / risk without re-ingesting.
//
// This is heavy (writes to every Trend row) so we don't auto-fire it; the
// /scoring page will get a "Rescore now" button that hits this.

export async function POST() {
  const ctx = await getCurrentContext();
  if (!ctx?.brand || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const t0 = Date.now();
  await rescoreBrandTrends(ctx.brand.id);

  await logAudit({
    orgId: ctx.org.id, userId: ctx.user.id,
    action: 'rescore.run', target: ctx.brand.id,
    meta: { durationMs: Date.now() - t0 },
  });
  // Tell the dashboard to refetch so the new scores show up immediately.
  publishBrandTrend(ctx.brand.id, {
    type: 'trend.updated',
    brandId: ctx.brand.id,
    trendId: '*',
    reason: 'rescore',
  });

  return NextResponse.json({ ok: true, durationMs: Date.now() - t0 });
}
