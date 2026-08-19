// Deep lineage / background-check probe.
// Goes beyond the one-line origin we generate from connector metadata,
// pulling a structured story:
//
//   - earliest known origin (account, post, timestamp)
//   - inciting catalyst (the event that broke it open)
//   - spread vector — which influencers/journalists picked it up, in order
//   - inflection points where velocity changed sharply
//   - geographic and audience-segment spread
//   - is this a recurrence of a past trend?
//
// We use the cost-aware AI provider, prefer Perplexity Sonar via OpenRouter
// when present (it'll do its own web search), otherwise pass research
// snippets from our search backends as grounding.

import type { Trend } from '@/types';
import { runChat } from '@/lib/ai/provider';
import { pickCred, type OrgCredentials } from '@/lib/credentials';
import { researchTrend, type ResearchResult } from '@/lib/research';

export interface LineageProbe {
  origin: {
    earliestKnownAt?: string;       // ISO
    earliestKnownAuthor?: string;   // @handle / outlet
    earliestKnownUrl?: string;
    catalyst?: string;              // 1-line inciting event
  };
  spread: Array<{
    actor: string;                  // person / publication
    handle?: string;
    role: string;                   // 'origin' | 'amplifier' | 'mainstream' | 'critic'
    at?: string;                    // ISO if known
    note?: string;                  // why they matter to the spread
    url?: string;
  }>;
  inflectionPoints: Array<{ at?: string; description: string }>;
  geo: { primaryMarkets: string[]; emergingMarkets?: string[]; absent?: string[] };
  audience: string[];               // segments e.g. "tech reviewers in IN", "PUBG players"
  recurrence?: {
    isRecurring: boolean;
    pastInstances?: Array<{ approxWhen: string; outcome?: string }>;
  };
  timeline: Array<{ at?: string; what: string }>;
  citations: Array<{ title: string; url: string }>;
  confidence: number;               // 0..1
  generatedAt: string;
  provider: string;
}

const SYSTEM_PROMPT = `
You are TrendJack's lineage analyst. Given a trend and supporting evidence,
produce a STRICT JSON deep-lineage report. No prose outside the JSON.

Schema:
{
  "origin": {
    "earliestKnownAt": "ISO ts or null",
    "earliestKnownAuthor": "name/handle or null",
    "earliestKnownUrl": "url or null",
    "catalyst": "1 sentence, the inciting event"
  },
  "spread": [
    { "actor": "name", "handle": "@", "role": "origin|amplifier|mainstream|critic", "at": "ISO or null", "note": "1 sentence", "url": "url or null" }
  ],
  "inflectionPoints": [{ "at": "ISO or null", "description": "1 sentence" }],
  "geo": { "primaryMarkets": ["IN"], "emergingMarkets": [], "absent": [] },
  "audience": ["segment 1", "segment 2"],
  "recurrence": {
    "isRecurring": true|false,
    "pastInstances": [{ "approxWhen": "Q1 2024", "outcome": "1 sentence" }]
  },
  "timeline": [{ "at": "ISO or null", "what": "1 sentence" }],
  "citations": [{ "title": "...", "url": "..." }],
  "confidence": number     // 0..1, how grounded this is in evidence vs inferred
}

Rules:
- Never invent specific timestamps. Use null when unknown.
- Cite sources for any specific claim. If evidence is thin, set confidence
  low and say so in catalyst / timeline.
- Up to 8 spread entries, 5 inflection points, 8 timeline entries.
- timeline should be chronological.
`.trim();

export async function probeLineage(
  trend: Trend,
  credentials?: OrgCredentials,
): Promise<LineageProbe | null> {
  // Best path: OpenRouter + Perplexity Sonar — model does its own search,
  // so we don't need to prep snippets.
  const useSonar = !!pickCred(credentials, 'OPENROUTER_API_KEY');

  // Otherwise gather snippets from our free search adapter, then ask the
  // configured AI to summarize them into the lineage schema.
  let evidenceBlock = '';
  let backend = 'sonar';
  let researchPayload: ResearchResult | null = null;
  if (!useSonar) {
    try {
      researchPayload = await researchTrend(trend, credentials);
      backend = researchPayload.searchBackend;
      evidenceBlock = `WEB EVIDENCE (${researchPayload.sources?.length ?? 0} sources via ${backend})\n${(researchPayload.sources ?? []).map((s, i) => `${i+1}. ${s.title}\n   ${s.url}\n   ${s.snippet ?? ''}`).join('\n\n')}`;
    } catch {
      evidenceBlock = '';
    }
  }

  const userPayload = `TREND
title: ${trend.title}
summary: ${trend.summary}
lineage_oneliner: ${trend.lineage}
${trend.catalyst ? `catalyst_oneliner: ${trend.catalyst}\n` : ''}hashtags: ${trend.hashtags.join(' ')}
source: ${trend.source}${trend.url ? `\nurl: ${trend.url}` : ''}
firstSeenAt: ${trend.firstSeenAt}
${(trend.examples ?? []).slice(0, 3).map(e => `example (${e.author}): ${e.text}`).join('\n')}

${evidenceBlock || 'WEB EVIDENCE: please search the web yourself for verification.'}

Produce the JSON lineage report now.`;

  // PREMIUM, not balanced.
  //
  // The previous comment here claimed "Sonar will route by model name even if
  // tier == balanced". That was wrong: runChat() derives the model purely from
  // pickRouting(tier, credentials) and accepts no model override, so with an
  // OpenRouter key present `balanced` resolved to meta-llama/llama-3.3-70b —
  // a free model writing a user-visible lineage report. CLAUDE.md hard-rule 3
  // forbids exactly that.
  //
  // Cost is bounded: probeLineage() is only reachable from the on-demand route
  // /api/trends/[id]/lineage. The lineage CRON (lib/lineage-cron.ts) uses the
  // pure buildLineageLookup() and makes no AI calls at all.
  const ai = await runChat({
    tier: 'premium',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
    maxTokens: 1400,
    temperature: 0.4,
    jsonMode: true,
    credentials,
  });

  if (!ai.ok) return null;
  let parsed: Omit<LineageProbe, 'generatedAt' | 'provider'> | null = null;
  try { parsed = JSON.parse(stripJson(ai.text)); }
  catch { return null; }
  if (!parsed) return null;

  // If we got research with citations, fold those in.
  const cit = parsed.citations ?? [];
  if (researchPayload?.sources?.length) {
    for (const s of researchPayload.sources.slice(0, 6)) {
      if (!cit.find(c => c.url === s.url)) cit.push({ title: s.title, url: s.url });
    }
  }

  return {
    ...parsed,
    citations: cit,
    generatedAt: new Date().toISOString(),
    provider: `${ai.provider}:${ai.model}`,
  };
}

function stripJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  const idx = s.indexOf('{');
  if (idx > 0) return s.slice(idx);
  return s.trim();
}
