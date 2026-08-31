// What is allowed onto the landing page.
//
// The landing view exists to answer "what needs me today" out of thousands of
// signals. Its whole value is that appearing there means something, so the
// admission rules are the feature. The first implementation filtered only on
// the peak window and let "#BiharKiPoliceDidi" through at topicalFit 0.05
// under "window closing" purely because its window was short, despite the
// engine having marked it IGNORE.
//
// A rejected trend on the landing page is worse than an empty landing page: it
// teaches the operator the ranking cannot be trusted, and then they go back to
// scrolling the board, which is the behaviour this view exists to replace.

import { describe, expect, it } from 'vitest';
import { ACTIONABLE, MIN_OPPORTUNITY, isEligibleForToday } from '@/lib/today';
import type { Recommendation } from '@/types';

function trend(recommendation: Recommendation, opportunity: number) {
  return { recommendation, scores: { opportunity } };
}

describe('admission', () => {
  it('never admits a trend the engine marked IGNORE, however urgent its window', () => {
    // The exact defect. A short peak window used to be sufficient on its own.
    expect(isEligibleForToday(trend('IGNORE', 95))).toBe(false);
  });

  it('never admits MONITOR, which means watch rather than act', () => {
    expect(isEligibleForToday(trend('MONITOR', 95))).toBe(false);
  });

  it('admits the recommendations that call for a human decision', () => {
    for (const r of ['POST_NOW', 'PREP_1H', 'ESCALATE', 'SAFE_PIVOT'] as Recommendation[]) {
      expect(isEligibleForToday(trend(r, 80)), `${r} should be actionable`).toBe(true);
    }
  });

  it('holds an opportunity floor even for actionable recommendations', () => {
    // Otherwise the list fills with technically-actionable trivia on a quiet
    // day, and a list that always has five items stops meaning anything.
    expect(isEligibleForToday(trend('POST_NOW', MIN_OPPORTUNITY - 1))).toBe(false);
    expect(isEligibleForToday(trend('POST_NOW', MIN_OPPORTUNITY))).toBe(true);
  });

  it('keeps the floor meaningfully above zero', () => {
    // Guards against someone "fixing" an empty landing page by dropping the
    // floor to 0, which reintroduces the noise this test exists to prevent.
    expect(MIN_OPPORTUNITY).toBeGreaterThanOrEqual(25);
    expect(MIN_OPPORTUNITY).toBeLessThan(100);
  });

  it('treats IGNORE and MONITOR as the only non-actionable states', () => {
    // Pins the set so a new recommendation added to the union has to be
    // classified deliberately rather than defaulting into the landing page.
    expect([...ACTIONABLE].sort()).toEqual(['ESCALATE', 'POST_NOW', 'PREP_1H', 'SAFE_PIVOT']);
  });
});
