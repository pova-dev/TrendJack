import { NextResponse } from 'next/server';
import { getTrend } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';
import { researchTrend } from '@/lib/research';
import { prisma } from '@/lib/db';
import { getOrgCredentials } from '@/lib/credentials';
import { makeLlmVerifier } from '@/src/agents/verifier';
import { aiHealth } from '@/lib/ai/provider';
import type { RawSignal } from '@/src/core/scoring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { backend?: string };
  const creds = await getOrgCredentials(auth.org.id);
  const credsWithHint = body.backend ? { ...creds, TJ_RESEARCH_BACKEND: body.backend } : creds;

  // Run legacy research (summary + sources) AND the premium-AI Verifier
  // (per-claim citations) in parallel. The Verifier only fires when
  // operator credentials are configured — falls through gracefully
  // otherwise.
  const health = aiHealth(creds);
  const aiReady = health.anthropic || health.openai || health.google || health.openrouter;

  const trendAsSignal: RawSignal = {
    source: trend.source,
    title: trend.title,
    summary: trend.summary,
    hashtags: trend.hashtags,
    text: undefined,
    lineage: trend.lineage,
    catalyst: trend.catalyst,
    firstSeenAt: new Date(trend.firstSeenAt),
    velocity: trend.velocity,
    reach: Number(trend.reach),
    sentiment: trend.sentiment,
    competitorClaimants: trend.competitorClaimants,
    formatFatigue: trend.formatFatigue ?? 0,
    examples: trend.examples,
    url: trend.url,
    externalId: trend.sourceRef,
  };

  const [research, verification] = await Promise.all([
    researchTrend(trend, credsWithHint),
    aiReady
      ? makeLlmVerifier({ credentials: creds }).verify({ signal: trendAsSignal, brandId: auth.brand.id, orgId: auth.org?.id })
      : Promise.resolve(null),
  ]);

  // Merge verifier output into the research payload so the dashboard
  // can render per-claim citations alongside the summary blob.
  const merged = {
    ...research,
    verifiedClaims: verification?.claims ?? [],
    unverifiedClaims: verification?.unverifiedClaims ?? [],
    verifierProvider: verification?.provider,
    verifierModel: verification?.model,
  };

  await prisma.trend.update({ where: { id }, data: { researchCache: JSON.stringify(merged) } });
  return NextResponse.json(merged);
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
