// Contextual draft generator. Uses the cost-aware AI provider to produce
// brand-voice-aligned drafts that are grounded in:
//   - the trend's title, lineage, hashtags, examples
//   - the brand's voice doctrine (banned phrases, forbidden styles,
//     allowed jokes, audience, competitors)
//   - cached research (key facts) when present, so drafts can reference
//     specific prices, specs, dates rather than generic vibes
//
// Returns a discriminated result so callers can surface the AI provider /
// model / error rather than silently falling back to the deterministic
// mock generator (which produces the same hooks for every trend).

import type { BrandProfile, Draft, Trend } from '@/types';
import { runChat } from './provider';
import type { OrgCredentials } from '@/lib/credentials';
import type { ResearchResult } from '@/lib/research';

export interface DraftGenOk {
  ok: true;
  drafts: Draft[];
  /** When the AI decides this trend isn't draftable (competitor-claimed,
   *  banned topic surfaced, news-only with no brand angle, etc.) it returns
   *  a skip recommendation instead of 6 generic drafts. */
  skip?: { reason: string; suggestion: string };
  /** Variants the AI considered appropriate (so the UI can show "this trend
   *  wasn't a meme topic" rather than just listing variants that worked). */
  variantsChosen: string[];
  variantsSkipped: { variant: string; reason: string }[];
  provider: string;
  model: string;
  tier: 'cheap' | 'balanced' | 'premium';
  hadResearch: boolean;
  inputTokens?: number;
  outputTokens?: number;
}
export interface DraftGenErr {
  ok: false;
  error: string;
  provider: string;
}
export type DraftGenResult = DraftGenOk | DraftGenErr;

