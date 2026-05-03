// Premium-AI VerifierAdapter. Uses the same provider router as drafts
// (lib/ai/provider.ts) so the operator's configured key (Anthropic /
// OpenAI / Google / OpenRouter) drives extraction. Hard-pinned to the
// 'premium' tier — never use cheap LLMs for facts the dashboard surfaces.
//
// Output contract:
//   summary: ≤500 chars human-readable digest
//   claims:  Array of { id, key, value, sourceUrl, quotedSpan, confidence }
//   unverifiedClaims: Array of { key, reason }
//
// The model is instructed to output STRICT JSON conforming to that shape.
// Parse failures fall through to the stub adapter — drafts continue to
// work, just without enriched claims.

import 'server-only';
import { runChat } from '@/lib/ai/provider';
import type { OrgCredentials } from '@/lib/credentials';
import type { VerifierAdapter, VerifiedClaim, UnverifiedClaim } from './types';

const SYSTEM_PROMPT = `
You are TrendJack's fact verifier. Given a trend signal and any web
research the operator has run, extract structured CLAIMS that downstream
draft generators can cite safely.

Each claim is one structured fact: {key, value, sourceUrl, quotedSpan, confidence}.

Rules:
- Each claim MUST have sourceUrl pointing at one of the supplied SOURCES.
- quotedSpan is the literal span from that source that backs the claim,
  ≤200 chars, EXACTLY as it appears in the source. No paraphrasing.
- confidence is 0..1. 1.0 = explicit single-sentence assertion in the
  source. 0.6 = consistent across multiple sources. 0.3 = inferred.
- DO NOT invent claims. If a key (e.g. "price", "release date") cannot be
  backed by a source span, push it into unverifiedClaims with a reason.
- If you fabricate a number that doesn't appear verbatim in any source,
  the entire output is rejected. This is a hard rule — there is no
  "approximately" mode.

Output STRICT JSON:
{
  "summary": "<≤500 chars>",
  "claims": [{ "id": "<short slug>", "key": "<noun>", "value": "<string>",
               "sourceUrl": "<url from SOURCES>", "quotedSpan": "<verbatim>",
               "confidence": 0.0..1.0 }],
  "unverifiedClaims": [{ "key": "<noun>", "reason": "<why we couldn't verify>" }]
}

If no claims can be verified, return claims: [] with a summary explaining why.
NEVER add commentary outside the JSON.
`.trim();

interface VerifierResponse {
  summary?: unknown;
  claims?: unknown;
  unverifiedClaims?: unknown;
}

export function makeLlmVerifier(opts: { credentials?: OrgCredentials } = {}): VerifierAdapter {
  return {
    async verify({ signal }) {
      const sources: Array<{ title?: string; url?: string }> = [
        ...(signal.examples ?? []).map(e => ({ title: e.author, url: e.url })),
        ...(signal.url ? [{ title: signal.title, url: signal.url }] : []),
      ];

      const userPayload = `TREND
title: ${signal.title}
summary: ${signal.summary}
source: ${signal.source}
${signal.url ? `url: ${signal.url}\n` : ''}
${signal.text ? `body:\n${signal.text.slice(0, 2000)}\n` : ''}

SOURCES (cite these in claims.sourceUrl)
${sources.length > 0
  ? sources.map((s, i) => `  ${i + 1}. ${s.title ?? 'untitled'} — ${s.url ?? '(no URL)'}`).join('\n')
  : '(no sources available — extract only claims that can cite the trend\'s own URL above)'}

Return STRICT JSON only.`;

      const ai = await runChat({
        tier: 'premium',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPayload }],
        maxTokens: 1500,
        temperature: 0.2,  // factual extraction — low temp
        jsonMode: true,
        credentials: opts.credentials,
      });

      if (!ai.ok) {
        return {
          summary: `Verifier could not run (${ai.error ?? 'unknown'}). No claims extracted.`,
          claims: [],
          unverifiedClaims: [],
          provider: ai.provider ?? 'none',
          model: 'unavailable',
          tier: 'premium' as const,
        };
      }

      let parsed: VerifierResponse = {};
      try {
        parsed = JSON.parse(ai.text);
      } catch {
        return {
          summary: 'Verifier returned non-JSON output. No claims extracted.',
          claims: [],
          unverifiedClaims: [],
          provider: ai.provider,
          model: ai.model ?? 'unknown',
          tier: 'premium' as const,
        };
      }

      const claims: VerifiedClaim[] = Array.isArray(parsed.claims)
        ? (parsed.claims as Record<string, unknown>[])
            .filter(c => typeof c.id === 'string' && typeof c.value === 'string'
                       && typeof c.sourceUrl === 'string' && typeof c.quotedSpan === 'string')
            .map(c => ({
              id: String(c.id),
              key: typeof c.key === 'string' ? c.key : 'unknown',
              value: String(c.value),
              sourceUrl: String(c.sourceUrl),
              quotedSpan: String(c.quotedSpan).slice(0, 200),
              confidence: typeof c.confidence === 'number'
                ? Math.max(0, Math.min(1, c.confidence))
                : 0.5,
            }))
        : [];

      const unverifiedClaims: UnverifiedClaim[] = Array.isArray(parsed.unverifiedClaims)
        ? (parsed.unverifiedClaims as Record<string, unknown>[])
            .filter(c => typeof c.key === 'string' && typeof c.reason === 'string')
            .map(c => ({ key: String(c.key), reason: String(c.reason) }))
        : [];

      return {
        summary: typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 500)
          : 'Verifier produced no summary.',
        claims,
        unverifiedClaims,
        provider: ai.provider,
        model: ai.model ?? 'unknown',
        tier: 'premium' as const,
      };
    },
  };
}
