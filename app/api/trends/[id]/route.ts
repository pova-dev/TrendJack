import { NextRequest, NextResponse } from 'next/server';
import { getTrend } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(trend);
}
