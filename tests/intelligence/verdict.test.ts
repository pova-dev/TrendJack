// The source verdict.
//
// This states a conclusion in a sentence: one source converts N times better
// than another. That sentence is the whole reason the page exists, and it is
// also the easiest thing on it to get wrong, because it ranks on a rate over
// wildly uneven denominators. On real POVA data reddit shows 13.3% actionable
// from 15 signals while news shows 0.56% from 3,060, and picking a winner from
// rates alone would happily crown something with three data points.

import { describe, expect, it } from 'vitest';
import { sourceVerdict } from '@/lib/intelligence';
import type { SourceYield } from '@/lib/intelligence';

function src(source: string, signals: number, actionableRate: number, intakeShare: number): SourceYield {
  return {
    source: source as SourceYield['source'],
    signals,
    intakeShare,
    avgOpportunity: 30,
    brandRelevantRate: 0.1,
    actionableRate,
    competitorRate: 0.1,
    confident: signals >= 50,
  };
}

describe('picking the winner', () => {
  it('ranks on actionable rate rather than volume', () => {
    // The failure this guards: news wins on volume and loses on every measure
    // that means "produced something useful".
    const v = sourceVerdict([
      src('news', 3060, 0.0056, 0.44),
      src('reddit', 15, 0.1333, 0.002),
    ]);
    expect(v?.best.source).toBe('reddit');
    expect(v?.worst.source).toBe('news');
  });

  it('reports the multiple between them', () => {
    const v = sourceVerdict([
      src('news', 3060, 0.005, 0.44),
      src('reddit', 200, 0.10, 0.03),
    ]);
    expect(Math.round(v!.ratio)).toBe(20);
  });

  it('marks a winner drawn from a thin sample', () => {
    // Not suppressed, because a 13% rate from 15 signals is still the most
    // interesting thing on the page. But the UI has to be able to say so, or
    // the sentence overclaims.
    const v = sourceVerdict([
      src('news', 3060, 0.0056, 0.44),
      src('reddit', 15, 0.1333, 0.002),
    ]);
    expect(v?.best.confident).toBe(false);
  });
});

describe('picking the loser', () => {
  it('names a source that carries real volume, not a rounding error', () => {
    // A source with two signals and a zero rate is not the problem, and
    // pointing at it would send someone to fix the wrong thing.
    const v = sourceVerdict([
      src('news', 3000, 0.005, 0.60),
      src('x', 2000, 0.0008, 0.39),
      src('tiktok', 1, 0, 0.0002),
      src('reddit', 60, 0.13, 0.01),
    ]);
    expect(v?.worst.source).toBe('x');
    expect(v?.worst.source).not.toBe('tiktok');
  });

  it('falls back to the lowest rate when nothing carries volume', () => {
    const v = sourceVerdict([
      src('a', 10, 0.5, 0.05),
      src('b', 10, 0.1, 0.05),
    ]);
    expect(v?.worst.source).toBe('b');
  });
});

describe('refusing to state a finding there is none of', () => {
  it('returns nothing with fewer than two sources', () => {
    expect(sourceVerdict([])).toBeNull();
    expect(sourceVerdict([src('news', 100, 0.05, 1)])).toBeNull();
  });

  it('returns nothing when no source has ever produced anything actionable', () => {
    // "news converts 0 times better than x" is not a finding, and rendering
    // it would be worse than an empty section.
    expect(sourceVerdict([
      src('news', 3000, 0, 0.6),
      src('x', 2000, 0, 0.4),
    ])).toBeNull();
  });

  it('does not divide by zero into an infinite multiple it cannot render', () => {
    const v = sourceVerdict([
      src('news', 3000, 0, 0.6),
      src('reddit', 100, 0.1, 0.4),
    ]);
    // A real winner over a zero-rate loser. The ratio is infinite, which the
    // UI must special-case rather than printing "Infinity×".
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!.ratio)).toBe(false);
  });

  it('never names the same source as both best and worst', () => {
    // Happens when one source dominates intake and also leads on rate. The
    // sentence would read "news beats news", so no verdict is correct.
    expect(sourceVerdict([
      src('news', 3000, 0.05, 0.95),
      src('x', 50, 0.01, 0.05),
    ])?.best.source).not.toBe('news');
  });
});
