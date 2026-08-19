import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getBrand, listTrends, listDrafts, listBoardsForBrand } from '@/lib/store';
import { runChat, aiHealth } from '@/lib/ai/provider';
import { getOrgCredentials } from '@/lib/credentials';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AI co-pilot. Grounded on EVERYTHING the user can see on their dashboard:
//   - Brand profile (voice, banned phrases, safe themes, competitors,
//     audience, scoring weights)
//   - Top-50 current trends (full scores, lineage, source URLs)
//   - User's saved boards & their column filters
//   - Recent drafts (so the user can ask "what have we drafted?")
//   - Recent audit log events (last 20)
//
// Routed to the 'balanced' tier (Kimi-K2 by default). Premium tier kicks in
// when the user's question signals high-stakes brand-voice arbitration.

export async function POST(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.brand || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json() as { question: string };
  if (!body.question) return NextResponse.json({ error: 'missing_question' }, { status: 400 });

  const credentials = await getOrgCredentials(ctx.org.id);
  const health = aiHealth(credentials);
  if (!health.anthropic && !health.openrouter && !health.openai && !health.google) {
    return NextResponse.json({
      ok: false,
      reply: 'No AI provider configured. Open Settings → AI to add a key (Claude, OpenAI, Gemini, or OpenRouter — recommended).',
      needsSetup: true,
    });
  }

  const brand = await getBrand(ctx.brand.id);
  if (!brand) return NextResponse.json({ error: 'no_brand' }, { status: 400 });

  const [trends, boards, drafts, recentAudit] = await Promise.all([
    listTrends(ctx.brand.id, { limit: 50, excludeDismissed: true }),
    listBoardsForBrand(ctx.brand.id, ctx.user.id),
    listDrafts(ctx.brand.id),
    prisma.auditLog.findMany({
      where: { orgId: ctx.org.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { email: true } } },
    }),
  ]);

  // Heuristic: route to premium tier for cringe / brand-voice / risk asks.
  const q = body.question.toLowerCase();
  const tier: 'cheap' | 'balanced' | 'premium' =
    /\b(cringe|on-?brand|tone|voice|risk(?!\s*y)|crisis|legal|compliance)\b/.test(q)
      ? 'premium' : 'balanced';

  const trendsBlock = trends.map((t, i) =>
    `${i + 1}. [${t.recommendation}] opp=${t.scores.opportunity} fit=${Math.round(t.scores.brandFit * 100)} risk=${Math.round(t.scores.risk * 100)} cringe=${Math.round(t.scores.cringe * 100)} vel=${Math.round(t.velocity)}/h src=${t.source}${t.competitorClaimed ? ` claimed:${t.competitorClaimants.join(',')}` : ''}${t.pinned ? ' [pinned]' : ''}\n   ${t.title}\n   ${t.lineage}${t.url ? `\n   ${t.url}` : ''}`,
  ).join('\n\n');

  const boardsBlock = boards.map(b =>
    `- ${b.name} (${b.columns.length} columns: ${b.columns.map(c => c.title).join(', ')})`,
  ).join('\n');

  const draftsBlock = drafts.slice(0, 12).map((d, i) =>
    `${i + 1}. [${d.variant}/${d.platform}/status:${d.status}/cringe:${Math.round(d.cringeScore * 100)}] ${d.hook}`,
  ).join('\n');

  const auditBlock = recentAudit.map(a =>
    `${a.createdAt.toISOString().slice(11, 16)} ${a.user?.email ?? '—'} ${a.action}${a.target ? ` ${a.target}` : ''}`,
  ).join('\n');

  const sysPrompt = `
You are TrendJack's reactive-marketing co-pilot. Write the post. Don't lecture
about the post.

OUTPUT SHAPE — strict.

For "what should we post" / "draft" / "write" questions:
1. Skip any preamble. No "based on the trends" or "I recommend".
2. Output 1–3 ready-to-ship variants, each formatted exactly:

   ▸ <PLATFORM> · trend #<N>
   <the actual hook / first line>
   <body line 1>
   <body line 2 if needed>
   <CTA — one line, max 8 words>

3. Each variant max 6 lines. No score recitations inside the variant.
4. After the variants, ONE 8-words-max footer line: "why: <single reason>".

For "what's hot" / "any risks" / "explain trend #N" questions:
- Answer in ≤3 short sentences.
- Lead with the conclusion, not the data. Numbers go in parentheticals.

Hard rules:
- Match brand voice exactly. Banned phrases hard-fail — refuse to use them.
- Never invent facts not in CURRENT TRENDS / RECENT DRAFTS / context.
- If the question asks for data we don't have, say "no data" in 1 line.
- Hard cap: 180 words total reply unless user explicitly asks "explain in detail".
- No bullet lists of metrics. The dashboard already shows OPP/FIT/RISK/CRINGE.
- Anti-cliché: reject "unleash / level up / redefine / game-changer / next-level".
`.trim();

  const userPayload = `BRAND PROFILE
${JSON.stringify({
  name: brand.name,
  category: brand.category,
  markets: brand.markets,
  audience: brand.audience,
  voice: brand.tone.voice,
  tagline: brand.tone.tagline,
  bannedPhrases: brand.tone.bannedPhrases,
  forbiddenStyles: brand.tone.forbiddenStyles,
  bannedTopics: brand.bannedTopics,
  safeThemes: brand.safeThemes,
  competitors: brand.competitors,
  riskTolerance: brand.riskTolerance,
  approvalMode: brand.approvalMode,
  crisisMode: brand.crisisMode,
}, null, 2)}

CURRENT TRENDS (${trends.length})
${trendsBlock}

YOUR BOARDS
${boardsBlock || '— none —'}

RECENT DRAFTS
${draftsBlock || '— none —'}

RECENT ACTIVITY (last 20)
${auditBlock || '— quiet —'}

QUESTION
${body.question}`;

  const ai = await runChat({
    tier,
    system: sysPrompt,
    messages: [{ role: 'user', content: userPayload }],
    maxTokens: 900,
    temperature: 0.5,
    credentials,
  });

  if (!ai.ok) return NextResponse.json({ ok: false, reply: `[${ai.provider}] ${ai.error}` });
  return NextResponse.json({
    ok: true,
    reply: ai.text,
    provider: ai.provider,
    model: ai.model,
    tier,
    usage: { input: ai.inputTokens, output: ai.outputTokens },
  });
}
