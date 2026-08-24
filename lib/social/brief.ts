// Daily brief narrative, and viral pattern analysis.
//
// These are the only two places a language model touches social analytics, and
// the boundary is deliberate. Every number is computed in analytics.ts and
// handed over precomputed. The model's job is to say what the numbers MEAN,
// never to work out what they ARE.
//
// That boundary is enforced, not merely requested. The prompt forbids
// arithmetic, the payload contains formatted figures rather than raw series,
// and the output is validated against the facts it was given. A narrative that
// invents a number is rejected rather than shown, because a confident wrong
// number on a decision dashboard is worse than no narrative at all.
//
// Premium tier throughout: this is user-visible fact, which CLAUDE.md
// hard-rule 3 reserves for Claude or GPT-4o.

import { runChat } from '@/lib/ai/provider';
import type { OrgCredentials } from '@/lib/credentials';
import type { DailyBrief, Opportunity, RankRow } from './analytics';

export interface BriefNarrative {
  /** Two or three sentences an operator can act on. */
  summary: string;
  /** Ordered, most consequential first. */
  moves: string[];
  provider: string;
  /** False when no model was reachable; the brief still renders without it. */
  aiGenerated: boolean;
  /** Present when generation was attempted and failed. */
  error?: string;
}

const SYSTEM = `You are a social strategist briefing a phone brand's marketing lead.

ABSOLUTE RULE: every number you use must appear verbatim in the DATA block.
Never calculate, estimate, round, combine or infer a figure. If a number you
want is not in the DATA block, write the sentence without it.

Voice: direct and specific. No hype, no filler, no "in today's fast-paced
landscape". Name competitors. Prefer a concrete number over an adjective.

Return JSON only:
{"summary": "2-3 sentences on where we stand and what changed",
 "moves": ["specific action", "specific action", "specific action"]}

Each move names what to do and why, referencing a number from DATA. Three
moves maximum, fewer if the data does not support three.`;

/** Format the brief as a flat block of already-computed figures.
 *
 *  Raw series are deliberately withheld. Given samples the model would be
 *  tempted to compute a rate; given only finished figures there is nothing to
 *  compute, so the failure mode disappears rather than being policed. */
export function briefToPrompt(brief: DailyBrief): string {
  const lines: string[] = [];
  const f = brief.facts;

  lines.push('OUR POSITION');
  lines.push(`  accounts tracked: ${f.accountsTracked}${f.accountsAwaitingData ? ` (${f.accountsAwaitingData} awaiting first reading)` : ''}`);
  if (f.ownFollowersTotal !== null) lines.push(`  our total followers: ${f.ownFollowersTotal.toLocaleString()}`);
  if (f.ownFollowersDelta !== null) lines.push(`  change over window: ${f.ownFollowersDelta >= 0 ? '+' : ''}${f.ownFollowersDelta.toLocaleString()}`);
  if (f.bestPlatform) lines.push(`  strongest platform: ${f.bestPlatform.platform}, rank ${f.bestPlatform.rank} of ${f.bestPlatform.of}`);
  if (f.worstPlatform) lines.push(`  weakest platform: ${f.worstPlatform.platform}, rank ${f.worstPlatform.rank} of ${f.worstPlatform.of}`);

  for (const platform of brief.platforms) {
    const rows = brief.rows.filter(r => r.platform === platform);
    if (!rows.length) continue;
    lines.push('', `${platform.toUpperCase()} STANDINGS`);
    for (const r of rows) {
      const bits = [
        `rank ${r.rank}`,
        `${r.label}${r.isOwn ? ' (US)' : ''}`,
        `${r.followers.toLocaleString()} followers`,
        `${r.sharePct.toFixed(1)}% share`,
      ];
      if (r.growth.perDay !== null) bits.push(`${r.growth.perDay >= 0 ? '+' : ''}${Math.round(r.growth.perDay).toLocaleString()}/day`);
      if (r.engagementRatePct !== null) bits.push(`${r.engagementRatePct.toFixed(2)}% engagement`);
      if (r.gapToNext !== null) bits.push(`${r.gapToNext.toLocaleString()} behind the account above`);
      lines.push(`  ${bits.join(' | ')}`);
    }
  }

  if (brief.opportunities.length) {
    lines.push('', 'SIGNALS ALREADY DETECTED');
    for (const o of brief.opportunities.slice(0, 6)) {
      lines.push(`  [${o.platform}] ${o.headline}. ${o.detail}`);
    }
  }
  return lines.join('\n');
}

