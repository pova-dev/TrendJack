// The smaller scoring axes — virality, timing, firstMover, saturation, and
// the three effort estimators. Kept together because they're each <20 lines
// and don't earn their own modules. If any of them grows, split it out.

import type { BrandProfile, RawSignal, ScoreRationale } from './types';
import { clamp01, formatBig, pct, pushRationale, round } from './helpers';

// ---------------------------------------------------------------------------
// Virality — blends velocity (per-hour delta) and reach (cumulative).
// Velocity dominates (70%) because real trend-jacking value is in the rising
// edge, not the cumulative footprint.

export function computeVirality(s: RawSignal, r: ScoreRationale[]): number {
  // Calibration:
  //   velocity normalization at 100 posts/hour (was 500). The 500 constant
  //   was tuned for X-firehose scale, but real RSS/Reddit/HN ingest tops
  //   out around 50-200/hr; with the old constant, every non-firehose
  //   trend produced virality<0.05, collapsing CVS's multiplicative
  //   numerator to zero. New scale:
  //     vel=10  → vNorm=0.10
  //     vel=50  → vNorm=0.46
  //     vel=100 → vNorm=0.76
  //     vel=300 → vNorm=0.99
  //   reach kept at 5M — that's a real-world threshold for "viral-scale"
  //   audience and works across all source types.
  const vNorm = Math.tanh(s.velocity / 100);
  const rNorm = Math.tanh(s.reach / 5_000_000);
  const v = clamp01(0.7 * vNorm + 0.3 * rNorm);
  pushRationale(r, 'virality', v, [
    `velocity ≈ ${Math.round(s.velocity)}/h → ${pct(vNorm)}`,
    `reach ≈ ${formatBig(s.reach)} → ${pct(rNorm)}`,
  ]);
  return round(v);
}

// ---------------------------------------------------------------------------
// Timing — bell curve over the trend's life-cycle. Best post window is
// 0.15..0.4 of the predicted peak life. Pre-peak (too early, no audience)
// and past-peak (saturated, no upside) both score low.

export function computeTiming(s: RawSignal, peakEnd: Date, r: ScoreRationale[]): number {
  const now = Date.now();
  const peakMs = peakEnd.getTime();
  const ageMs = now - s.firstSeenAt.getTime();
  const totalLifeMs = Math.max(peakMs - s.firstSeenAt.getTime(), 60 * 60 * 1000);
  const ratio = ageMs / totalLifeMs;
  const v = clamp01(Math.exp(-Math.pow((ratio - 0.27) / 0.22, 2)));
  pushRationale(r, 'timing', v, [
    `age ratio ${pct(ratio)} of estimated peak life`,
    v > 0.7 ? 'inside the optimal post window' : v > 0.4 ? 'late but viable' : 'too early or past peak',
  ]);
  return round(v);
}

// ---------------------------------------------------------------------------
// First-mover — discrete bonus if brand hasn't already posted on this trend.

export function computeFirstMover(brandPostCount: number, r: ScoreRationale[]): number {
  const v = brandPostCount === 0 ? 1 : brandPostCount === 1 ? 0.6 : 0;
  pushRationale(r, 'firstMover', v, [
    `brand has posted ${brandPostCount} time(s) on this trend`,
  ]);
  return v;
}

// ---------------------------------------------------------------------------
// Saturation — three contributing factors:
//   1. Reach factor: trend has accumulated cumulative audience.
//   2. Velocity cooling: trend HAD volume but is now dying. Critically,
//      this only applies when reach is high enough that the trend was
//      ever genuinely "hot" — a Reddit post with 1 upvote and 100 reach
//      hasn't "cooled", it's just noise. The previous formula treated
//      every low-velocity signal as saturated, producing SAT=0.5 baseline
//      for almost every trend and dragging CVS to near-zero.
//   3. Competitor share-of-voice: when ≥40% of the trend's siblings
//      mention competitors (per the audit spec's "Already Claimed →
//      Dilutive" rule), we add SoV-derived drag. This is the linkage
//      from the Lineage Agent the audit flagged as missing.
//
// Sigmoid penalty in the composite (see engine.ts) so 0.6+ punishes hard.

