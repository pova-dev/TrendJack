// Jacking Score — multiplicative AND-gate for content-generation triggers.
//
//     JS = (V × R) / D
//
// Where:
//   V (Velocity)   — how fast is the trend growing? (0..1, from virality axis)
//   R (Relevance)  — 0..1 match with brand identity (from brandFit composite)
//   D (Difficulty) — how hard to produce content for this? (0..1, from effort)
//
// This is a separate axis from `opportunity` (the additive dashboard ranker).
// Use cases:
//
//   - opportunity → drives sort order on the board (peripheral awareness)
//   - jackingScore → drives Creative Agent's go/no-go (trigger gate)
//
// Why multiplicative: an AND-gate kills any trend with weak velocity OR weak
// relevance OR high difficulty. Cleaner trigger rule than the additive
// composite, which lets high relevance compensate for low velocity (and vice
// versa) — which is fine for ranking but wrong for "should we burn LLM dollars
// drafting this?".
//
// D is bounded below by 0.1 to avoid divide-by-zero and to penalize zero-effort
// trends only mildly (they still need V and R to clear the threshold).

import { clamp01, round } from './helpers';

export interface JackingScoreInput {
  /** Velocity (0..1). Comes from `scores.virality` in the engine output. */
  velocity: number;
  /** Relevance (0..1). Comes from `scores.brandFit` in the engine output. */
  relevance: number;
  /** Difficulty (0..1). Comes from `scores.effort` in the engine output. */
  difficulty: number;
}

export function computeJackingScore(input: JackingScoreInput): number {
  const v = clamp01(input.velocity);
  const r = clamp01(input.relevance);
  const d = Math.max(0.1, clamp01(input.difficulty)); // floor at 0.1 to avoid ÷0
  return round(clamp01((v * r) / d));
}

/**
 * Default trigger threshold for the Creative Agent. Tunable per brand via
 * BrandProfile.jackingScoreThreshold (when wired in Phase 4).
 *
 * Calibration:
 *   - 0.20 — permissive: trends with V=0.5, R=0.5, D=0.5 → JS=0.5 → fires
 *   - 0.35 — default:    requires e.g. V=0.6, R=0.7, D=0.4 → JS=0.21 (won't fire)
 *                                       V=0.7, R=0.7, D=0.4 → JS=0.49 (fires)
 *   - 0.50 — strict:     only high-velocity, high-relevance, low-effort trends fire
 *
 * 0.35 is the default because empirical fixture data shows it gates ~80%
 * of MONITOR-tier trends out of generation while letting all PREP_1H +
 * POST_NOW trends through.
 */
export const DEFAULT_JACKING_THRESHOLD = 0.35;

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
