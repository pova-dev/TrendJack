// Cross-category regression suite. Pinned from the Trinity Swarm Agent 3
// audit — these are the exact failures the Solera (Premium Plant-based
// Footwear) stress test surfaced. If any of these regress, the system
// has lost its ability to distinguish brands across categories.

import { describe, expect, it } from 'vitest';
import { score } from '@/src/core/scoring/engine';
import { analyzeResonance } from '@/src/agents/resonance';
import { DEFAULT_WEIGHTS } from '@/types';
import type { BrandProfile } from '@/types';
import type { RawSignal } from '@/src/core/scoring/types';

const solera: BrandProfile = {
  id: 'solera-test', orgId: 'botanic-test',
  name: 'Solera',
  category: 'Premium Plant-based Footwear',
  markets: ['United States'],
  audience: { primary: ['conscious-luxury millennials'], age: '26-42', psychographics: ['values-driven'] },
  tone: {
    voice: 'Quiet luxury meets earnest material science. Direct, wry, self-aware.',
    tagline: 'Made of what comes back.',
    bannedPhrases: ['sustainable', 'eco-friendly', 'guilt-free', 'planet-saving'],
    forbiddenStyles: ['lifestyle warmth', 'motivational cliché', 'doom messaging', 'green-washing'],
    allowedJokes: ['material science nerdery', 'quiet absurdity'],
  },
  bannedTopics: ['fast fashion glorification', 'industrial agriculture'],
  brandKeywords: ['solera', 'mushroom leather', 'plant-based footwear'],
  safeThemes: ['sustainability', 'biomaterials', 'circular fashion', 'mycelium'],
  competitors: ['Veja', 'Allbirds', 'Stella McCartney', 'Adidas'],
  priorityPlatforms: ['x'],
  contentGoal: 'category leadership in plant-based footwear',
  riskTolerance: 'low', approvalMode: 'strict', crisisMode: false,
  scoringWeights: DEFAULT_WEIGHTS,
};

function makeSignal(over: Partial<RawSignal>): RawSignal {
  return {
    source: 'news',
    title: '', summary: '', hashtags: [], lineage: '',
    firstSeenAt: new Date(),
    velocity: 100, reach: 100_000, sentiment: 0,
    competitorClaimants: [], formatFatigue: 0,
    ...over,
  };
}

// ─── B1: empty scoringWeights → DEFAULT_WEIGHTS ───────────────────────────
describe('B1: empty scoringWeights must not produce NaN', () => {
  it('rowToBrand-style empty {} weights fall back to DEFAULT_WEIGHTS', () => {
    const brand: BrandProfile = { ...solera, scoringWeights: {} as never };
    const result = score(makeSignal({ title: 'Mushroom leather price drop' }), { brand });
    expect(Number.isFinite(result.scores.opportunity)).toBe(true);
    expect(result.scores.opportunity).toBeGreaterThan(0);
  });
});

// ─── B2: tonalFit + cringe must read brand.tone.forbiddenStyles ───────────
describe('B2: brand.tone.forbiddenStyles drives cringe / tonalFit', () => {
  it('"doom messaging" forbidden style — climate-doom signal lifts cringe', () => {
    const signal = makeSignal({
      title: 'Climate doom: fashion is dead, says new IPCC report',
      summary: 'Apocalyptic outlook for the apparel industry — 18 months to peak emissions or 1.5C is unreachable.',
    });
    const result = score(signal, { brand: solera });
    // Without the fix cringe was 0.05 — must be ≥ 0.20 once forbiddenStyles wires in.
    expect(result.scores.cringe).toBeGreaterThanOrEqual(0.20);
  });

  it('"lifestyle warmth" forbidden style — cozy/blissful framing lifts cringe', () => {
    const signal = makeSignal({
      title: 'Embrace the cozy magical journey of conscious shopping',
      summary: 'A blissful pure ritual that brings warmth and joy to your day.',
    });
    const result = score(signal, { brand: solera });
    expect(result.scores.cringe).toBeGreaterThanOrEqual(0.20);
  });

  it('on-brand industry news does NOT trigger forbidden-style cringe', () => {
    const signal = makeSignal({
      title: 'Mushroom leather price drops 40% after Stella McCartney supply deal',
      summary: 'Bolt Threads + Stella McCartney announce mycelium leather supply agreement.',
      competitorClaimants: ['Stella McCartney'],
    });
    const result = score(signal, { brand: solera });
    expect(result.scores.cringe).toBeLessThan(0.20);
  });
});

