// Core types for the scoring layer. Re-exported through src/core/scoring/index.ts
// so callers can import everything from one place. We intentionally re-export
// some types from @/types instead of redefining them — those types are shared
// with the Prisma layer and the UI, and we don't want two sources of truth.

import type {
  BrandProfile,
  Recommendation,
  Scores,
  ScoreRationale,
  Trend,
  ScoringWeights,
} from '@/types';

export type { BrandProfile, Recommendation, Scores, ScoreRationale, Trend, ScoringWeights };

/**
 * Normalized signal coming out of any Scout connector.
 * The scoring engine is the single consumer of this shape.
 */
export interface RawSignal {
  source: Trend['source'];
  title: string;
  summary: string;
  hashtags: string[];
  /** representative post body for tonal/topical analysis */
  text?: string;
  lineage: string;
  catalyst?: string;
  firstSeenAt: Date;
  /** posts per hour or % delta */
  velocity: number;
  reach: number;
  /** -1..1 */
  sentiment: number;
  competitorClaimants: string[];
  /** 0..1; how exhausted is the format/template */
  formatFatigue: number;
  examples?: Trend['examples'];
  /** canonical original post / article URL */
  url?: string;
  /** dedupe key from the source platform */
  externalId?: string;
}

/**
 * Inputs to a single scoring run. The brand profile drives every keyword
 * vocab; weights override the brand's stored ScoringWeights when the caller
 * wants to A/B different decision rules.
 */
export interface ScoringContext {
  brand: BrandProfile;
  weights?: ScoringWeights;
  /** how many times brand has already posted on this thread */
  brandPostCountForTrend?: number;
}

/**
 * Detailed result from topical-fit. Returned separately from the scalar
 * `topicalFit` because the brandKeywordHit flag is consumed by ingest +
 * the Brand Matches column filter.
 */
export interface TopicalFitResult {
  value: number;
  brandKeywordHit: boolean;
  matchedBrandKeywords: string[];
}

/**
 * Full scoring output. Includes the score axes, plain-English rationale,
 * the recommendation + reason, and the predicted peak window for timing
 * decisions.
 */
export interface ScoreResult {
  scores: Scores;
  rationale: ScoreRationale[];
  recommendation: Recommendation;
  recommendationReason: string;
  peakWindowEnd: Date;
  brandKeywordHit: boolean;
  matchedBrandKeywords: string[];
  /**
   * Multiplicative trigger score: JS = (V × R) / D, clamped to [0, 1].
   * Used as the Creative Agent's go/no-go gate — separate from the additive
   * `opportunity` which drives dashboard ranking.
   */
  jackingScore: number;
}
