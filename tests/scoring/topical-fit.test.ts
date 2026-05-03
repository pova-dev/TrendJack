// Topical-fit tests. Verifies the three-tier anchored logic:
//   1. brand keyword hit       → ≥ 0.85, brandKeywordHit=true
//   2. competitor only         → 0.45-0.55, brandKeywordHit=false
//   3. soft anchor + theme     → 0.35-0.55, brandKeywordHit=false
//   banned topic               → 0
//   nothing                    → 0.05

import { describe, expect, it } from 'vitest';
import { computeTopicalFitDetailed } from '@/src/core/scoring/topical-fit';
import { POVA_BRAND } from '../fixtures/pova-brand';
import {
  BRAND_KEYWORD_HITS,
  COMPETITOR_ONLY,
  SOFT_ANCHOR_THEMED,
  BANNED_TOPIC,
  PURE_NOISE,
} from '../fixtures/trends';

describe('computeTopicalFitDetailed', () => {
  it('flags every brand-keyword fixture with ≥0.85 + brandKeywordHit', () => {
    for (const signal of BRAND_KEYWORD_HITS) {
      const result = computeTopicalFitDetailed(signal, POVA_BRAND, []);
      expect(result.value, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.85);
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(true);
      expect(result.matchedBrandKeywords.length, `fixture: ${signal.title}`).toBeGreaterThan(0);
    }
  });

  it('returns 0.45-0.55 for competitor-only mentions, brandKeywordHit=false', () => {
    for (const signal of COMPETITOR_ONLY) {
      const result = computeTopicalFitDetailed(signal, POVA_BRAND, []);
      expect(result.value, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.45);
      expect(result.value, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.55);
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(false);
    }
  });

  it('returns 0.35-0.55 for soft anchor + theme', () => {
    for (const signal of SOFT_ANCHOR_THEMED) {
      const result = computeTopicalFitDetailed(signal, POVA_BRAND, []);
      expect(result.value, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.35);
      expect(result.value, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.55);
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(false);
    }
  });

  it('forces topicalFit to 0 when a banned topic is detected', () => {
    for (const signal of BANNED_TOPIC) {
      const result = computeTopicalFitDetailed(signal, POVA_BRAND, []);
      expect(result.value, `fixture: ${signal.title}`).toBe(0);
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(false);
    }
  });

  it('returns the floor (≤ 0.20) for pure-noise / no-anchor trends', () => {
    for (const signal of PURE_NOISE) {
      const result = computeTopicalFitDetailed(signal, POVA_BRAND, []);
      expect(result.value, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.20);
      expect(result.brandKeywordHit, `fixture: ${signal.title}`).toBe(false);
    }
  });

  it('matched brand keywords list contains only actual hits', () => {
    const sig = BRAND_KEYWORD_HITS[0]; // "Tecno POVA 7 Pro review..."
    const result = computeTopicalFitDetailed(sig, POVA_BRAND, []);
    // Should match at least one of: pova, pova 7, tecno, tecno pova
    const matched = new Set(result.matchedBrandKeywords);
    expect(matched.size).toBeGreaterThan(0);
    for (const k of result.matchedBrandKeywords) {
      expect(POVA_BRAND.brandKeywords.map(b => b.toLowerCase())).toContain(k);
    }
  });
});