// ─── Cross-category hallucination — softAnchorVocab leak ──────────────────
describe('Cross-category: softAnchorVocab must not leak smartphone tokens to footwear brand', () => {
  it('gaming-phone signal scored against footwear brand → topicalFit ≤ 0.10', () => {
    const signal = makeSignal({
      source: 'reddit',
      title: 'POVA Curve 2 launches with 8000 mAh battery — gaming flagship',
      summary: 'Tecno POVA Curve 2 launched in India at ₹19,999. 8000 mAh battery, 144Hz display, MediaTek Dimensity 8300.',
      hashtags: ['#smartphone', '#gaming', '#tecno'],
    });
    const result = score(signal, { brand: solera });
    // Without the fix this was topicalFit=0.20 (smartphone soft-anchor
    // fired against a footwear brand). Now topicalFit must collapse to
    // the no-anchor floor and the recommendation must be IGNORE.
    // brandFit can sit a bit above 0.20 because tonalFit/audienceOverlap
    // start at neutral defaults (0.55 / 0.35) — those don't matter to
    // the verdict because decide.ts gates on topicalFit too.
    expect(result.scores.topicalFit).toBeLessThanOrEqual(0.10);
    expect(result.scores.brandFit).toBeLessThan(0.30);
    expect(result.recommendation).toBe('IGNORE');
  });

  it('the same gaming-phone signal scored for an actual smartphone brand still fits', () => {
    const phone: BrandProfile = {
      ...solera,
      category: 'Smartphones / consumer tech',
      brandKeywords: ['pova', 'tecno'],
      safeThemes: ['battery', 'gaming', 'design'],
      bannedTopics: [],
    };
    const signal = makeSignal({
      title: 'POVA Curve 2 launches with 8000 mAh battery — gaming flagship',
      summary: 'Tecno POVA Curve 2 launched today.',
      hashtags: ['#smartphone'],
    });
    const result = score(signal, { brand: phone });
    expect(result.scores.topicalFit).toBeGreaterThan(0.6);
  });
});

// ─── B4: irony multiplier requires both competitor AND humor markers ──────
describe('B4: analyzeResonance irony multiplier must require humor signal, not just competitor', () => {
  const ironyBrand: BrandProfile = {
    ...solera,
    tone: { ...solera.tone, voice: 'Sharp, direct, anti-cliché, wry, self-aware.' },
  };

  it('serious competitor news (no humor markers) → ironyMult = 1.0', () => {
    const signal = makeSignal({
      title: 'Mushroom leather price drops 40% after Stella McCartney supply deal',
      competitorClaimants: ['Stella McCartney'],
    });
    const result = score(signal, { brand: ironyBrand });
    const res = analyzeResonance(signal, result, ironyBrand);
    expect(res.ironicAlignmentMultiplier).toBe(1.0);
  });

  it('competitor + humor lexicon → ironyMult = 1.2', () => {
    const signal = makeSignal({
      title: 'Adidas viral meme parody: their new ad gets roasted',
      summary: 'Comedy creators turn Adidas marketing into a meme; humor takes over the timeline.',
      competitorClaimants: ['Adidas'],
    });
    const result = score(signal, { brand: ironyBrand });
    const res = analyzeResonance(signal, result, ironyBrand);
    expect(res.ironicAlignmentMultiplier).toBe(1.2);
  });
});
