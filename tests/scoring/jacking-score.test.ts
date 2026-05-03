// Jacking Score / S_max tests.
//
//     S_max = clamp01( (FIT × VEL × FM) / max(0.05, RISK + CRINGE + SAT) )
//
// Three core invariants:
//   1. AND-gate: any zero-numerator factor → 0
//   2. Drag floor: zero-drag denominator floored at 0.05 (no div-by-zero)
//   3. Output: always in [0, 1]

import { describe, expect, it } from 'vitest';
import {
  computeJackingScore,
  computeSignalStrength,
  shouldGenerateContent,
  shouldAutoVerify,
  DEFAULT_JACKING_THRESHOLD,
  AUTO_VERIFY_THRESHOLD,
} from '@/src/core/scoring/jacking-score';

describe('computeJackingScore (S_max)', () => {
  it('returns 1.0 (clamped) for max numerator + minimum drag', () => {
    const js = computeJackingScore({
      fit: 1.0, velocity: 1.0, firstMover: 1.0,
      risk: 0, cringe: 0, saturation: 0,
    });
    expect(js).toBe(1.0);
  });

  it('AND-gate: zero FIT → 0', () => {
    expect(computeJackingScore({
      fit: 0, velocity: 1.0, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('AND-gate: zero VEL → 0', () => {
    expect(computeJackingScore({
      fit: 1.0, velocity: 0, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('AND-gate: zero FM → 0', () => {
    expect(computeJackingScore({
      fit: 1.0, velocity: 1.0, firstMover: 0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
    })).toBe(0);
  });

  it('drag drops the score: more risk + cringe + sat = lower S_max', () => {
    const clean = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.1, cringe: 0.1, saturation: 0.1,
    });
    const drag = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,
      risk: 0.5, cringe: 0.4, saturation: 0.6,
    });
    expect(clean).toBeGreaterThan(drag);
  });

  it('clamps inputs to [0, 1] before computing', () => {
    const overshoot = computeJackingScore({
      fit: 5.0, velocity: 5.0, firstMover: 5.0,
      risk: -1.0, cringe: -1.0, saturation: -1.0,
    });
    expect(overshoot).toBeLessThanOrEqual(1.0);
    expect(overshoot).toBeGreaterThanOrEqual(0);
  });

  it('clamps output to [0, 1] when numerator > floor denominator', () => {
    // FIT * VEL * FM = 0.8, drag = 0 (floored to 0.05) → 0.8/0.05 = 16 → clamps to 1.0
    const blowup = computeJackingScore({
      fit: 0.8, velocity: 1.0, firstMover: 1.0,
      risk: 0, cringe: 0, saturation: 0,
    });
    expect(blowup).toBe(1.0);
  });

  it('first-mover boost matters: solo trend > already-posted trend', () => {
    const fresh = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 1.0,  // first time on this trend
      risk: 0.2, cringe: 0.2, saturation: 0.2,
    });
    const repost = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 0.6,  // posted once already
      risk: 0.2, cringe: 0.2, saturation: 0.2,
    });
    const burned = computeJackingScore({
      fit: 0.7, velocity: 0.7, firstMover: 0,    // posted twice — done
      risk: 0.2, cringe: 0.2, saturation: 0.2,
    });
    expect(fresh).toBeGreaterThan(repost);
    expect(repost).toBeGreaterThan(burned);
    expect(burned).toBe(0);
  });

  it('saturation surge (e.g. competitor claimed) drags S_max down', () => {
    const clean    = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.1 });
    const claimed  = computeJackingScore({ fit: 0.7, velocity: 0.7, firstMover: 1.0, risk: 0.1, cringe: 0.1, saturation: 0.9 });
    expect(clean).toBeGreaterThan(claimed);
  });

  it('computeSignalStrength is an alias for computeJackingScore', () => {
    const inp = { fit: 0.5, velocity: 0.5, firstMover: 0.5, risk: 0.3, cringe: 0.2, saturation: 0.1 };
    expect(computeSignalStrength(inp)).toBe(computeJackingScore(inp));
  });
});

describe('shouldGenerateContent', () => {
  it('fires above the default threshold (0.35)', () => {
    expect(shouldGenerateContent(0.50)).toBe(true);
    expect(shouldGenerateContent(DEFAULT_JACKING_THRESHOLD)).toBe(true);
  });

  it('blocks below the default threshold', () => {
    expect(shouldGenerateContent(0.10)).toBe(false);
    expect(shouldGenerateContent(0.34)).toBe(false);
  });

  it('respects per-brand overrides', () => {
    expect(shouldGenerateContent(0.20, 0.10)).toBe(true);
    expect(shouldGenerateContent(0.20, 0.30)).toBe(false);
  });
});

describe('shouldAutoVerify', () => {
  it('fires the Verifier above 0.70 by default', () => {
    expect(shouldAutoVerify(0.75)).toBe(true);
    expect(shouldAutoVerify(AUTO_VERIFY_THRESHOLD)).toBe(true);
  });

  it('does not auto-verify modest signals', () => {
    expect(shouldAutoVerify(0.50)).toBe(false);
    expect(shouldAutoVerify(0.69)).toBe(false);
  });
});
