// CVS — Contextual Virality Score (a.k.a. Jacking Score, S_max).
// The single canonical "should-we-act" signal.
//
// FORMULA (locked):
//
//                    FIT × VEL_eff × FM × Sp
//     CVS = clamp01( ──────────────────────────────────── )
//                    max(0.05, RISK + CRINGE + SAT_eff)
//
// where:
//   FIT     ∈ [0,1]   brand-fit composite (from scores.brandFit)
//   VEL_eff ∈ [0,1]   reproduction-rate-normalized growth signal:
//                     - if R is available (≥2 TrendSamples), use R_normalized
//                     - otherwise fall back to virality
//   FM      ∈ [0,1]   first-mover bonus (1.0=fresh, 0.6=posted once, 0=burned)
//   Sp      ∈ [1.0,1.5]   cross-platform spillover MULTIPLIER (not an axis):
//                          1 src=1.0, 2=1.15, 3=1.30, 4+=1.50
//   RISK    ∈ [0,1]   from scores.risk
//   CRINGE  ∈ [0,1]   from scores.cringe
//   SAT_eff ∈ [0,1]   saturation × (1 + 0.1·hoursSinceCompetitorClaim), capped
//
// REASONING:
//   * Multiplicative numerator → AND-gate. Low FIT *or* low velocity *or*
//     FM=0 *or* no platforms reachable → trigger blocks. Each axis is a
//     hurdle to clear. That's the "should we burn LLM dollars?" question.
//   * Additive denominator → cumulative drag. Three modest concerns
//     (0.3 each) add up correctly. Multiplicative drag breaks at zero.
//   * Floor 0.05 prevents div-by-zero blowup; output is clamped anyway.
//   * Sp is a bonus multiplier (≥1.0), not a gate — single-platform
//     trends shouldn't be penalized; multi-platform should be boosted.
//   * R-with-fallback: R₀ is more predictive than VEL but requires
//     time-series data. Until we have ≥2 samples for a trend, VEL is
//     the best we've got.
//
// This module is pure: no I/O, no async, no globals. Trivial to unit-test.

import { clamp01, round } from './helpers';

export interface SignalStrengthInput {
  /** FIT — brand-fit composite (0..1). From scores.brandFit. */
  fit: number;
  /** VEL — velocity / virality (0..1). From scores.virality. */
  velocity: number;
  /** FM — first-mover bonus (0..1). From scores.firstMover. */
  firstMover: number;
  /** RISK — risk vocab + sentiment score (0..1). From scores.risk. */
  risk: number;
  /** CRINGE — cringe markers score (0..1). From scores.cringe. */
  cringe: number;
  /** SAT — saturation score (0..1). From scores.saturation. */
  saturation: number;

  // ----- optional Phase-4 inputs (graceful fallback to defaults) ----------

  /** Reproduction rate (R₀,ᵢ) computed from TrendSample time series, if
   *  available. R > 1 → fast-growing; R < 1 → fizzling. Pass undefined to
   *  fall back to plain `velocity`. */
  reproductionRate?: number;

  /** Number of distinct sources this trend was detected on simultaneously.
   *  Default 1 (no spillover bonus). Phase 4 wires this from cross-source
   *  dedup. */
  crossSourceCount?: number;

  /** Hours since a competitor first claimed this trend's narrative. Default 0
   *  (no time-decay). Phase 6.5 wires this from the Lineage agent. */
  hoursSinceCompetitorClaim?: number;
}

/** Minimum denominator. Prevents div-by-zero on clean trends; output is
 *  clamped to [0,1] anyway, so this only matters for the upper bound. */
const DRAG_FLOOR = 0.05;

/** Sp lookup. 1 source baseline, +0.15 per additional source up to +0.50 cap. */
function spilloverMultiplier(crossSourceCount: number): number {
  if (crossSourceCount <= 1) return 1.0;
  if (crossSourceCount === 2) return 1.15;
  if (crossSourceCount === 3) return 1.30;
  return 1.50;
}

/** R₀ → effective velocity. R=1 → 0.50, R=2 → 1.00, R=0.5 → 0.25. */
function normalizeReproductionRate(R: number): number {
  return clamp01(R / 2);
}

/** SAT_eff with linear time-decay. At t=0 → SAT (no inflation). */
function effectiveSaturation(saturation: number, hoursSinceClaim: number): number {
  if (hoursSinceClaim <= 0) return clamp01(saturation);
  return clamp01(saturation * (1 + 0.1 * hoursSinceClaim));
}

/**
 * Compute Contextual Virality Score (CVS / S_max / Jacking Score). All names
 * point to the same canonical formula.
 *
 * Today's behavior with Phase-4 inputs unset reduces to:
 *   (FIT × VEL × FM) / max(0.05, RISK + CRINGE + SAT)
 * which is the simpler S_max we shipped earlier this session.
 */
export function computeJackingScore(input: SignalStrengthInput): number {
  const fit = clamp01(input.fit);
  const fm  = clamp01(input.firstMover);
  const risk    = clamp01(input.risk);
  const cringe  = clamp01(input.cringe);
  const sat     = clamp01(input.saturation);

  // VEL_eff: prefer R when available, fall back to plain velocity.
  const velEff = input.reproductionRate !== undefined
    ? normalizeReproductionRate(input.reproductionRate)
    : clamp01(input.velocity);

  // Sp: cross-platform bonus multiplier, defaults to 1.0 (no boost).
  const sp = spilloverMultiplier(input.crossSourceCount ?? 1);

  // SAT_eff: time-decayed saturation. Default hoursSinceClaim=0 → SAT_eff=SAT.
  const satEff = effectiveSaturation(sat, input.hoursSinceCompetitorClaim ?? 0);

  const numerator   = fit * velEff * fm * sp;
  const denominator = Math.max(DRAG_FLOOR, risk + cringe + satEff);
  return round(clamp01(numerator / denominator));
}

// Aliases for callers who use either name.
export const computeSignalStrength = computeJackingScore;
export const computeCVS            = computeJackingScore;
export type JackingScoreInput      = SignalStrengthInput;

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Default trigger threshold for the Creative Agent (content generation).
 *
 * Calibration with the locked formula:
 *   - 0.20 — permissive: any modest fit/velocity with clean drag
 *   - 0.35 — DEFAULT: e.g. fit=0.6, vel=0.6, fm=1.0, drag=0.3 → CVS=1.0 → fires
 *                    or fit=0.4, vel=0.4, fm=0.6, drag=0.5 → CVS=0.19 → blocks
 *   - 0.85 — strict: only flagship brand-keyword trends with low drag
 */
export const DEFAULT_JACKING_THRESHOLD = 0.35;

/**
 * Threshold above which the Filter Agent auto-fires the Verifier Agent
 * (proactive research). Per spec: "auto-research at CVS > 0.70".
 */
export const AUTO_VERIFY_THRESHOLD = 0.70;

/** Fire the Creative Agent? */
export function shouldGenerateContent(
  jackingScore: number,
  threshold: number = DEFAULT_JACKING_THRESHOLD,
): boolean {
  return jackingScore >= threshold;
}

/** Auto-fire the Verifier Agent? */
export function shouldAutoVerify(
  jackingScore: number,
  threshold: number = AUTO_VERIFY_THRESHOLD,
): boolean {
  return jackingScore >= threshold;
}

// ---------------------------------------------------------------------------
// Pure helpers exported for tests + Phase-4 callers
// ---------------------------------------------------------------------------

export {
  spilloverMultiplier,
  normalizeReproductionRate,
  effectiveSaturation,
};
