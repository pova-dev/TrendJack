import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend } from '@/lib/store';
import { findTrendMemory } from '@/lib/trend-memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/trends/[id]/memory — return historical analogs of this trend
// (brand's past trends with same content fingerprint AND a recorded
// performanceMultiple). Used by the drawer's Memory section.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const analogs = await findTrendMemory(auth.brand.id, id, trend.title);
  return NextResponse.json({ analogs });
}