const SYSTEM_PROMPT = `
You are a senior reactive-marketing copywriter. You write the kind of copy
that screenshots get pinned to design-team Slacks. Not agency copy. Not
corporate copy. Copy that sounds like a sharp, confident person who has a
strong POV — not a brand pretending to have one.

═══════════════════════════════════════════════════════════════════════════
WHAT GREAT COPY LOOKS LIKE — internalize the rhythm
═══════════════════════════════════════════════════════════════════════════

Trend: "Battery anxiety is the new range anxiety"  (X thread, tech)
✓ "5000mAh is the new minimum. anyone shipping less in 2026 is shipping last year."
✓ "we don't do flagship killers. we do phones that survive."
✓ "battery is the spec that actually changes your life."
✗ "Unleash all-day power!"                       — cringe + banned phrase
✗ "Industry-leading battery life."                — corporate sludge
✗ "Level up your battery game."                   — forced slang + banned

Trend: "Drop test on a budget phone"  (TikTok format)
✓ "the cheapest test you can run is 'is the screen still there'."
✓ "our phones aren't drop-tested. they're auto-rickshaw-tested."
✗ "Built for adventurers!"                        — generic agency-speak
✗ "Crushing it under pressure."                   — banned phrase

Trend: "Realme launches GT 7 Pro"  (competitor)
✓ "good launch. now do battery."                  — sharp, brief, on-POV
✓ "we're not racing realme on chips. we're racing them on the bus home."
✗ "Welcome to the arena, realme."                 — smarmy
✗ "A real game changer for the segment."          — banned phrase + cringe

Trend: "Phone overheats in 18 minutes of gaming"  (Reddit gripe)
✓ "if your phone is a sandwich press in 20 min, you didn't buy a phone."
✓ "performance you can't sustain isn't performance."
✗ "Game on with our cool tech."                   — corny

═══════════════════════════════════════════════════════════════════════════
WHY THE GREAT EXAMPLES WORK
═══════════════════════════════════════════════════════════════════════════
- Specific number, name, or scene — never generic outcomes.
- Short. Most great hooks are 6-12 words.
- Confident POV, not cheerleading.
- Reference the actual thing in the trend — battery, drop test, realme,
  sandwich press. NOT "your experience" or "performance".
- Punchy rhythm — the period is a weapon.
- Lowercase often beats Title Case for sharp voices (read brand profile).
- Honest > superlative. "good launch. now do battery." beats "best phone ever."
- Never write a line that could appear unchanged on a competitor's feed.

═══════════════════════════════════════════════════════════════════════════
VARIANT INTELLIGENCE — not every trend warrants every variant
═══════════════════════════════════════════════════════════════════════════

  Trend type                      → variants that fit
  ─────────────────────────────────────────────────────────
  Brand / product launch news     → safe, bold, carousel/reel  (NOT meme)
  Cultural / meme moment          → meme, bold, reel           (NOT carousel for hard data)
  Competitor launch / claimed     → SKIP or 1 sharp pivot
  Hard news / political / tragedy → SKIP — banned topic
  Regulation / policy update      → safe carousel only
  Creator / influencer thread     → safe, meme, reel
  Spec-debate / community gripe   → bold, meme                 (have a POV)
  Trending search query           → SKIP unless directly relevant

If the trend is inherently un-actionable for THIS brand (banned topic,
claimed by 2+ competitors, off-audience, off-category), set "skip" with a
reason + 1-line pivot. drafts must be [].

═══════════════════════════════════════════════════════════════════════════
OUTPUT — STRICT JSON ONLY · no markdown · no prose outside the JSON
═══════════════════════════════════════════════════════════════════════════

{
  "skip": null | { "reason": string, "suggestion": string },
  "variantsChosen":  ["safe","bold",...],
  "variantsSkipped": [{"variant":"meme","reason":"why"}, ...],
  "drafts": [
    {
      "variant": "safe"|"bold"|"meme"|"carousel"|"reel"|"poll",
      "platform": string,
      "hook": string,                  // ≤ 80 chars · scroll-stopper · short.
      "body": string,                  // ≤ 240 chars
      "cta": string | null,
      "visualBrief": string | null,
      "whyItWorks": string,            // 1 sentence; cites THIS trend
      "whatNotToSay": string,          // 2-3 traps SPECIFIC to this trend
      "cringeScore": number            // 0..1 self-honest
    }
  ]
}

When skip is non-null, drafts = []. Otherwise produce 3-6 drafts spanning
only the variants you chose.

═══════════════════════════════════════════════════════════════════════════
HARD RULES — never break
═══════════════════════════════════════════════════════════════════════════
- Match brand.tone.voice exactly. Never use any phrase from
  brand.tone.bannedPhrases. Never write in any brand.tone.forbiddenStyles.
- Anti-cliché filter: reject (and rewrite) any of: unleash, limitless,
  best version, level up, redefine, reimagined, game changer, crushing it,
  dream big, world-class, next-level, push the boundaries, take it to the
  next level, elevate your, transform your, reinvent.
- Every draft must reference a SPECIFIC fact from TREND or research —
  number / name / handle / date / entity. Generic outcome prose like
  "upgrade your experience" is a failure mode.
- Each draft distinctly different in angle, register, length. No filler.
- whatNotToSay = 2-3 traps SPECIFIC to this trend (not generic). e.g.
  "don't name realme directly", "don't claim 5000mAh without our SKU".
- Pick the right platform per draft. Memes belong on X / Reels / TikTok.
  Carousels on Instagram / LinkedIn. Long thoughtful posts on LinkedIn.

Self-check before emitting:
- Did I correctly classify trend type and SKIP or filter variants?
- Does each draft cite something specific from the trend?
- Are any two drafts structurally similar? Rewrite the second.
- Would any line read as off-brand on a competitor's feed? Rewrite.
- Does each hook feel like something a real sharp human would write,
  unprompted, at a bar discussing this trend?
`.trim();

// Hook descriptions used to guide the AI when the operator picks a
// specific angle. Mirrors src/agents/creative/hooks.ts but inlined so
// this server module doesn't import the agents layer.
const HOOK_DESCRIPTIONS: Record<string, string> = {
  challenger:      "Brand does the OPPOSITE of the trend, and wins by it. Direct, contrarian framing.",
  educator:        "Explain the tech / mechanism / story behind the trend. Inform without selling.",
  comedian:        "Self-aware, anti-marketing wit. Roast the trend gently. Only when cringe is low.",
  expert_reaction: "Analyst voice — 'here's what we'd actually do, and why'. Skip the 'we' fluff, lead with the take.",
  told_you_so:     "Trend proves the brand's prior thesis. Reference a specific past stance.",
  meta_observer:   "Acknowledge the conversation is happening without taking direct sides. Detached, smart.",
  positional:      "Take a defined stance that contrasts the polarized noise. Not contrarian for its own sake — substantive.",
};

