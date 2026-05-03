// Integration test — exercises the full scoring pipeline end-to-end and
// verifies that brand-trend match decisions are correct across the 20
// labeled fixtures from the audit plan. This is the "Brand-Trend Match
// regression suite" — the unit tests cover individual axes, this proves
// the COMPOSITION produces the right recommendations.

import { describe, expect, it } from 'vitest';
import { score } from '@/src/core/scoring';
import { POVA_BRAND } from '../fixtures/pova-brand';
import {
  ALL_FIXTURES,
  BRAND_KEYWORD_HITS,
  COMPETITOR_ONLY,
  SOFT_ANCHOR_THEMED,
  BANNED_TOPIC,
  CRINGE_HEAVY,
  PURE_NOISE,
} from '../fixtures/trends';

describe('full scoring pipeline — Brand-Trend Match regression', () => {
  it('all 20 fixtures complete without throwing', () => {
    for (const { signal } of ALL_FIXTURES) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(result.scores.opportunity).toBeGreaterThanOrEqual(0);
      expect(result.scores.opportunity).toBeLessThanOrEqual(100);
      expect(result.recommendation).toBeTruthy();
      expect(result.peakWindowEnd).toBeInstanceOf(Date);
      // Jacking Score must always be in [0, 1].
      expect(result.jackingScore).toBeGreaterThanOrEqual(0);
      expect(result.jackingScore).toBeLessThanOrEqual(1);
    }
  });

  it('brand-keyword hits get recommendation ≠ IGNORE and brandKeywordHit=true', () => {
    for (const signal of BRAND_KEYWORD_HITS) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(true);
      expect(result.recommendation, `fixture: ${signal.title}`).not.toBe('IGNORE');
      // Brand match → high topical fit, so brandFit composite should be ≥ 0.50
      expect(result.scores.brandFit, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.50);
    }
  });

  it('competitor-only mentions get MONITOR (not POST_NOW), brandKeywordHit=false', () => {
    for (const signal of COMPETITOR_ONLY) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(false);
      // Competitor news shouldn't trigger autonomous POST_NOW. MONITOR or PREP_1H is acceptable.
      expect(result.recommendation, `fixture: ${signal.title}`).not.toBe('POST_NOW');
    }
  });

  it('banned-topic fixtures get IGNORE or ESCALATE', () => {
    for (const signal of BANNED_TOPIC) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(['IGNORE', 'ESCALATE'], `fixture: ${signal.title}`).toContain(result.recommendation);
      // topicalFit must be 0 for any trend mentioning a banned topic
      expect(result.scores.topicalFit, `fixture: ${signal.title}`).toBe(0);
    }
  });

  it('cringe-heavy fixtures get IGNORE (not auto-shipped)', () => {
    for (const signal of CRINGE_HEAVY) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(result.recommendation, `fixture: ${signal.title}`).toBe('IGNORE');
      expect(result.scores.cringe, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.40);
    }
  });

  it('pure-noise trends get IGNORE', () => {
    for (const signal of PURE_NOISE) {
      const result = score(signal, { brand: POVA_BRAND });
      expect(result.recommendation, `fixture: ${signal.title}`).toBe('IGNORE');
    }
  });

  it('crisis mode floors all non-IGNORE recommendations to MONITOR', () => {
    const crisisBrand = { ...POVA_BRAND, crisisMode: true };
    for (const signal of BRAND_KEYWORD_HITS) {
      const result = score(signal, { brand: crisisBrand });
      // Non-IGNORE results must collapse to MONITOR. (Hard kills like banned-
      // topic still produce IGNORE; brand-keyword fixtures don't trip those.)
      expect(['MONITOR', 'IGNORE'], `fixture: ${signal.title}`).toContain(result.recommendation);
    }
  });

  it('Jacking Score gates content generation correctly', () => {
    // Brand keyword hits with healthy velocity should clear the threshold.
    const hot = score(BRAND_KEYWORD_HITS[2], { brand: POVA_BRAND }); // POVA Curve unboxing, v=400, r=200k
    expect(hot.jackingScore).toBeGreaterThan(0.10);

    // Competitor-only with modest velocity should NOT clear the gate.
    const cold = score(COMPETITOR_ONLY[3], { brand: POVA_BRAND }); // Realme buds review, v=100, r=40k
    expect(cold.jackingScore).toBeLessThan(0.50);
  });
});

describe('score result shape stability', () => {
  it('always returns the full ScoreResult contract', () => {
    const result = score(BRAND_KEYWORD_HITS[0], { brand: POVA_BRAND });
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('rationale');
    expect(result).toHaveProperty('recommendation');
    expect(result).toHaveProperty('recommendationReason');
    expect(result).toHaveProperty('peakWindowEnd');
    expect(result).toHaveProperty('brandKeywordHit');
    expect(result).toHaveProperty('matchedBrandKeywords');
    expect(result).toHaveProperty('jackingScore');
    expect(Array.isArray(result.rationale)).toBe(true);
    expect(Array.isArray(result.matchedBrandKeywords)).toBe(true);
  });

  it('rationale entries cover every score axis', () => {
    const result = score(BRAND_KEYWORD_HITS[0], { brand: POVA_BRAND });
    const axes = new Set(result.rationale.map(r => r.axis));
    // All axes that go into the dashboard should have rationale.
    for (const axis of ['virality', 'topicalFit', 'tonalFit', 'audienceOverlap',
      'brandFit', 'timing', 'firstMover', 'saturation', 'risk', 'cringe',
      'formatFatigue', 'effort']) {
      expect(axes, `missing rationale: ${axis}`).toContain(axis);
    }
  });
});
