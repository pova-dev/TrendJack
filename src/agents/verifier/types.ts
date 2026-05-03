// Verifier Agent — types.
//
// The Verifier extracts structured CLAIMS from a trend's research blob,
// each with a citation pointing back to the source. Claims with no
// citation are explicitly flagged as unverified — they cannot be used
// in drafts.

import type { RawSignal, ScoreResult } from '@/src/core/scoring';

export interface VerifiedClaim {
  /** Stable id for downstream stores. */
  id: string;
  /** Field name (e.g. "battery_life", "price_range", "release_date"). */
  key: string;
  /** Extracted value as a string. Numerical values are stringified for
   *  uniform handling — drafters parse on the way out. */
  value: string;
  /** Source URL backing this claim. */
  sourceUrl: string;
  /** Quoted span from the source that backs this claim. ≤200 chars to
   *  keep the citation copy-pasteable into a tooltip without wrapping. */
  quotedSpan: string;
  /** Model's self-reported confidence 0..1. Below 0.5 → render with
   *  a warning chip; below 0.3 → demoted to unverifiedClaims. */
  confidence: number;
}

export interface UnverifiedClaim {
  key: string;
  /** Why we couldn't verify (e.g. "no source surfaced", "model confidence below 0.3"). */
  reason: string;
}

/** Verifier's output for a trend. */
export interface VerificationResult {
  trendId: string;
  brandId: string;
  signal: RawSignal;
  scoreResult: ScoreResult;
  /** Citation-backed claims — ready for the Creative Agent. */
  claims: VerifiedClaim[];
  /** Claims the model couldn't verify — drafts must NOT use these. */
  unverifiedClaims: UnverifiedClaim[];
  /** Summary string for the research panel. ≤500 chars. */
  summary: string;
  /** Provider + model + tier for telemetry. */
  provider: string;
  model: string;
  tier: 'premium' | 'balanced';
  /** Wall-clock when the verification completed. */
  verifiedAt: Date;
}

/** Adapter contract — pluggable so Phase 6 can ship with a stubbed
 *  implementation while the real LLM/RAG pipeline lands incrementally. */
export interface VerifierAdapter {
  verify(input: {
    signal: RawSignal;
    brandId: string;
    keysToExtract?: string[];
  }): Promise<{
    summary: string;
    claims: VerifiedClaim[];
    unverifiedClaims: UnverifiedClaim[];
    provider: string;
    model: string;
    tier: 'premium' | 'balanced';
  }>;
}
