// Jacking Score (S_max) — the canonical "should-we-act" signal.
//
// The product calls this metric "Jacking Score" in the UI; the underlying
// formula is what we call S_max (Signal Strength).
//
//     S_max = (FIT × VEL × FM) / (RISK + CRINGE + SAT)
//
// Numerator (the "go" signal):
//   FIT  — brand-fit composite (0..1)
//   VEL  — velocity / virality (0..1)
//   FM   — first-mover bonus (0..1; 1 if brand hasn't posted on this trend)
//
// Denominator (the "drag" signals):
//   RISK    — risk vocab score (0..1)
//   CRINGE  — cringe score (0..1)
//   SAT     — saturation, including competitor share-of-voice (0..1)
//
// Why multiplicative numerator / additive denominator:
//   - Multiplicative numerator is an AND-gate: low FIT *or* low VEL *or*
//     low FM kills the score regardless of the others. Cleaner trigger
//     than the additive composite (which is still computed separately as
//     `opportunity` for dashboard ranking).
//   - Additive denominator means cumulative drag — three modest concerns
//     (each 0.3) drag harder than one large concern (0.6) which is
//     correct: trends with multiple weaknesses are riskier than one strong
//     weakness on an otherwise clean trend.
//
// The denominator is floored at 0.05 to avoid divide-by-zero when a trend
// has no measurable drag. Output is clamped to [0, 1] because clean
// numerator + tiny denominator can produce values >1 mathematically.

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
  /** SAT — saturation incl. competitor share-of-voice (0..1). From scores.saturation. */
  saturation: number;
}

/** Minimum denominator to avoid div-by-zero on clean trends. */
const DRAG_FLOOR = 0.05;

/**
 * Compute Jacking Score (S_max). Single canonical signal-strength formula.
 *
 *     S_max = clamp01( (FIT × VEL × FM) / max(0.05, RISK + CRINGE + SAT) )
 */
export function computeJackingScore(input: SignalStrengthInput): number {
  const fit = clamp01(input.fit);
  const vel = clamp01(input.velocity);
  const fm  = clamp01(input.firstMover);
  const risk    = clamp01(input.risk);
  const cringe  = clamp01(input.cringe);
  const sat     = clamp01(input.saturation);

  const numerator   = fit * vel * fm;
  const denominator = Math.max(DRAG_FLOOR, risk + cringe + sat);
  return round(clamp01(numerator / denominator));
}

// Alias for callers who think of this as Signal Strength rather than Jacking Score.
export const computeSignalStrength = computeJackingScore;
export type JackingScoreInput = SignalStrengthInput;

/**
 * Default trigger threshold for the Creative Agent. Tunable per brand via
 * BrandProfile.jackingScoreThreshold (when wired in Phase 4).
 *
 * Calibration with the new formula:
 *   - 0.20 — permissive: any trend with modest fit/velocity/clean drag
 *   - 0.35 — DEFAULT: requires e.g. fit=0.6, vel=0.6, fm=1.0, drag=0.3 → S=0.36/0.3=1.0 → fires
 *                    or fit=0.5, vel=0.5, fm=0.6, drag=0.5 → S=0.15/0.5=0.30 → blocks
 *   - 0.70 — auto-research / proactive verification trigger (per user spec)
 *   - 0.85 — strict: only flagship brand-keyword trends with low drag
 */
export const DEFAULT_JACKING_THRESHOLD = 0.35;

/**
 * Threshold above which the Filter Agent auto-fires the Verifier Agent
 * (proactive research instead of waiting for a user click).
 */
export const AUTO_VERIFY_THRESHOLD = 0.70;

/**
 * Pure decision: should the Creative Agent fire on this trend?
 * The Filter Agent will use this; the dashboard uses `recommendation` instead.
 */
export function shouldGenerateContent(
  jackingScore: number,
  threshold: number = DEFAULT_JACKING_THRESHOLD,
): boolean {
  return jackingScore >= threshold;
}

/**
 * Pure decision: should the Verifier Agent auto-fire on this trend?
 * Used by Filter Agent to proactively research hot trends before the
 * operator opens the drawer.
 */
export function shouldAutoVerify(
  jackingScore: number,
  threshold: number = AUTO_VERIFY_THRESHOLD,
): boolean {
  return jackingScore >= threshold;
}