export async function generateDraftsLive(args: {
  trend: Trend;
  brand: BrandProfile;
  research?: ResearchResult | null;
  credentials?: OrgCredentials;
  /** Bumps the prompt with a seed so a regenerate produces fresh variations. */
  seed?: string;
  /** Operator-selected Hook id from the Hook Library. When set, the AI
   *  is instructed to produce drafts that all hit this angle, instead
   *  of auto-picking variant types. */
  hookId?: string;
  /** Operator-selected Template id (channel + structure). When set,
   *  drafts are constrained to this template's channel + format. */
  templateId?: string;
  /** Org id for daily AI budget enforcement. Drafts are ALWAYS premium
   *  tier ($3/$15 per M tokens) so a single chatty draft can be 1-2¢. */
  orgId?: string;
}): Promise<DraftGenResult> {
  const { trend, brand, research, credentials, seed, hookId, templateId, orgId } = args;

  // Drafts are always high-stakes brand voice — ALWAYS premium tier.
  // Mid-tier models (Llama 70B, Kimi) produce competent but flat copy
  // that fails the "could appear in a competitor's ad" test. Premium tier
  // routes to Claude / GPT-4o / Gemini 2.5 Pro depending on which key is
  // configured, all of which are dramatically better at voice nuance.
  const tier: 'premium' = 'premium';

  const userPayload = `BRAND PROFILE
${JSON.stringify({
  name: brand.name,
  category: brand.category,
  voice: brand.tone.voice,
  tagline: brand.tone.tagline,
  bannedPhrases: brand.tone.bannedPhrases,
  forbiddenStyles: brand.tone.forbiddenStyles,
  allowedJokes: brand.tone.allowedJokes,
  bannedTopics: brand.bannedTopics,
  safeThemes: brand.safeThemes,
  competitors: brand.competitors,
  audience: brand.audience,
  priorityPlatforms: brand.priorityPlatforms,
  riskTolerance: brand.riskTolerance,
}, null, 2)}

TREND
title: ${trend.title}
summary: ${trend.summary}
lineage: ${trend.lineage}
${trend.catalyst ? `catalyst: ${trend.catalyst}\n` : ''}hashtags: ${trend.hashtags.join(' ')}
source: ${trend.source}${trend.url ? `\nurl: ${trend.url}` : ''}
recommendation: ${trend.recommendation}
scores: opp=${trend.scores.opportunity} fit=${Math.round(trend.scores.brandFit*100)} risk=${Math.round(trend.scores.risk*100)} cringe=${Math.round(trend.scores.cringe*100)}
${trend.competitorClaimed ? `claimed_by: ${trend.competitorClaimants.join(', ')}\n` : ''}${(trend.examples ?? []).slice(0, 3).map(e => `example (${e.author}): ${e.text}`).join('\n')}

${research ? `WEB RESEARCH (verified facts — prefer these over generic claims)
summary: ${research.summary}
${(research.keyFacts ?? []).map(f => `- ${f.label}: ${f.value}`).join('\n')}
sources:
${(research.sources ?? []).slice(0, 4).map((s, i) => `  ${i+1}. ${s.title} — ${s.url}`).join('\n')}
` : 'WEB RESEARCH: not yet run for this trend. Reference only what is in TREND. Do NOT invent specifics.'}

${hookId && HOOK_DESCRIPTIONS[hookId] ? `OPERATOR HOOK SELECTION
The operator picked the "${hookId}" hook. EVERY draft you produce must
hit this specific angle:

  ${HOOK_DESCRIPTIONS[hookId]}

Do not vary the angle across drafts — vary the wording, the platform,
the length, but the underlying take is locked. Reject "balanced" or
"educational" framings if the hook is "challenger" / "comedian" /
"positional", and vice versa.
` : ''}${templateId ? `OPERATOR TEMPLATE SELECTION
Constrain output to the "${templateId}" template:
  ${templateId === 'x-thread-3'        ? 'X (Twitter) thread, exactly 3 posts, ≤220 chars each.' :
    templateId === 'x-single'          ? 'Single X post, ≤280 chars total.' :
    templateId === 'ig-carousel-5'     ? 'Instagram carousel, 5 slides, ≤30 words each.' :
    templateId === 'tiktok-script-30s' ? 'TikTok script, ~30s read time, on-screen text + voice direction.' :
    templateId === 'linkedin-200w'     ? 'LinkedIn post, ~200 words, professional register.' :
    'Use your judgment for this template id.'}
Skip any draft variant that doesn't fit this template.
` : ''}GENERATION SEED: ${seed ?? Date.now().toString(36)}
(Use this seed to ensure each regenerate produces fresh angles. Do not echo it back.)

Generate the drafts now. STRICT JSON only.`;

  const ai = await runChat({
    tier,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
    // 6 drafts × ~250 tokens each + variantsSkipped reasons + skip block
    // ≈ 2.4k. Use 4000 to leave generous headroom — JSON output is sticky
    // and gets penalized when truncated mid-string.
    maxTokens: 4000,
    temperature: 0.85,
    jsonMode: true,
    credentials,
    orgId,
  });

  if (!ai.ok) return { ok: false, error: ai.error, provider: ai.provider };

  type Parsed = {
    skip?: { reason: string; suggestion: string } | null;
    variantsChosen?: string[];
    variantsSkipped?: { variant: string; reason: string }[];
    drafts?: Array<Record<string, unknown>>;
  };
  let parsed: Parsed | null = null;
  try { parsed = JSON.parse(stripJson(ai.text)) as Parsed; }
  catch {
    return { ok: false, error: `parse_failed: model returned non-JSON. First 200 chars: ${ai.text.slice(0, 200)}`, provider: ai.provider };
  }

  const skip = parsed?.skip ?? undefined;
  if (!skip && (!parsed?.drafts || parsed.drafts.length === 0)) {
    return { ok: false, error: 'empty_drafts: model returned no drafts and no skip reason', provider: ai.provider };
  }

  const baseTime = new Date().toISOString();
  const drafts: Draft[] = (parsed?.drafts ?? []).slice(0, 8).map((d, i) => ({
    id: `draft_${trend.id}_${baseTime.slice(11, 19).replace(/:/g, '')}_${i}`,
    trendId: trend.id,
    brandId: brand.id,
    variant: ((d.variant ?? 'safe') as Draft['variant']),
    platform: String(d.platform ?? brand.priorityPlatforms[0] ?? 'x'),
    hook: String(d.hook ?? '').slice(0, 200),
    body: String(d.body ?? '').slice(0, 500),
    cta: d.cta ? String(d.cta) : undefined,
    visualBrief: d.visualBrief ? String(d.visualBrief) : undefined,
    whyItWorks: d.whyItWorks ? String(d.whyItWorks) : undefined,
    whatNotToSay: d.whatNotToSay ? String(d.whatNotToSay) : undefined,
    cringeScore: typeof d.cringeScore === 'number' ? d.cringeScore : 0.2,
    status: 'draft',
    createdAt: baseTime,
  }));

  return {
    ok: true,
    drafts,
    skip: skip ?? undefined,
    variantsChosen: parsed?.variantsChosen ?? drafts.map(d => d.variant),
    variantsSkipped: parsed?.variantsSkipped ?? [],
    provider: ai.provider,
    model: ai.model,
    tier,
    hadResearch: !!research,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
  };
}

function stripJson(s: string): string {
  // 1. Closed markdown fence: ```json {...} ```
  const fencedComplete = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fencedComplete) return fencedComplete[1].trim();
  // 2. Opening fence with no close (model truncated). Strip the opening
  //    line and return the rest — caller's JSON.parse will still likely
  //    succeed if the JSON itself completed before truncation.
  const fencedOpen = s.match(/```(?:json)?\s*([\s\S]+)$/);
  if (fencedOpen) return fencedOpen[1].trim();
  // 3. No fences — find the first { and return from there.
  const idx = s.indexOf('{');
  if (idx >= 0) return s.slice(idx);
  return s.trim();
}
