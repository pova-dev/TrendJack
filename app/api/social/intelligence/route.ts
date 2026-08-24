// Social intelligence endpoint.
//
// GET  returns the computed brief: standings, gaps, opportunities. Free, fast,
//      and works with no AI credentials at all.
// POST additionally asks a model for the narrative and the viral pattern read.
//      Split deliberately: the page must render instantly from computed data,
//      with the prose arriving separately rather than blocking the whole panel
//      behind a model call that may be slow, or unavailable.

import { NextResponse } from 'next/server';
import { requireBrand } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOrgCredentials } from '@/lib/credentials';
import { buildDailyBrief, engagementRate, type AccountSeries } from '@/lib/social/analytics';
import { generateBriefNarrative, analyzeViralPatterns, type ViralPost } from '@/lib/social/brief';
import type { SocialPlatform } from '@/lib/social/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Readings per account for the trend window. 7 days at 15 minutes is ~672,
 *  which is more resolution than any of these metrics needs; 200 keeps the
 *  payload small while still covering the window. */
const MAX_SAMPLES = 200;

async function loadSeries(brandId: string): Promise<AccountSeries[]> {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, active: true },
    include: {
      samples: { orderBy: { sampledAt: 'desc' }, take: MAX_SAMPLES },
      posts: { where: { isLatest: true }, take: 1 },
    },
  });

  return accounts.map(a => ({
    accountId: a.id,
    platform: a.platform as SocialPlatform,
    handle: a.handle,
    label: a.competitorName || a.displayName || a.handle,
    isOwn: a.isOwn,
    // Stored newest-first for the "latest" lookup; analytics reads oldest-first.
    samples: [...a.samples].reverse().map(s => ({
      at: s.sampledAt,
      followers: Number(s.followers),
      postCount: s.postCount,
    })),
    latestPost: a.posts[0]
      ? {
          likes: Number(a.posts[0].likes),
          views: Number(a.posts[0].views),
          commentCount: a.posts[0].commentCount,
          postedAt: a.posts[0].postedAt,
        }
      : null,
  }));
}

export async function GET(req: Request) {
  const ctx = await requireBrand();
  const windowDays = Number(new URL(req.url).searchParams.get('windowDays')) || 7;

  const series = await loadSeries(ctx.brand.id);
  const brief = buildDailyBrief(series, windowDays);

  return NextResponse.json({
    brief,
    // Tells the UI whether to offer the narrative at all, so it never shows a
    // button whose only outcome is an error.
    aiAvailable: await hasAiKey(ctx.org!.id),
  });
}

export async function POST(req: Request) {
  const ctx = await requireBrand();
  const body = await req.json().catch(() => ({})) as { windowDays?: number; want?: string[] };
  const windowDays = body.windowDays ?? 7;
  const want = new Set(body.want ?? ['narrative', 'viral']);

  const creds = await getOrgCredentials(ctx.org!.id);
  const series = await loadSeries(ctx.brand.id);
  const brief = buildDailyBrief(series, windowDays);

  // Both model calls are independent, so run them together rather than
  // serially. Either can fail without taking the other down.
  const [narrative, viral] = await Promise.all([
    want.has('narrative')
      ? generateBriefNarrative(brief, creds, ctx.org!.id)
      : Promise.resolve(null),
    want.has('viral')
      ? analyzeViralPatterns(await loadViralPosts(ctx.brand.id), creds, ctx.org!.id)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ brief, narrative, viral });
}

/** Posts with engagement data, best first, with their loaded comments. */
async function loadViralPosts(brandId: string): Promise<ViralPost[]> {
  const posts = await prisma.socialPost.findMany({
    where: { account: { brandId, active: true } },
    orderBy: { likes: 'desc' },
    take: 20,
    include: {
      account: {
        select: {
          competitorName: true, displayName: true, handle: true, platform: true,
          samples: { orderBy: { sampledAt: 'desc' }, take: 1, select: { followers: true } },
        },
      },
      comments: { orderBy: { likes: 'desc' }, take: 5, select: { text: true } },
    },
  });

  return posts.map(p => {
    const followers = p.account.samples[0] ? Number(p.account.samples[0].followers) : null;
    return {
      label: p.account.competitorName || p.account.displayName || p.account.handle,
      platform: p.account.platform,
      caption: p.caption,
      likes: Number(p.likes),
      views: Number(p.views),
      commentCount: p.commentCount,
      engagementRatePct: engagementRate(
        { likes: Number(p.likes), commentCount: p.commentCount }, followers,
      ),
      topComments: p.comments.map(c => c.text),
    };
  });
}

async function hasAiKey(orgId: string): Promise<boolean> {
  const creds = await getOrgCredentials(orgId);
  return !!(creds.ANTHROPIC_API_KEY || creds.OPENAI_API_KEY || creds.GOOGLE_API_KEY || creds.OPENROUTER_API_KEY
    || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
}
