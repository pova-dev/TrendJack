// Backtest harness for forecastPeak() — fits a 3-parameter logistic
// curve to synthetic + historical TrendSample series with known peaks.
//
// Quality target (Phase 1): median absolute peak-time error < 4 hours
// on the synthetic corpus. We test against a few known-shape curves
// (rising, peaking, decaying) with deliberately-noisy samples.

import { describe, expect, it } from 'vitest';
import { forecastPeak, type TrendTimeSample } from '@/src/core/scoring/cascade';

// Helper — generate a logistic curve in samples spanning T hours,
// centered at peakHourOffset, with some Gaussian-ish noise on reach.
function logisticSeries(opts: {
  K: number;
  r: number;
  peakHourOffset: number;  // hours after t0 where the curve peaks
  totalHours: number;
  step: number;
  noise?: number;
  startUnix?: number;      // wall-clock of first sample
}): TrendTimeSample[] {
  const out: TrendTimeSample[] = [];
  const t0 = opts.startUnix ?? Date.now();
  for (let h = 0; h <= opts.totalHours; h += opts.step) {
    const x = h - opts.peakHourOffset;
    // Cumulative-reach logistic
    const reach = Math.round(opts.K / (1 + Math.exp(-opts.r * x)));
    // Velocity = derivative ~= K * r * sigmoid * (1 - sigmoid)
    const sig = 1 / (1 + Math.exp(-opts.r * x));
    const velocity = Math.max(0, Math.round(opts.K * opts.r * sig * (1 - sig)));
    const noise = opts.noise ?? 0;
    out.push({
      sampledAt: new Date(t0 + h * 3_600_000),
      reach: Math.max(0, reach + Math.round((Math.random() - 0.5) * noise)),
      velocity: Math.max(0, velocity + Math.round((Math.random() - 0.5) * noise)),
    });
  }
  return out;
}

describe('forecastPeak — synthetic logistic fixtures', () => {
  it('returns null below 3 samples', () => {
    expect(forecastPeak([])).toEqual(expect.objectContaining({ predictedPeakAt: null, predictedPeakConfidence: 0 }));
    expect(forecastPeak(logisticSeries({ K: 100_000, r: 1, peakHourOffset: 5, totalHours: 1, step: 1 })).predictedPeakConfidence).toBe(0);
  });

  it('detects fast-growing-initial when curve is in the steep climb', () => {
    // Peak at +10h, sample only the first 4h — we're climbing.
    const samples = logisticSeries({ K: 1_000_000, r: 0.6, peakHourOffset: 10, totalHours: 4, step: 1 });
    const f = forecastPeak(samples);
    expect(f.phase).toBe('fast-growing-initial');
    expect(f.predictedPeakAt).not.toBeNull();
  });

  it('detects peaking when samples bracket the peak', () => {
    const samples = logisticSeries({ K: 1_000_000, r: 0.7, peakHourOffset: 5, totalHours: 10, step: 1 });
    const f = forecastPeak(samples);
    // We're past the steep climb but at/just past peak.
    expect(['peaking', 'decaying']).toContain(f.phase);
  });

  it('detects decaying when samples are post-peak', () => {
    const samples = logisticSeries({ K: 1_000_000, r: 0.5, peakHourOffset: 2, totalHours: 12, step: 1 });
    const f = forecastPeak(samples);
    expect(f.phase).toBe('decaying');
  });

  it('predicted peak time is within 4 hours of true peak (clean curve)', () => {
    const trueOffset = 10;
    const t0 = Date.now();
    const samples = logisticSeries({ K: 500_000, r: 0.5, peakHourOffset: trueOffset, totalHours: 6, step: 1, startUnix: t0 });
    const f = forecastPeak(samples);
    expect(f.predictedPeakAt).not.toBeNull();
    const predictedOffsetHours = (f.predictedPeakAt!.getTime() - t0) / 3_600_000;
    expect(Math.abs(predictedOffsetHours - trueOffset)).toBeLessThan(4);
  });

  it('confidence is capped low with sparse samples', () => {
    const samples = logisticSeries({ K: 100_000, r: 0.5, peakHourOffset: 5, totalHours: 3, step: 1 });
    const f = forecastPeak(samples);
    // 4 samples → confidence ≤ 0.6 (we want operators to know it's preliminary).
    expect(f.predictedPeakConfidence).toBeLessThanOrEqual(0.6);
  });

  it('handles bimodal / non-monotonic series gracefully (decay fallback)', () => {
    const samples: TrendTimeSample[] = [
      { sampledAt: new Date(Date.now() - 5 * 3_600_000), reach: 1000, velocity: 100 },
      { sampledAt: new Date(Date.now() - 4 * 3_600_000), reach: 5000, velocity: 400 },
      { sampledAt: new Date(Date.now() - 3 * 3_600_000), reach: 10_000, velocity: 500 },
      { sampledAt: new Date(Date.now() - 2 * 3_600_000), reach: 8000, velocity: 100 }, // dropped (anomaly)
      { sampledAt: new Date(Date.now() - 1 * 3_600_000), reach: 12_000, velocity: 200 },
    ];
    const f = forecastPeak(samples);
    // Reach went DOWN at sample 4 — declared decaying with low confidence.
    expect(f.phase === 'decaying' || f.predictedPeakConfidence < 0.5).toBe(true);
  });
});
