// CVS / S_max / Jacking Score — locked-in formula tests.
//
//                  FIT × VEL_eff × FM × Sp
//   CVS = clamp01( ──────────────────────────────────── )
//                  max(0.05, RISK + CRINGE + SAT_eff)
//
// Coverage:
//   * Numerator AND-gate (any zero → 0)
//   * Denominator additive drag + 0.05 floor
//   * R-with-fallback semantics
//   * Sp multiplier table
//   * SAT_eff time decay
//   * Threshold gates (shouldGenerateContent, shouldAutoVerify)

import { describe, expect, it } from 'vitest';
import {
  computeJackingScore,
  computeSignalStrength,
  computeCVS,
  shouldGenerateContent,
  shouldAutoVerify,
  spilloverMultiplier,
  normalizeReproductionRate,
  effectiveSaturation,
  DEFAULT_JACKING_THRESHOLD,
  AUTO_VERIFY_THRESHOLD,
} from '@/src/core/scoring/jacking-score';

describe('CVS / Jacking Score — core formula', () => {
  it('returns 1.0 for clean trend at maximum upside', () => {
    const cvs = computeJackingScore({
      fit: 1.0, velocity: 1.0, firstMover: 1.0,
      risk: 0, cringe: 0, saturation: 0,
    });
    expect(cvs).toBe(1.0);
  });

  it('AND-gate: zero FIT → 0', () => {
    expect(computeJackingScore({
      fit: 0, velocity: 1.0, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('AND-gate: zero velocity → 0', () => {
    expect(computeJackingScore({
      fit: 1.0, velocity: 0, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('AND-gate: zero FM → 0', () => {
    expect(computeJackingScore({
      fit: 1.0, velocity: 1.0, firstMover: 0, risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('drag is additive: more axes drag harder', () => {
    const onePoint = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.6, cringe: 0, saturation: 0,
    });
    const threePoints = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.2, cringe: 0.2, saturation: 0.2,
    });
    // Same total drag (0.6), but spread across 3 axes. Output should be the
    // same — additive drag treats them equally.
    expect(threePoints).toBeCloseTo(onePoint, 2);
  });

  it('clean trend (drag=0) does not div-by-zero — clamps to 1.0', () => {
    const cvs = computeJackingScore({
      fit: 0.6, velocity: 0.6, firstMover: 1.0,
      risk: 0, cringe: 0, saturation: 0,
    });
    // numerator = 0.36, denominator floor = 0.05 → 7.2 → clamps to 1.0
    expect(cvs).toBe(1.0);
  });

  it('clamps inputs and outputs to [0, 1]', () => {
    const overshoot = computeJackingScore({
      fit: 5, velocity: 5, firstMover: 5, risk: -1, cringe: -1, saturation: -1,
    });
    expect(overshoot).toBeLessThanOrEqual(1.0);
    expect(overshoot).toBeGreaterThanOrEqual(0);
  });

  it('first-mover boost: fresh trend > posted-once > burned', () => {
    const fresh  = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 1.0, risk: 0.2, cringe: 0.2, saturation: 0.2 });
    const repost = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 0.6, risk: 0.2, cringe: 0.2, saturation: 0.2 });
    const burned = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 0.0, risk: 0.2, cringe: 0.2, saturation: 0.2 });
    expect(fresh).toBeGreaterThan(repost);
    expect(repost).toBeGreaterThan(burned);
    expect(burned).toBe(0);
  });

  it('saturation surge drags CVS down (claimed-by-competitor scenario)', () => {
    const clean   = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.1 });
    const claimed = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.9 });
    expect(clean).toBeGreaterThan(claimed);
  });

  it('all three names point to the same function', () => {
    const inp = { fit: 0.5, velocity: 0.5, firstMover: 0.5, risk: 0.3, cringe: 0.2, saturation: 0.1 };
    expect(computeJackingScore(inp)).toBe(computeSignalStrength(inp));
    expect(computeJackingScore(inp)).toBe(computeCVS(inp));
  });
});

describe('CVS — Phase-4 inputs (R, Sp, SAT_eff)', () => {
  it('reproductionRate replaces velocity when provided', () => {
    // R=2.0 → R_normalized = 1.0 (max growth signal).
    const withR = computeJackingScore({
      fit: 0.7, velocity: 0.3, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
      reproductionRate: 2.0,
    });
    // velocity=0.3 ignored, R=2 used → numerator = 0.7 × 1.0 × 1.0 = 0.7
    // denom = 0.3, ratio = 2.33 → clamps to 1.0
    expect(withR).toBe(1.0);

    // R<1 → fizzling out → R_normalized < 0.5 → low CVS
    const fizzling = computeJackingScore({
      fit: 0.7, velocity: 0.9, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
      reproductionRate: 0.5,
    });
    // velocity=0.9 ignored, R=0.5 used → R_norm = 0.25 → numerator = 0.175
    // denom = 0.3, ratio = 0.58
    expect(fizzling).toBeLessThan(withR);
    expect(fizzling).toBeCloseTo(0.58, 1);
  });

  it('falls back to velocity when R is undefined', () => {
    const cvs = computeJackingScore({
      fit: 0.7, velocity: 0.5, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
      // reproductionRate omitted
    });
    // numerator = 0.7 × 0.5 × 1.0 = 0.35, denom = 0.3, ratio = 1.17 → 1.0
    expect(cvs).toBe(1.0);
  });

  it('Sp multiplier boosts cross-platform trends', () => {
    const onePlatform = computeJackingScore({
      fit: 0.4, velocity: 0.4, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
      crossSourceCount: 1,
    });
    const fourPlatforms = computeJackingScore({
      fit: 0.4, velocity: 0.4, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
      crossSourceCount: 4,
    });
    expect(fourPlatforms).toBeGreaterThan(onePlatform);
    // Sp jump from 1.0 to 1.5 → 50% boost on numerator
    expect(fourPlatforms / onePlatform).toBeCloseTo(1.5, 1);
  });

  it('SAT_eff grows over time when competitor has claimed', () => {
    const justClaimed = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.4,
      hoursSinceCompetitorClaim: 0,
    });
    const oldClaim = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.4,
      hoursSinceCompetitorClaim: 12,  // 12h: SAT_eff = 0.4 × (1 + 1.2) = 0.88
    });
    // SAT inflated → denominator larger → CVS lower
    expect(oldClaim).toBeLessThan(justClaimed);
  });
});

