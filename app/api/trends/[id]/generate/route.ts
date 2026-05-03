import { NextRequest, NextResponse } from 'next/server';
import { addDrafts, getBrand, getTrend, logAudit } from '@/lib/store';
import { generateDraftsMock } from '@/lib/ai/anthropic';
import { generateDraftsLive } from '@/lib/ai/draft-gen';
import { getCurrentContext } from '@/lib/auth';
import { publishBrandTrend } from '@/lib/realtime/bus';
import { getOrgCredentials } from '@/lib/credentials';
import { aiHealth } from '@/lib/ai/provider';
import { prisma } from '@/lib/db';
import type { ResearchResult } from '@/lib/research';

export const runtime = 'nodejs';

// POST /api/trends/[id]/generate
//
// Body (all optional):
//   { replace?: boolean }   // when true, deletes the trend's existing
//                           // drafts before persisting new ones (regenerate)
//
// Returns:
//   {
//     drafts: Draft[],                     // [] when skip is non-null
//     mode: 'live' | 'mock',
//     provider?, model?, tier?,            // populated when mode='live'
//     hadResearch: boolean,
//     aiError?: string,                    // populated when AI ran but failed
//     skip?: { reason, suggestion },       // when AI declined to draft
//     variantsChosen?: string[],
//     variantsSkipped?: { variant, reason }[],
//   }

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as {
    replace?: boolean;
    /** Operator-selected Hook id from the Hook Library. When set, all
     *  drafts hit this angle. */
    hookId?: string;
    /** Operator-selected Template id (channel + structure). */
    templateId?: string;
  };

  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const brand = await getBrand(auth.brand.id);
  if (!brand) return NextResponse.json({ error: 'brand_missing' }, { status: 400 });

  const credentials = await getOrgCredentials(auth.org.id);
  const health = aiHealth(credentials);
  const aiReady = health.anthropic || health.openrouter || health.openai || health.google;

  // Pull cached research — drafts get richer when the AI can cite verified facts.
  let research: ResearchResult | null = null;
  const trendRow = await prisma.trend.findUnique({ where: { id }, select: { researchCache: true } });
  if (trendRow?.researchCache) {
    try { research = JSON.parse(trendRow.researchCache) as ResearchResult; } catch { /* ignore */ }
  }

  let mode: 'live' | 'mock' = 'live';
  let provider: string | undefined;
  let model: string | undefined;
  let tier: 'cheap' | 'balanced' | 'premium' | undefined;
  let aiError: string | undefined;
  let skip: { reason: string; suggestion: string } | undefined;
  let variantsChosen: string[] | undefined;
  let variantsSkipped: { variant: string; reason: string }[] | undefined;
  let drafts: Awaited<ReturnType<typeof generateDraftsMock>> = [];

  if (aiReady) {
    const live = await generateDraftsLive({
      trend, brand, research, credentials,
      seed: body.replace ? `regen-${Date.now().toString(36)}` : undefined,
      hookId: body.hookId,
      templateId: body.templateId,
      orgId: auth.org?.id,
    });
    if (live.ok) {
      drafts = live.drafts;
      provider = live.provider;
      model = live.model;
      tier = live.tier;
      skip = live.skip;
      variantsChosen = live.variantsChosen;
      variantsSkipped = live.variantsSkipped;
    } else {
      aiError = live.error;
      provider = live.provider;
    }
  }

  // Mock fallback ONLY when AI absent or errored AND not a deliberate skip.
  if (drafts.length === 0 && !skip) {
    drafts = await generateDraftsMock(trend, brand);
    mode = 'mock';
  }

  if (body.replace) {
    await prisma.draft.deleteMany({ where: { trendId: id } });
  }
  if (drafts.length > 0) await addDrafts(drafts);

  await logAudit({
    orgId: auth.org.id, userId: auth.user.id,
    action: 'draft.generated', target: id,
    meta: { count: drafts.length, mode, provider, model, tier, hadResearch: !!research, aiError, skip: skip?.reason, replace: !!body.replace },
  });
  publishBrandTrend(auth.brand.id, { type: 'trend.updated', brandId: auth.brand.id, trendId: trend.id, reason: 'draft_added' });

  return NextResponse.json({
    drafts, mode, provider, model, tier,
    hadResearch: !!research, aiError, skip,
    variantsChosen, variantsSkipped,
  });
}
