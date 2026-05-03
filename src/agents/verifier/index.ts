// Verifier Agent.
//
// Subscribes to STREAMS.scoredTrends. When a trend's `shouldVerify` flag
// is true (set by Filter Agent at CVS ≥ AUTO_VERIFY_THRESHOLD = 0.70),
// the Verifier:
//   1. Pulls research evidence (web search + LLM extraction)
//   2. Structures it as VerifiedClaim[] (each with sourceUrl + quotedSpan + confidence)
//   3. Flags low-confidence claims as unverified (drafts can't use them)
//   4. Publishes to STREAMS.verifiedTrends
//
// The Verifier uses ONLY premium AI (Claude / GPT-4o / Gemini Pro). Free-
// tier models hallucinate numerical facts — exactly the failure mode the
// audit caught (the iron-sulfate / lithium-carbonate bug). The hard rule
// from CLAUDE.md: "Premium AI for any user-visible fact."

import type { StateBus, ScoredTrendMessage } from '@/src/core/state';
import { STREAMS } from '@/src/core/state';
import type { VerifierAdapter, VerificationResult } from './types';
export type { VerifierAdapter, VerifiedClaim, UnverifiedClaim, VerificationResult } from './types';
export { stubVerifier } from './stub';
export { makeLlmVerifier } from './llm';

export interface VerifierAgentDeps {
  bus: StateBus;
  adapter: VerifierAdapter;
  consumerGroup?: string;
}

export interface VerifierAgentHandle {
  stop: () => void;
}

const CONFIDENCE_FLOOR = 0.30;

export function startVerifierAgent(deps: VerifierAgentDeps): VerifierAgentHandle {
  const group = deps.consumerGroup ?? 'verifier-agent';

  const unsub = deps.bus.subscribe(
    STREAMS.scoredTrends,
    async (msg) => {
      const body: ScoredTrendMessage = msg.body;

      // Only act on the trends Filter explicitly flagged for verification.
      // Saves LLM dollars — most trends don't need verification.
      if (!body.shouldVerify) {
        await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
        return;
      }

      try {
        const out = await deps.adapter.verify({
          signal: body.signal,
          brandId: body.brandId,
        });

        // Demote any claim below confidence floor — model wasn't sure
        // enough for us to ship the value to a draft.
        const verified = out.claims.filter(c => c.confidence >= CONFIDENCE_FLOOR);
        const demoted = out.claims
          .filter(c => c.confidence < CONFIDENCE_FLOOR)
          .map(c => ({ key: c.key, reason: `confidence ${c.confidence.toFixed(2)} below ${CONFIDENCE_FLOOR}` }));

        const result: VerificationResult = {
          trendId: body.signal.externalId ?? `${body.signal.source}:${body.signal.url ?? body.signal.title}`,
          brandId: body.brandId,
          signal: body.signal,
          scoreResult: body.scoreResult,
          claims: verified,
          unverifiedClaims: [...out.unverifiedClaims, ...demoted],
          summary: out.summary,
          provider: out.provider,
          model: out.model,
          tier: out.tier,
          verifiedAt: new Date(),
        };

        await deps.bus.publish(STREAMS.verifiedTrends, {
          signal: body.signal,
          scoreResult: body.scoreResult,
          brandId: body.brandId,
          claims: result.claims,
          unverifiedClaims: result.unverifiedClaims,
        });

        await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
      } catch (err) {
        // Don't ack on error — bus redelivery + Architect's DLQ handle retries.
        // eslint-disable-next-line no-console
        console.error(`[verifier-agent] failed to verify ${msg.id}:`, (err as Error).message);
      }
    },
    { group, consumerName: `verifier-${process.pid ?? 'inproc'}` },
  );

  return { stop: () => unsub() };
}