describe('Pure helpers', () => {
  it('spilloverMultiplier: 1→1.0, 2→1.15, 3→1.30, 4+→1.50', () => {
    expect(spilloverMultiplier(0)).toBe(1.0);
    expect(spilloverMultiplier(1)).toBe(1.0);
    expect(spilloverMultiplier(2)).toBe(1.15);
    expect(spilloverMultiplier(3)).toBe(1.30);
    expect(spilloverMultiplier(4)).toBe(1.50);
    expect(spilloverMultiplier(7)).toBe(1.50); // capped
  });

  it('normalizeReproductionRate: R/2 clamped', () => {
    expect(normalizeReproductionRate(0)).toBe(0);
    expect(normalizeReproductionRate(1)).toBe(0.5);
    expect(normalizeReproductionRate(2)).toBe(1.0);
    expect(normalizeReproductionRate(5)).toBe(1.0); // clamped
  });

  it('effectiveSaturation: linear growth over time, capped at 1.0', () => {
    expect(effectiveSaturation(0.4, 0)).toBeCloseTo(0.4);
    expect(effectiveSaturation(0.4, 5)).toBeCloseTo(0.6);    // 0.4 × 1.5
    expect(effectiveSaturation(0.4, 15)).toBe(1.0);          // capped
    expect(effectiveSaturation(0.5, -10)).toBe(0.5);         // negative t = no inflation
  });
});

describe('Triggers', () => {
  it('shouldGenerateContent fires above the default threshold (0.35)', () => {
    expect(shouldGenerateContent(0.50)).toBe(true);
    expect(shouldGenerateContent(DEFAULT_JACKING_THRESHOLD)).toBe(true);
    expect(shouldGenerateContent(0.10)).toBe(false);
    expect(shouldGenerateContent(0.34)).toBe(false);
  });

  it('shouldAutoVerify fires above the AUTO_VERIFY_THRESHOLD (0.70)', () => {
    expect(shouldAutoVerify(0.75)).toBe(true);
    expect(shouldAutoVerify(AUTO_VERIFY_THRESHOLD)).toBe(true);
    expect(shouldAutoVerify(0.50)).toBe(false);
    expect(shouldAutoVerify(0.69)).toBe(false);
  });

  it('respects per-brand override thresholds', () => {
    expect(shouldGenerateContent(0.20, 0.10)).toBe(true);
    expect(shouldAutoVerify(0.50, 0.40)).toBe(true);
  });
});
