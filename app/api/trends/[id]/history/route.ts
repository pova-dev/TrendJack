import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/auth';

// Time-series of velocity / reach / sentiment / opportunity samples for one
// trend. Use the `range` query param to scope: 24h, 7d, 30d (default 7d).

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  // Make sure the trend belongs to the user's brand.
  const trend = await prisma.trend.findUnique({ where: { id }, select: { brandId: true } });
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const range = req.nextUrl.searchParams.get('range') ?? '7d';
  const since = new Date(Date.now() - (
    range === '24h' ? 24 * 60 * 60 * 1000 :
    range === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                      7  * 24 * 60 * 60 * 1000
  ));

  const samples = await prisma.trendSample.findMany({
    where: { trendId: id, sampledAt: { gte: since } },
    orderBy: { sampledAt: 'asc' },
    take: 500,
  });

  return NextResponse.json({
    range,
    samples: samples.map(s => ({
      t: s.sampledAt.toISOString(),
      velocity: s.velocity,
      reach: Number(s.reach),
      sentiment: s.sentiment,
      opportunity: s.opportunity,
    })),
  });
}
