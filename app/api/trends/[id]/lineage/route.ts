import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend } from '@/lib/store';
import { probeLineage } from '@/lib/lineage';
import { getOrgCredentials } from '@/lib/credentials';
import { prisma } from '@/lib/db';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trends/[id]/lineage — run a deep lineage probe and cache.
// GET — read the cached probe, if any.

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('draft:create'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const credentials = await getOrgCredentials(auth.org.id);
  const probe = await probeLineage(trend, credentials);
  if (!probe) {
    return NextResponse.json({ ok: false, error: 'no_ai_or_no_evidence' }, { status: 502 });
  }
  await prisma.trend.update({ where: { id }, data: { lineageCache: JSON.stringify(probe) } });
  return NextResponse.json(probe);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const row = await prisma.trend.findUnique({ where: { id }, select: { brandId: true, lineageCache: true } });
  if (!row || row.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!row.lineageCache) return NextResponse.json({ cached: false });
  try { return NextResponse.json({ cached: true, ...JSON.parse(row.lineageCache) }); }
  catch { return NextResponse.json({ cached: false }); }
}