/** Every number the model is allowed to use, as strings, for validation. */
function allowedNumbers(brief: DailyBrief): Set<string> {
  const out = new Set<string>();
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    const r = Math.round(n);
    out.add(String(r));
    out.add(r.toLocaleString('en-US'));
    out.add(Math.abs(r).toLocaleString('en-US'));
    out.add(n.toFixed(1));
    out.add(n.toFixed(2));
  };

  const f = brief.facts;
  add(f.ownFollowersTotal); add(f.ownFollowersDelta);
  add(f.accountsTracked); add(f.accountsAwaitingData);
  if (f.bestPlatform) { add(f.bestPlatform.rank); add(f.bestPlatform.of); }
  if (f.worstPlatform) { add(f.worstPlatform.rank); add(f.worstPlatform.of); }

  for (const r of brief.rows) {
    add(r.followers); add(r.rank); add(r.sharePct);
    add(r.growth.perDay); add(r.growth.absolute); add(r.growth.percent);
    add(r.engagementRatePct); add(r.gapToNext); add(r.gapToLeader);
  }
  // Opportunity strings carry their own figures; allow anything they contain.
  for (const o of brief.opportunities) {
    for (const m of `${o.headline} ${o.detail}`.matchAll(/[\d,]+(?:\.\d+)?/g)) out.add(m[0]);
  }
  return out;
}

/**
 * Numbers in the text that were never supplied.
 *
 * Small integers are ignored: "3 moves", "top 5" and ordinals are language,
 * not claims about the data, and flagging them would reject good briefs.
 */
export function unsupportedNumbers(text: string, allowed: Set<string>): string[] {
  const found = text.match(/[\d,]+(?:\.\d+)?%?/g) ?? [];
  const bad: string[] = [];
  for (const raw of found) {
    const tok = raw.replace(/%$/, '');
    if (allowed.has(tok)) continue;
    const plain = tok.replace(/,/g, '');
    if (allowed.has(plain)) continue;
    const num = Number(plain);
    if (!Number.isFinite(num)) continue;
    if (Math.abs(num) <= 12 && Number.isInteger(num)) continue;  // ordinals, counts
    bad.push(raw);
  }
  return [...new Set(bad)];
}

export async function generateBriefNarrative(
  brief: DailyBrief,
  credentials?: OrgCredentials,
  orgId?: string,
): Promise<BriefNarrative> {
  // Nothing to narrate. Say so plainly instead of asking a model to pad.
  if (!brief.rows.length) {
    return {
      summary: 'No readings yet. Add channels and a provider key, and the first brief follows the next poll.',
      moves: [], provider: 'none', aiGenerated: false,
    };
  }

  const ai = await runChat({
    tier: 'premium',
    system: SYSTEM,
    messages: [{ role: 'user', content: `DATA\n${briefToPrompt(brief)}\n\nWrite the brief.` }],
    maxTokens: 700,
    temperature: 0.3,
    jsonMode: true,
    credentials,
    orgId,
  });

  if (!ai.ok) {
    return {
      summary: fallbackSummary(brief),
      moves: brief.opportunities.slice(0, 3).map(o => `${o.headline}. ${o.detail}`),
      provider: ai.provider,
      aiGenerated: false,
      error: ai.error,
    };
  }

  let parsed: { summary?: string; moves?: unknown };
  try {
    parsed = JSON.parse(stripFence(ai.text)) as { summary?: string; moves?: unknown };
  } catch {
    return {
      summary: fallbackSummary(brief),
      moves: brief.opportunities.slice(0, 3).map(o => `${o.headline}. ${o.detail}`),
      provider: `${ai.provider}:${ai.model}`,
      aiGenerated: false,
      error: 'model returned unparseable JSON',
    };
  }

  const summary = String(parsed.summary ?? '').trim();
  const moves = Array.isArray(parsed.moves)
    ? parsed.moves.map(m => String(m).trim()).filter(Boolean).slice(0, 3)
    : [];

  // Reject fabricated figures. A wrong number stated confidently on a decision
  // dashboard is worse than no narrative, and this is the one failure mode a
  // model is genuinely prone to here.
  const allowed = allowedNumbers(brief);
  const bad = unsupportedNumbers([summary, ...moves].join(' '), allowed);
  if (bad.length) {
    return {
      summary: fallbackSummary(brief),
      moves: brief.opportunities.slice(0, 3).map(o => `${o.headline}. ${o.detail}`),
      provider: `${ai.provider}:${ai.model}`,
      aiGenerated: false,
      error: `narrative cited figures absent from the data (${bad.slice(0, 3).join(', ')}), so the computed summary is shown instead`,
    };
  }

  return { summary, moves, provider: `${ai.provider}:${ai.model}`, aiGenerated: true };
}

/** Deterministic summary. Used whenever the model is unavailable or wrong, so
 *  the panel is never empty and never speculative. */
