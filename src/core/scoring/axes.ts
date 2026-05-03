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
  const vNorm = Math.tanh(s.velocity / 500);
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
// Saturation — high reach + cooling velocity = saturated. Late entrants
// to saturated trends get diminishing returns. Sigmoid penalty in the
// composite (see engine.ts) so 0.6+ punishes hard.

export function computeSaturation(s: RawSignal, r: ScoreRationale[]): number {
  const reachFactor = Math.tanh(s.reach / 10_000_000);
  const velocityCool = s.velocity < 50 ? 0.5 : 0;
  const v = clamp01(0.4 * reachFactor + velocityCool);
  pushRationale(r, 'saturation', v, [
    `reach factor ${pct(reachFactor)}`,
    velocityCool ? 'velocity cooling — late entrants saturate fast' : 'velocity still hot',
  ]);
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
