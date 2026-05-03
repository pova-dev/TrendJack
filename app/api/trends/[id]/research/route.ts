import { NextResponse } from 'next/server';
import { getTrend } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';
import { researchTrend } from '@/lib/research';
import { prisma } from '@/lib/db';
import { getOrgCredentials } from '@/lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Optional preferred backend: 'auto' (default — free first, paid last),
  // 'sonar' (force Perplexity Sonar via OpenRouter), 'tavily', 'brave',
  // 'searx', 'duckduckgo'.
  const body = await req.json().catch(() => ({})) as { backend?: string };
  const creds = await getOrgCredentials(auth.org.id);
  // The backend hint is passed as a synthetic credential the adapter reads.
  const credsWithHint = body.backend ? { ...creds, TJ_RESEARCH_BACKEND: body.backend } : creds;
  const result = await researchTrend(trend, credsWithHint);
  await prisma.trend.update({ where: { id }, data: { researchCache: JSON.stringify(result) } });
  return NextResponse.json(result);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const row = await prisma.trend.findUnique({ where: { id }, select: { brandId: true, researchCache: true } });
  if (!row || row.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!row.researchCache) return NextResponse.json({ cached: false });
  try { return NextResponse.json({ cached: true, ...JSON.parse(row.researchCache) }); }
  catch { return NextResponse.json({ cached: false }); }
}
