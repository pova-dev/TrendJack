// forecastPeak() must never hand back an Invalid Date.
//
// Regression origin: t0 is recovered as -intercept/slope. A slope small enough
// to survive the r > 0 check still explodes that quotient, and multiplied into
// milliseconds it lands outside the +/-8.64e15 ms that Date accepts. new Date()
// does not throw there, it returns an Invalid Date, which is still a Date
// instance and still passes every type check. The failure only surfaced at the
// Prisma boundary, where it aborted the forecast write.
//
// It was not rare. One dev-server log carried 7,478 of these, meaning forecast
// persistence was failing continuously for near-flat curves while the app
// looked healthy.

import { describe, expect, it } from 'vitest';
import { forecastPeak, type TrendTimeSample } from '@/src/core/scoring/cascade';

const HOUR = 3_600_000;

function sample(hoursFromNow: number, reach: number, velocity: number): TrendTimeSample {
  return {
    sampledAt: new Date(Date.UTC(2026, 0, 1) + hoursFromNow * HOUR),
    reach,
    velocity,
  };
}

/** The property under test: a returned date must be storable. */
function assertStorable(d: Date | null) {
  if (d === null) return;
  expect(d).toBeInstanceOf(Date);
  expect(Number.isFinite(d.getTime()), `got Invalid Date: ${String(d)}`).toBe(true);
  // Prisma/SQLite reject anything outside the Date range too.
  expect(Math.abs(d.getTime())).toBeLessThanOrEqual(8.64e15);
}

describe('forecastPeak never returns an unstorable date', () => {
  it('returns null rather than an Invalid Date for an almost-flat curve', () => {
    // Reach barely moves, so the logit line is nearly horizontal and t0 blows up.
    const out = forecastPeak([
      sample(0, 1_000_000, 10),
      sample(3, 1_000_001, 10),
      sample(6, 1_000_002, 10),
    ]);
    assertStorable(out.predictedPeakAt);
  });

  it('handles a completely flat curve', () => {
    const out = forecastPeak([
      sample(0, 500_000, 5),
      sample(2, 500_000, 5),
      sample(4, 500_000, 5),
      sample(6, 500_000, 5),
    ]);
    assertStorable(out.predictedPeakAt);
  });

  it('handles identical timestamps', () => {
    const out = forecastPeak([
      sample(0, 100, 1),
      sample(0, 200, 2),
      sample(0, 300, 3),
    ]);
    assertStorable(out.predictedPeakAt);
  });

  it('handles zero and huge reach without producing a bad date', () => {
    for (const series of [
      [sample(0, 0, 0), sample(1, 0, 0), sample(2, 0, 0)],
      [sample(0, 1, 1), sample(1, Number.MAX_SAFE_INTEGER, 1), sample(2, 1, 1)],
      [sample(0, Number.MAX_SAFE_INTEGER, 1e9), sample(5, Number.MAX_SAFE_INTEGER, 1e9), sample(9, Number.MAX_SAFE_INTEGER, 1e9)],
    ]) {
      assertStorable(forecastPeak(series).predictedPeakAt);
    }
  });

  it('survives a wide sweep of near-degenerate series', () => {
    // Brute force the shapes that ingestion actually throws at this: tiny
    // deltas over short windows are exactly the near-flat case.
    for (let delta = 0; delta <= 8; delta++) {
      for (let span = 1; span <= 6; span++) {
        const out = forecastPeak([
          sample(0, 10_000, 100),
          sample(span, 10_000 + delta, 100),
          sample(span * 2, 10_000 + delta * 2, 100),
        ]);
        assertStorable(out.predictedPeakAt);
      }
    }
  });

  it('still produces a real forecast for a healthy growth curve', () => {
    // The guard must not have blunted the actual feature.
    const out = forecastPeak([
      sample(0, 10_000, 500),
      sample(2, 40_000, 2_000),
      sample(4, 120_000, 5_000),
      sample(6, 260_000, 6_000),
    ]);
    assertStorable(out.predictedPeakAt);
    expect(out.predictedPeakAt).not.toBeNull();
    expect(out.predictedPeakConfidence).toBeGreaterThan(0);
  });
});
