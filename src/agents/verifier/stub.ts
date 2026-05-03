// Stubbed VerifierAdapter — used in tests and as a no-LLM fallback when
// no premium API key is configured. Returns deterministic claims derived
// directly from the signal title/summary (no fabrication, no LLM calls).
//
// Production should swap this for an adapter backed by an LLM + retrieval
// pipeline. The interface is the same; the wiring at Architect-Agent
// boot decides which adapter is active.

import type { VerifierAdapter } from './types';

export const stubVerifier: VerifierAdapter = {
  async verify({ signal }) {
    // The "claim": the trend's own title, sourced from its own URL.
    // Confidence is high (1.0) because we're not making anything up —
    // we're just echoing what the source said.
    const claims = signal.url
      ? [
          {
            id: `stub:${signal.externalId ?? signal.title.slice(0, 40)}`,
            key: 'title',
            value: signal.title.slice(0, 200),
            sourceUrl: signal.url,
            quotedSpan: signal.summary.slice(0, 200) || signal.title.slice(0, 200),
            confidence: 1.0,
          },
        ]
      : [];

    return {
      summary:
        `Stub verifier (no LLM call). Source: ${signal.source}. ` +
        `Title: ${signal.title.slice(0, 120)}. To extract structured ` +
        `claims (price, specs, dates, etc.) configure a premium AI provider.`,
      claims,
      unverifiedClaims: [],
      provider: 'none',
      model: 'stub',
      tier: 'balanced',
    };
  },
};
