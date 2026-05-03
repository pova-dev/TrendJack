// Recommendation decision rule. Translates the numerical scores into one
// of: POST_NOW, PREP_1H, MONITOR, IGNORE, ESCALATE.
//
// Decision order matters:
//   1. Hard kills (competitor doubled, cringe>0.7, risk>0.7, banned topic, crisis mode)
//   2. Brand-fit floor (25%) and tonal-fit floor (25%)
//   3. Opportunity-driven recommendation
//
// The opportunity thresholds (75 / 55 / 25) are tuned for the additive
// composite formula in engine.ts; they should be re-tuned if the weights
// change significantly.

import type { BrandProfile, RawSignal, Recommendation, Scores } from './types';
import { pct } from './helpers';

export function decide(
  scores: Scores,
  s: RawSignal,
  b: BrandProfile,
): { recommendation: Recommendation; recommendationReason: string } {
  // ---------------------------------------------------------------------
  // Hard kills first.
  // ---------------------------------------------------------------------
  if (s.competitorClaimants.length >= 2) {
    return {
      recommendation: 'IGNORE',
      recommendationReason: `Already claimed by ${s.competitorClaimants.slice(0, 2).join(', ')}. Doubling-down would be dilutive.`,
    };
  }
  if (scores.cringe > 0.7) {
    return {
      recommendation: 'IGNORE',
      recommendationReason: `Cringe risk ${pct(scores.cringe)} above safety threshold for the brand voice.`,
    };
  }
  if (scores.risk > 0.7) {
    return {
      recommendation: 'ESCALATE',
      recommendationReason: `Risk ${pct(scores.risk)} too high for autonomous action. Send to brand/legal for review.`,
    };
  }
  if (scores.topicalFit === 0) {
    return {
      recommendation: 'IGNORE',
      recommendationReason: `Banned topic detected — outside brand-safe territory.`,
    };
  }
  if (b.crisisMode) {
    return {
      recommendation: 'MONITOR',
      recommendationReason: `Brand crisis mode is ON. Reactive content paused globally.`,
    };
  }

  // ---------------------------------------------------------------------
  // Brand-fit floor 25% — anything below means no brand keyword, no
  // competitor mention, AND no soft-anchor + theme combination. That's
  // genuinely off-brand. Competitor-only trends (~45% brand-fit) and
  // soft-anchor + theme trends (~35%) survive into MONITOR/PREP, which
  // is the whole point of peripheral awareness. Tonal floor 25% blocks
  // brand-banned-phrase trends regardless of brand-fit.
  // ---------------------------------------------------------------------
  if (scores.brandFit < 0.25 || scores.tonalFit < 0.25) {
    return {
      recommendation: 'IGNORE',
      recommendationReason: `Brand-fit ${pct(scores.brandFit)} (tonal ${pct(scores.tonalFit)}) below the actionability floor. Not worth a slot.`,
    };
  }

  // ---------------------------------------------------------------------
  // Opportunity-driven recommendation.
  // ---------------------------------------------------------------------
  if (scores.opportunity >= 75 && scores.timing > 0.6) {
    return {
      recommendation: 'POST_NOW',
      recommendationReason: `Opportunity ${scores.opportunity} with strong timing — post window is open now.`,
    };
  }
  if (scores.opportunity >= 55) {
    return {
      recommendation: 'PREP_1H',
      recommendationReason: `Opportunity ${scores.opportunity}. Worth drafting now and shipping within the hour.`,
    };
  }
  // MONITOR threshold is opportunity ≥ 25 because the brand-fit floor already
  // gates "is this on-brand at all". Once a trend passes that floor (brand
  // keyword, competitor, or soft-anchor + theme), the operator wants to see
  // it on the board for peripheral awareness even if the composite opportunity
  // is modest. The board distinguishes MONITOR (passive watch) from PREP_1H /
  // POST_NOW (active draft).
  if (scores.opportunity >= 25) {
    return {
      recommendation: 'MONITOR',
      recommendationReason: `Opportunity ${scores.opportunity}. Watch for spike or angle change.`,
    };
  }
  return {
    recommendation: 'IGNORE',
    recommendationReason: `Opportunity ${scores.opportunity} too low to justify the slot.`,
  };
}
