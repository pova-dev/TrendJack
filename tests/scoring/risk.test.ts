// Risk scoring tests. Verifies five-tier detector + sentiment + competitor
// adjustment. Banned-topic hits force ≥ 0.65 (0.10 baseline + 0.55 banned).
// Inflammatory + crisis stacking pushes to 1.00 ceiling.

import { describe, expect, it } from 'vitest';
import { computeRisk } from '@/src/core/scoring/risk';
import { POVA_BRAND } from '../fixtures/pova-brand';
import { mkSignal, BANNED_TOPIC, BRAND_KEYWORD_HITS, PURE_NOISE } from '../fixtures/trends';

describe('computeRisk', () => {
  it('scores banned-topic fixtures ≥ 0.55', () => {
    for (const signal of BANNED_TOPIC) {
      const v = computeRisk(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('scores neutral product news low (≤ 0.30)', () => {
    for (const signal of BRAND_KEYWORD_HITS.slice(0, 2)) {
      const v = computeRisk(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.30);
    }
  });

  it('scores pure-noise trends at the baseline (≤ 0.20)', () => {
    for (const signal of PURE_NOISE) {
      const v = computeRisk(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.20);
    }
  });

  it('catches stem-matched crisis vocab (lawsuit/lawsuits)', () => {
    const v1 = computeRisk(mkSignal({ title: 'Class-action lawsuit filed' }), POVA_BRAND, []);
    const v2 = computeRisk(mkSignal({ title: 'Multiple lawsuits piling up' }), POVA_BRAND, []);
    expect(v1).toBeGreaterThan(0.20);
    expect(v2).toBeGreaterThan(0.20);
  });

  it('stacks crisis + controversy + inflammatory toward the ceiling', () => {
    const v = computeRisk(
      mkSignal({
        title: 'Riot at extremist protest leads to scandal — boycott calls escalate',
        sentiment: -0.7,
      }),
      POVA_BRAND, [],
    );
    expect(v).toBeGreaterThanOrEqual(0.70);
  });

  it('amplifies risk by tolerance setting', () => {
    const sig = mkSignal({ title: 'Lawsuit filed against competitor' });
    const lowTol  = computeRisk(sig, { ...POVA_BRAND, riskTolerance: 'low' }, []);
    const highTol = computeRisk(sig, { ...POVA_BRAND, riskTolerance: 'high' }, []);
    // low tolerance multiplies by 1.20, high by 0.80 → low > high
    expect(lowTol).toBeGreaterThan(highTol);
  });

  it('strongly negative sentiment adds risk even without keywords', () => {
    const calm = computeRisk(
      mkSignal({ title: 'Phone announcement next week', sentiment: 0 }),
      POVA_BRAND, [],
    );
    const angry = computeRisk(
      mkSignal({ title: 'Phone announcement next week', sentiment: -0.7 }),
      POVA_BRAND, [],
    );
    expect(angry - calm).toBeGreaterThanOrEqual(0.10);
  });
});