export function fallbackSummary(brief: DailyBrief): string {
  const f = brief.facts;
  const parts: string[] = [];

  if (f.ownFollowersTotal !== null) {
    const d = f.ownFollowersDelta;
    parts.push(
      d === null || d === 0
        ? `${f.ownFollowersTotal.toLocaleString()} followers across your channels.`
        : `${f.ownFollowersTotal.toLocaleString()} followers across your channels, ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toLocaleString()}.`,
    );
  }
  if (f.bestPlatform) parts.push(`Strongest on ${f.bestPlatform.platform} at rank ${f.bestPlatform.rank} of ${f.bestPlatform.of}.`);
  if (brief.opportunities.length) parts.push(brief.opportunities[0].headline + '.');
  if (f.accountsAwaitingData) parts.push(`${f.accountsAwaitingData} channel(s) still awaiting a first reading.`);

  return parts.join(' ') || 'Not enough data yet for a brief.';
}

// ---------------------------------------------------------------------------
// Viral pattern analysis
// ---------------------------------------------------------------------------

export interface ViralPost {
  label: string;
  platform: string;
  caption?: string | null;
  likes: number;
  views: number;
  commentCount: number;
  engagementRatePct: number | null;
  topComments?: string[];
}

export interface ViralAnalysis {
  /** What the strong posts share. */
  patterns: { name: string; evidence: string }[];
  /** Formats worth trying, grounded in what is working. */
  formats: string[];
  /** What the audience is actually saying, when comments were available. */
  audienceThemes: string[];
  provider: string;
  aiGenerated: boolean;
  /** Posts the analysis is based on. Small samples get said out loud. */
  sampleSize: number;
  error?: string;
}

const VIRAL_SYSTEM = `You analyse what makes social posts perform for a phone brand.

You receive posts with their engagement figures, ranked. Identify what the
strong performers have in common that the weak ones do not: hook structure,
caption length, format, tone, subject matter, use of specs or numbers.

Rules:
- Ground every pattern in the posts given. Quote or paraphrase a caption as
  evidence. Never invent an example.
- Never state a figure that is not in the DATA block.
- If the sample is too small or too uniform to support a claim, say so rather
  than inventing a pattern. An honest "not enough signal" is a valid answer.

Return JSON only:
{"patterns": [{"name": "short label", "evidence": "why, citing a post"}],
 "formats": ["format worth trying and why"],
 "audienceThemes": ["what commenters keep raising"]}`;

export async function analyzeViralPatterns(
  posts: ViralPost[],
  credentials?: OrgCredentials,
  orgId?: string,
): Promise<ViralAnalysis> {
  const empty = (error?: string, provider = 'none'): ViralAnalysis => ({
    patterns: [], formats: [], audienceThemes: [],
    provider, aiGenerated: false, sampleSize: posts.length, error,
  });

  // Below three posts there is nothing to compare, and "patterns" derived from
  // one or two posts are decoration.
  if (posts.length < 3) {
    return empty('Need at least 3 posts with engagement data before patterns mean anything.');
  }

  const ranked = [...posts].sort((a, b) => (b.engagementRatePct ?? 0) - (a.engagementRatePct ?? 0));
  const lines = ranked.map((p, i) => {
    const bits = [
      `#${i + 1} ${p.label} (${p.platform})`,
      `${p.likes.toLocaleString()} likes`,
      `${p.commentCount.toLocaleString()} comments`,
    ];
    if (p.views > 0) bits.push(`${p.views.toLocaleString()} views`);
    if (p.engagementRatePct !== null) bits.push(`${p.engagementRatePct.toFixed(2)}% engagement`);
    const head = bits.join(' | ');
    const cap = p.caption ? `\n     caption: ${p.caption.slice(0, 300)}` : '\n     caption: (none)';
    const com = p.topComments?.length ? `\n     comments: ${p.topComments.slice(0, 5).map(c => `"${c.slice(0, 120)}"`).join('; ')}` : '';
    return `  ${head}${cap}${com}`;
  });

  const ai = await runChat({
    tier: 'premium',
    system: VIRAL_SYSTEM,
    messages: [{ role: 'user', content: `DATA (${posts.length} posts, best engagement first)\n${lines.join('\n')}\n\nAnalyse.` }],
    maxTokens: 900,
    temperature: 0.4,
    jsonMode: true,
    credentials,
    orgId,
  });

  if (!ai.ok) return empty(ai.error, ai.provider);

  try {
    const parsed = JSON.parse(stripFence(ai.text)) as Partial<ViralAnalysis>;
    const str = (v: unknown) => String(v).trim();
    return {
      patterns: Array.isArray(parsed.patterns)
        ? parsed.patterns.slice(0, 6).map(p => ({ name: str((p as { name?: unknown }).name), evidence: str((p as { evidence?: unknown }).evidence) }))
        : [],
      formats: Array.isArray(parsed.formats) ? parsed.formats.map(str).filter(Boolean).slice(0, 5) : [],
      audienceThemes: Array.isArray(parsed.audienceThemes) ? parsed.audienceThemes.map(str).filter(Boolean).slice(0, 5) : [],
      provider: `${ai.provider}:${ai.model}`,
      aiGenerated: true,
      sampleSize: posts.length,
    };
  } catch {
    return empty('model returned unparseable JSON', `${ai.provider}:${ai.model}`);
  }
}

function stripFence(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
