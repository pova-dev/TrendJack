// Cringe scoring tests. Verifies the seven-tier detector:
//   1. brand-banned phrases   (heaviest)
//   2. cliché triggers
//   3. ad-speak
//   4. hype adjectives
//   5. forced slang
//   6. exclamation density / emoji clusters / ALL-CAPS
//
// Spread requirement: cringe should range across [0.05, 1.0] for real-world
// content, not cluster at 0.05 like the pre-refactor version did.

import { describe, expect, it } from 'vitest';
import { computeCringe } from '@/src/core/scoring/cringe';
import { POVA_BRAND } from '../fixtures/pova-brand';
import { mkSignal, CRINGE_HEAVY, BRAND_KEYWORD_HITS, PURE_NOISE } from '../fixtures/trends';

describe('computeCringe', () => {
  it('scores cringe-heavy fixtures ≥ 0.50', () => {
    for (const signal of CRINGE_HEAVY) {
      const v = computeCringe(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeGreaterThanOrEqual(0.50);
    }
  });

  it('scores neutral news headlines low (≤ 0.30)', () => {
    for (const signal of BRAND_KEYWORD_HITS.slice(0, 2)) {
      const v = computeCringe(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.30);
    }
  });

  it('scores pure-noise trends near the floor (≤ 0.10)', () => {
    for (const signal of PURE_NOISE) {
      const v = computeCringe(signal, POVA_BRAND, []);
      expect(v, `fixture: ${signal.title}`).toBeLessThanOrEqual(0.10);
    }
  });

  it('flags brand-banned phrases at +0.30 each', () => {
    const clean = mkSignal({ title: 'Phone launches in India next week' });
    const banned = mkSignal({ title: 'Unleash your potential with this new phone' });
    const cleanV = computeCringe(clean, POVA_BRAND, []);
    const bannedV = computeCringe(banned, POVA_BRAND, []);
    // Banned phrase should add at least 0.25 (slack for round-off)
    expect(bannedV - cleanV).toBeGreaterThanOrEqual(0.25);
  });

  it('catches stem-matched ad-speak (redefining, redefined, redefines)', () => {
    const titles = [
      'Apple is redefining the smartphone',
      'Apple has redefined what a phone is',
      'A device that redefines portable computing',
    ];
    for (const t of titles) {
      const v = computeCringe(mkSignal({ title: t }), POVA_BRAND, []);
      expect(v, `title: ${t}`).toBeGreaterThan(0.10);
    }
  });

  it('catches hype adjectives (wild, stunning, mind-blowing)', () => {
    const v = computeCringe(
      mkSignal({ title: 'WILD new gaming phone with STUNNING display and MIND-BLOWING battery' }),
      POVA_BRAND, [],
    );
    expect(v).toBeGreaterThan(0.15);
  });

  it('penalizes 3+ exclamation marks', () => {
    const calm = computeCringe(mkSignal({ title: 'New phone launches today' }), POVA_BRAND, []);
    const loud = computeCringe(mkSignal({ title: 'New phone launches today!!!' }), POVA_BRAND, []);
    expect(loud - calm).toBeGreaterThanOrEqual(0.10);
  });
});
