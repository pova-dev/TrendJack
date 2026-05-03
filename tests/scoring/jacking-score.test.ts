// Jacking Score tests.  JS = (V × R) / D
//
// Core requirement: AND-gate semantics. Low velocity OR low relevance OR
// high difficulty kills the score regardless of the other axes.

import { describe, expect, it } from 'vitest';
import {
  computeJackingScore,
  shouldGenerateContent,
  DEFAULT_JACKING_THRESHOLD,
} from '@/src/core/scoring/jacking-score';

describe('computeJackingScore', () => {
  it('returns 1.0 (clamped) for max V, max R, low D', () => {
    const js = computeJackingScore({ velocity: 1.0, relevance: 1.0, difficulty: 0.1 });
    expect(js).toBe(1.0);
  });

  it('returns ~0 when velocity is 0', () => {
    expect(computeJackingScore({ velocity: 0, relevance: 1.0, difficulty: 0.1 })).toBe(0);
  });

  it('returns ~0 when relevance is 0', () => {
    expect(computeJackingScore({ velocity: 1.0, relevance: 0, difficulty: 0.1 })).toBe(0);
  });

  it('penalizes high difficulty', () => {
    const easy = computeJackingScore({ velocity: 0.7, relevance: 0.7, difficulty: 0.2 });
    const hard = computeJackingScore({ velocity: 0.7, relevance: 0.7, difficulty: 0.9 });
    expect(easy).toBeGreaterThan(hard);
  });

  it('floors difficulty at 0.1 to avoid div-by-zero', () => {
    const veryEasy   = computeJackingScore({ velocity: 0.5, relevance: 0.5, difficulty: 0.05 });
    const exactlyMin = computeJackingScore({ velocity: 0.5, relevance: 0.5, difficulty: 0.1  });
    expect(veryEasy).toBe(exactlyMin); // both treated as 0.1 → JS = 0.5×0.5/0.1 = 2.5 clamped to 1.0
    expect(veryEasy).toBe(1.0);
  });

  it('clamps inputs to [0, 1] before computing', () => {
    const overshoot = computeJackingScore({ velocity: 5.0, relevance: 5.0, difficulty: -1.0 });
    expect(overshoot).toBeLessThanOrEqual(1.0);
    expect(overshoot).toBeGreaterThanOrEqual(0);
  });

  it('AND-gate: any zero axis → JS = 0 (or near it)', () => {
    expect(computeJackingScore({ velocity: 0,   relevance: 1,   difficulty: 0.1 })).toBe(0);
    expect(computeJackingScore({ velocity: 1,   relevance: 0,   difficulty: 0.1 })).toBe(0);
  });

  it('round-trips through the same multiplicative shape we documented', () => {
    // V=0.6, R=0.7, D=0.4 → JS = 0.42 / 0.4 = 1.05, clamped → 1.0? Actually 0.42/0.4 = 1.05 → clamped to 1.0
    // V=0.7, R=0.7, D=0.4 → JS = 0.49 / 0.4 = 1.225, clamped → 1.0
    // V=0.4, R=0.4, D=0.4 → JS = 0.16 / 0.4 = 0.40
    expect(computeJackingScore({ velocity: 0.4, relevance: 0.4, difficulty: 0.4 })).toBe(0.40);
  });
});

describe('shouldGenerateContent', () => {
  it('fires above the default threshold', () => {
    expect(shouldGenerateContent(0.50)).toBe(true);
    expect(shouldGenerateContent(DEFAULT_JACKING_THRESHOLD)).toBe(true);
  });

  it('blocks below the default threshold', () => {
    expect(shouldGenerateContent(0.10)).toBe(false);
    expect(shouldGenerateContent(0.34)).toBe(false);
  });

  it('respects a custom threshold (per-brand override)', () => {
    expect(shouldGenerateContent(0.20, 0.10)).toBe(true);
    expect(shouldGenerateContent(0.20, 0.30)).toBe(false);
  });
});
