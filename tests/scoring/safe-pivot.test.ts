// Safe Pivot recommendation tests.
// Triggers when: brandFit ≥ 0.50 AND 0.50 ≤ risk < 0.70 AND cringe < 0.40.

import { describe, expect, it } from 'vitest';
import { decide } from '@/src/core/scoring/decide';
import type { Scores } from '@/types';
import type { RawSignal } from '@/src/core/scoring/types';
import { POVA_BRAND } from '../fixtures/pova-brand';
import { mkSignal } from '../fixtures/trends';

function mkScores(over: Partial<Scores> = {}): Scores {
  return {
    virality: 0.5, topicalFit: 0.7, tonalFit: 0.6, audienceOverlap: 0.5,
    brandFit: 0.6, timing: 0.5, firstMover: 1.0, saturation: 0.2,
    risk: 0.55, cringe: 0.10, formatFatigue: 0,
    assetEffort: 0.3, approvalEffort: 0.5, productionEffort: 0.25, effort: 0.35,
    opportunity: 50,
    ...over,
  };
}

describe('decide → SAFE_PIVOT', () => {
  it('fires on high brand-fit + elevated risk + clean tone', () => {
    const result = decide(mkScores(), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).toBe('SAFE_PIVOT');
    expect(result.recommendationReason).toMatch(/Pivot suggestion/);
  });

  it('does NOT fire when risk is normal (<0.50)', () => {
    const result = decide(mkScores({ risk: 0.20 }), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).not.toBe('SAFE_PIVOT');
  });

  it('does NOT fire when risk is too high (≥0.70 → ESCALATE)', () => {
    const result = decide(mkScores({ risk: 0.75 }), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).toBe('ESCALATE');
  });

  it('does NOT fire when cringe is high (≥0.40)', () => {
    const result = decide(mkScores({ cringe: 0.50 }), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).not.toBe('SAFE_PIVOT');
  });

  it('does NOT fire when brand-fit is low (<0.50)', () => {
    const result = decide(mkScores({ brandFit: 0.30 }), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).not.toBe('SAFE_PIVOT');
  });

  it('picks "positional" pivot for negatively-charged signals', () => {
    const sig = mkSignal({ title: 'phone', sentiment: -0.5 }) as RawSignal;
    const result = decide(mkScores(), sig, POVA_BRAND);
    expect(result.recommendation).toBe('SAFE_PIVOT');
    expect(result.recommendationReason).toMatch(/positional/);
  });

  it('picks "celebratory" when one competitor is involved', () => {
    const sig = mkSignal({ title: 'phone', competitorClaimants: ['Xiaomi'] }) as RawSignal;
    const result = decide(mkScores(), sig, POVA_BRAND);
    expect(result.recommendation).toBe('SAFE_PIVOT');
    expect(result.recommendationReason).toMatch(/celebratory/);
  });

  it('picks "meta" by default', () => {
    const result = decide(mkScores(), mkSignal({ title: 'phone' }) as RawSignal, POVA_BRAND);
    expect(result.recommendation).toBe('SAFE_PIVOT');
    expect(result.recommendationReason).toMatch(/meta/);
  });
});