const REACH_FLOOR_FOR_COOLING = 10_000;

export function computeSaturation(
  s: RawSignal,
  r: ScoreRationale[],
  /** Optional: 0..1 share-of-voice held by competitors in this trend's
   *  cross-source lineage. Filter Agent computes this via the Lineage
   *  Agent's buildLineageLookup() and passes it through ScoringContext. */
  competitorShareOfVoice?: number,
): number {
  const reachFactor = Math.tanh(s.reach / 10_000_000);
  const hadVolume = s.reach >= REACH_FLOOR_FOR_COOLING;
  const velocityCool = (hadVolume && s.velocity < 50) ? 0.5 : 0;

  // SoV linkage. Above the 40% dilutive threshold, add a graduated
  // contribution that tops out at +0.30. This is the wiring the Phase 6.5
  // Lineage Agent was built for.
  let sovContribution = 0;
  if (competitorShareOfVoice && competitorShareOfVoice >= 0.40) {
    // Linear ramp: 0.40 → 0, 0.70 → 0.18, 1.00 → 0.30
    sovContribution = Math.min(0.30, (competitorShareOfVoice - 0.40) * 0.50);
  }

  const v = clamp01(0.4 * reachFactor + velocityCool + sovContribution);
  const reasons: string[] = [`reach factor ${pct(reachFactor)}`];
  if (velocityCool) reasons.push('velocity cooling on a high-reach trend — late entrants saturate fast');
  else if (!hadVolume) reasons.push('low velocity but never had volume — not saturation');
  else reasons.push('velocity still hot');
  if (sovContribution > 0) {
    reasons.push(`competitor SoV ${pct(competitorShareOfVoice!)} — dilutive territory (+${pct(sovContribution)} drag)`);
  }
  pushRationale(r, 'saturation', v, reasons);
  return round(v);
}

// ---------------------------------------------------------------------------
// Effort estimators — each in [0, 1] where 1 = expensive.
// Composite effort = 0.4*asset + 0.3*approval + 0.3*production.

export function estimateAssetEffort(s: RawSignal, r: ScoreRationale[]): number {
  // Heuristic: video-native trends require more effort than text-native.
  const isVideoNative = s.source === 'tiktok' || s.source === 'youtube';
  const v = isVideoNative ? 0.7 : 0.3;
  pushRationale(r, 'assetEffort', v, [
    isVideoNative ? 'video-native source — needs shooting/editing' : 'text/image source — fast turnaround',
  ]);
  return v;
}

export function estimateApprovalEffort(b: BrandProfile, r: ScoreRationale[]): number {
  const v = { strict: 0.85, moderate: 0.5, fast: 0.2 }[b.approvalMode] ?? 0.5;
  pushRationale(r, 'approvalEffort', v, [`approval mode = ${b.approvalMode}`]);
  return v;
}

export function estimateProductionEffort(s: RawSignal, r: ScoreRationale[]): number {
  const isVideoNative = s.source === 'tiktok' || s.source === 'youtube';
  const v = isVideoNative ? 0.6 : 0.25;
  pushRationale(r, 'productionEffort', v, [
    isVideoNative ? 'video production overhead' : 'low production cost',
  ]);
  return v;
}

// ---------------------------------------------------------------------------
// Peak-window predictor. Source-specific half-life model based on observed
// engagement decay. Conservative (skews long) so trends don't disappear from
// the dashboard before an operator can see them.

export function predictPeakWindowEnd(s: RawSignal): Date {
  const halfLifeHours: Record<typeof s.source, number> = {
    x: 6,
    reddit: 18,
    youtube: 36,
    tiktok: 24,
    instagram: 24,
    facebook: 24,
    google_trends: 72,
    news: 24,           // bumped from 8h — articles still rank for 24-48h
    custom: 18,
  };
  const hours = halfLifeHours[s.source] ?? 18;
  return new Date(s.firstSeenAt.getTime() + hours * 60 * 60 * 1000);
}
