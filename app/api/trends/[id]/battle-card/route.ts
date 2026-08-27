import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend, getBrand } from '@/lib/store';
import { getOrgCredentials } from '@/lib/credentials';
import { prisma } from '@/lib/db';
import { generateBattleCard } from '@/src/agents/battlecard/generator';
import type { RawSignal, ScoreResult } from '@/src/core/scoring/types';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Battle-Card endpoint.
//
// GET  /api/trends/[id]/battle-card
//   Returns the current (non-superseded) BattleCard for the trend, or
//   404 if none has been generated yet.
//
// POST /api/trends/[id]/battle-card
//   Generates a fresh BattleCard via the premium AI tier. Supersedes
//   any existing card. Premium-tier cost; budget-gated via runChat in
//   the generator. Saturation > 0.6 short-circuits to a deterministic
//   'ignore' verdict with no LLM call. Body: {} (no params yet).

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const card = await prisma.battleCard.findFirst({
    where: { trendId: id, supersededAt: null },
    orderBy: { generatedAt: 'desc' },
  });
  if (!card) return NextResponse.json({ error: 'no_card' }, { status: 404 });
  return NextResponse.json({
    id: card.id,
    trendId: card.trendId,
    verdict: card.verdict,
    verdictReason: card.verdictReason,
    payload: JSON.parse(card.payload),
    generatedAt: card.generatedAt,
    promptVersion: card.promptVersion,
  });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('draft:create'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const brand = await getBrand(auth.brand.id);
  if (!brand) return NextResponse.json({ error: 'brand_missing' }, { status: 400 });

  const credentials = await getOrgCredentials(auth.org.id);

  // Reconstruct the RawSignal + ScoreResult from the persisted Trend.
  // Both are pure-data shapes that can be rebuilt from the row.
  const signal: RawSignal = {
    source: trend.source,
    title: trend.title,
    summary: trend.summary,
    hashtags: trend.hashtags,
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
  const scoreResult: ScoreResult = {
    scores: trend.scores,
    rationale: trend.rationale,
    recommendation: trend.recommendation,
    recommendationReason: trend.recommendationReason,
    peakWindowEnd: trend.peakWindowEnd ? new Date(trend.peakWindowEnd) : new Date(),
    jackingScore: trend.scores.jackingScore ?? 0,
    brandKeywordHit: trend.brandKeywordHit ?? false,
    matchedBrandKeywords: trend.matchedBrandKeywords ?? [],
  };

  const result = await generateBattleCard({
    signal,
    scoreResult,
    brand,
    brandId: brand.id,
    orgId: auth.org.id,
    credentials,
  });

  if (!result.ok) {
    if (result.error === 'budget_exhausted') {
      return NextResponse.json(
        { error: 'budget_exhausted', message: 'Daily AI budget for this org is exhausted.' },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Supersede any current card, then insert.
  await prisma.battleCard.updateMany({
    where: { trendId: id, supersededAt: null },
    data: { supersededAt: new Date() },
  });
  const created = await prisma.battleCard.create({
    data: {
      trendId: id,
      brandId: brand.id,
      orgId: auth.org.id,
      verdict: result.card.verdict,
      verdictReason: result.card.verdictReason,
      payload: JSON.stringify(result.card),
      cost: result.costUsd,
      promptVersion: result.promptVersion,
    },
  });

  return NextResponse.json({
    id: created.id,
    trendId: id,
    verdict: result.card.verdict,
    verdictReason: result.card.verdictReason,
    payload: result.card,
    generatedAt: created.generatedAt,
    promptVersion: result.promptVersion,
  });
}
