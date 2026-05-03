import { describe, expect, it } from 'vitest';
import { score } from '@/src/core/scoring/engine';
import { DEFAULT_WEIGHTS } from '@/types';
import type { BrandProfile } from '@/types';
import type { RawSignal } from '@/src/core/scoring/types';

// Calibration Engine (Feature D) — engine integration tests.
//
// These tests don't talk to Prisma or the bus. They verify the
// `calibrationProvider` parameter on `score()` does what the spec
// requires:
//   1. opportunity changes per the boost
//   2. CVS / jackingScore is NEVER affected (CLAUDE.md hard rule 4)
//   3. cold-start (provider=undefined or returns 1.0) preserves prior behavior
//   4. boost is applied multiplicatively then clamped to [0, 100]

const brand: BrandProfile = {
  id: 'cal-test', orgId: 'cal-org',
  name: 'CalBrand', category: 'Smartphones',
  markets: ['IN'],
  audience: { primary: ['Gen Z'], age: '18-30', psychographics: [] },
  tone: { voice: 'Sharp.', tagline: '', bannedPhrases: [], allowedJokes: [], forbiddenStyles: [] },
  bannedTopics: [],
  brandKeywords: ['cal'],
  safeThemes: ['battery'],
  competitors: ['Xiaomi'],
  priorityPlatforms: ['x'],
  contentGoal: '',
  riskTolerance: 'medium', approvalMode: 'moderate', crisisMode: false,
  scoringWeights: DEFAULT_WEIGHTS,
};

const baseSignal: RawSignal = {
  source: 'reddit',
  title: 'CalBrand X1 review with great battery life',
  summary: 'Solid mid-range phone.',
  hashtags: ['#smartphone'],
  lineage: 'r/cellphones · 200 upvotes',
  firstSeenAt: new Date(),
  velocity: 50, reach: 50_000, sentiment: 0.3,
  competitorClaimants: [], formatFatigue: 0,
};

describe('calibrationProvider — opportunity nudge without touching CVS', () => {
  it('cold start (no provider) — opportunity is the unmodified composite', () => {
    const r = score(baseSignal, { brand });
    expect(r.scores.opportunity).toBeGreaterThan(0);
    expect(r.scores.opportunity).toBeLessThanOrEqual(100);
    expect(Number.isFinite(r.jackingScore)).toBe(true);
  });

  it('provider returning 1.0 = identity (no-op for cold-start brands)', () => {
    const a = score(baseSignal, { brand });
    const b = score(baseSignal, { brand, calibrationProvider: () => 1.0 });
    expect(a.scores.opportunity).toBe(b.scores.opportunity);
    expect(a.jackingScore).toBe(b.jackingScore);
  });

  it('provider returning 1.5 boosts opportunity by 50% (clamped to 100)', () => {
    const cold = score(baseSignal, { brand });
    const boosted = score(baseSignal, { brand, calibrationProvider: () => 1.5 });
    expect(boosted.scores.opportunity).toBeGreaterThan(cold.scores.opportunity);
    expect(boosted.scores.opportunity).toBeLessThanOrEqual(100);
    // Within rounding of cold * 1.5 (capped at 100)
    expect(boosted.scores.opportunity).toBe(Math.min(100, Math.round(cold.scores.opportunity * 1.5)));
  });

  it('provider returning 0.5 drags opportunity by 50%', () => {
    const cold = score(baseSignal, { brand });
    const dragged = score(baseSignal, { brand, calibrationProvider: () => 0.5 });
    expect(dragged.scores.opportunity).toBeLessThan(cold.scores.opportunity);
    expect(dragged.scores.opportunity).toBe(Math.round(cold.scores.opportunity * 0.5));
  });

  it('CVS / jackingScore is NEVER touched by calibration (CLAUDE.md rule 4)', () => {
    const cold = score(baseSignal, { brand });
    const boosted = score(baseSignal, { brand, calibrationProvider: () => 1.5 });
    const dragged = score(baseSignal, { brand, calibrationProvider: () => 0.5 });
    // jackingScore (CVS) MUST be identical across all three runs.
    expect(boosted.jackingScore).toBe(cold.jackingScore);
    expect(dragged.jackingScore).toBe(cold.jackingScore);
    // Per-axis scores are also untouched.
    expect(boosted.scores.brandFit).toBe(cold.scores.brandFit);
    expect(boosted.scores.risk).toBe(cold.scores.risk);
    expect(boosted.scores.cringe).toBe(cold.scores.cringe);
  });

  it('non-finite or zero boost is rejected — opportunity stays cold-start', () => {
    const cold = score(baseSignal, { brand });
    const nanRun = score(baseSignal, { brand, calibrationProvider: () => NaN });
    const zeroRun = score(baseSignal, { brand, calibrationProvider: () => 0 });
    const negRun = score(baseSignal, { brand, calibrationProvider: () => -1 });
    expect(nanRun.scores.opportunity).toBe(cold.scores.opportunity);
    expect(zeroRun.scores.opportunity).toBe(cold.scores.opportunity);
    expect(negRun.scores.opportunity).toBe(cold.scores.opportunity);
  });

  it('opportunity is clamped to [0, 100] even with extreme boost', () => {
    const huge = score(baseSignal, { brand, calibrationProvider: () => 100 });
    expect(huge.scores.opportunity).toBe(100);
    const tiny = score(baseSignal, { brand, calibrationProvider: () => 0.001 });
    expect(tiny.scores.opportunity).toBeGreaterThanOrEqual(0);
  });
});

describe('calibrationProvider — feature snapshot exposure', () => {
  it('provider receives the partial result with the 6 axes', () => {
    let captured: { opportunity: number; brandFit: number; risk: number; cringe: number; saturation: number; firstMover: number } | null = null;
    score(baseSignal, {
      brand,
      calibrationProvider: (_signal, partial) => {
        captured = partial.scores;
        return 1.0;
      },
    });
    expect(captured).not.toBeNull();
    expect(typeof captured!.opportunity).toBe('number');
    expect(typeof captured!.brandFit).toBe('number');
    expect(typeof captured!.risk).toBe('number');
    expect(typeof captured!.cringe).toBe('number');
    expect(typeof captured!.saturation).toBe('number');
    expect(typeof captured!.firstMover).toBe('number');
  });
});
