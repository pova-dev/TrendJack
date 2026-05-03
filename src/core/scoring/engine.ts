// TrendJack scoring engine — composition root.
//
// Design principles:
//   1. Every score is in [0, 1] except `opportunity` which is 0..100 for UI.
//   2. Negative weights apply to risk/cringe/saturation/format-fatigue/effort.
//   3. Saturation uses a sigmoid penalty so 0..0.6 is barely punished but
//      anything past 0.6 punishes hard. Real-world: half-saturated is still
//      winnable, fully-saturated is not.
//   4. "Hard kills" override the math: banned-topic hit, competitor-claimed,
//      cringeScore > 0.7, risk > 0.7. These force IGNORE regardless of upside.
//   5. Brand crisis mode floors recommendation to MONITOR globally.
//   6. Every axis carries plain-English reasons so the UI can explain itself.
//   7. `jackingScore` (V × R / D) is computed alongside `opportunity` and
//      drives content-gen triggers — not the dashboard ranker.
//
// This file is intentionally thin. Each axis lives in its own module so
// changes are local and testable.

import { DEFAULT_WEIGHTS } from '@/types';
import type { ScoreRationale, Scores } from '@/types';
import type { RawSignal, ScoreResult, ScoringContext } from './types';
import { clamp01, pct, pushRationale, round, sigmoid01 } from './helpers';
import { computeTopicalFitDetailed } from './topical-fit';
import { computeTonalFit, computeAudienceOverlap } from './tonal-fit';
import { computeRisk } from './risk';
import { computeCringe } from './cringe';
import {
  computeVirality,
  computeTiming,
  computeFirstMover,
  computeSaturation,
  estimateAssetEffort,
  estimateApprovalEffort,
  estimateProductionEffort,
  predictPeakWindowEnd,
} from './axes';
import { decide } from './decide';
import { computeJackingScore } from './jacking-score';

export type { RawSignal, ScoreResult, ScoringContext };
export { predictPeakWindowEnd };

export function score(signal: RawSignal, ctx: ScoringContext): ScoreResult {
  const weights = ctx.weights ?? ctx.brand.scoringWeights ?? DEFAULT_WEIGHTS;
  const rationale: ScoreRationale[] = [];

  // --- Brand-fit composite (50% topical + 30% tonal + 20% audience) -------
  const virality = computeVirality(signal, rationale);
  const topicalFitResult = computeTopicalFitDetailed(signal, ctx.brand, rationale);
  const topicalFit = topicalFitResult.value;
  const tonalFit = computeTonalFit(signal, ctx.brand, rationale);
  const audienceOverlap = computeAudienceOverlap(signal, ctx.brand, rationale);
  const brandFit = round(0.5 * topicalFit + 0.3 * tonalFit + 0.2 * audienceOverlap);
  pushRationale(rationale, 'brandFit', brandFit, [
    `topicalFit=${pct(topicalFit)} weighted 0.5`,
    `tonalFit=${pct(tonalFit)} weighted 0.3`,
    `audienceOverlap=${pct(audienceOverlap)} weighted 0.2`,
  ]);

  // --- Timing, firstMover, saturation, risk, cringe, formatFatigue --------
  const peakWindowEnd = predictPeakWindowEnd(signal);
  const timing = computeTiming(signal, peakWindowEnd, rationale);
  const firstMover = computeFirstMover(ctx.brandPostCountForTrend ?? 0, rationale);
  const saturation = computeSaturation(signal, rationale);
  const risk = computeRisk(signal, ctx.brand, rationale);
  const cringe = computeCringe(signal, ctx.brand, rationale);
  const formatFatigue = clamp01(signal.formatFatigue);
  pushRationale(rationale, 'formatFatigue', formatFatigue, [
    formatFatigue > 0.7
      ? 'Format/template heavily reused in last 24h — originality risk.'
      : 'Format usage within healthy band.',
  ]);

  // --- Effort (asset + approval + production) -----------------------------
  const assetEffort = estimateAssetEffort(signal, rationale);
  const approvalEffort = estimateApprovalEffort(ctx.brand, rationale);
  const productionEffort = estimateProductionEffort(signal, rationale);
  const effort = round(
    0.4 * assetEffort + 0.3 * approvalEffort + 0.3 * productionEffort,
  );
  pushRationale(rationale, 'effort', effort, [
    `asset=${pct(assetEffort)} · approval=${pct(approvalEffort)} · production=${pct(productionEffort)}`,
  ]);

  // --- Composite opportunity (additive, drives dashboard ranking) ---------
  // Sigmoid-penalize saturation past 0.6 so half-saturated is fine,
  // fully-saturated is not.
  const saturationPenalty = sigmoid01(saturation, 0.6, 12);
  const raw =
    weights.virality * virality +
    weights.brandFit * brandFit +
    weights.timing * timing +
    weights.firstMover * firstMover -
    weights.saturation * saturationPenalty -
    weights.risk * risk -
    weights.cringe * cringe -
    weights.formatFatigue * formatFatigue -
    weights.effort * effort;
  const opportunity = Math.round(clamp01(raw) * 100);

  // --- CVS / Jacking Score / S_max (canonical signal strength) -----------
  // CVS = (FIT × VEL_eff × FM × Sp) / max(0.05, RISK + CRINGE + SAT_eff)
  // VEL_eff uses ctx.reproductionRate when provided (Filter Agent computes
  // it from TrendSample time-series); falls back to virality otherwise.
  // Sp uses ctx.crossSourceCount; SAT_eff uses ctx.hoursSinceCompetitorClaim.
  // All three default to no-op when omitted, so behavior stays stable for
  // legacy callers that don't compute them.
  const jackingScore = computeJackingScore({
    fit: brandFit,
    velocity: virality,
    firstMover,
    risk,
    cringe,
    saturation,
    reproductionRate: ctx.reproductionRate,
    crossSourceCount: ctx.crossSourceCount,
    hoursSinceCompetitorClaim: ctx.hoursSinceCompetitorClaim,
  });

  const scores: Scores = {
    virality, topicalFit, tonalFit, audienceOverlap, brandFit,
    timing, firstMover, saturation, risk, cringe, formatFatigue,
    assetEffort, approvalEffort, productionEffort, effort,
    opportunity,
  };

  const { recommendation, recommendationReason } = decide(
    scores,
    signal,
    ctx.brand,
  );

  return {
    scores, rationale, recommendation, recommendationReason, peakWindowEnd,
    brandKeywordHit: topicalFitResult.brandKeywordHit,
    matchedBrandKeywords: topicalFitResult.matchedBrandKeywords,
    jackingScore,
  };
}
