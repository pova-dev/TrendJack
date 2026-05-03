// Cascade phase predictor tests — R₀ from time-series, Cringe-Decay slope.

import { describe, expect, it } from 'vitest';
import {
  analyzeCascade,
  analyzeCringeDecay,
  type TrendTimeSample,
  type CringeDecaySample,
} from '@/src/core/scoring/cascade';

describe('analyzeCascade', () => {
  it('returns pre-launch when no samples', () => {
    expect(analyzeCascade([])).toMatchObject({
      R: null,
      phase: 'pre-launch',
      sampleCount: 0,
    });
  });

  it('returns pre-launch with 1 sample (need 2 for R)', () => {
    const out = analyzeCascade([
      { sampledAt: new Date(), reach: 100, velocity: 50 },
    ]);
    expect(out.phase).toBe('pre-launch');
    expect(out.R).toBeNull();
  });

  it('classifies fast-growing-initial when R ≥ 1.5', () => {
    const t0 = new Date('2026-04-30T10:00:00Z');
    const t1 = new Date('2026-04-30T11:00:00Z');
    const out = analyzeCascade([
      { sampledAt: t0, reach: 1000, velocity: 100 },
      { sampledAt: t1, reach: 3000, velocity: 200 }, // +2000 in 1h, R=2.0
    ]);
    expect(out.phase).toBe('fast-growing-initial');
    expect(out.R).toBeCloseTo(2.0);
  });

  it('classifies steady when 1.0 ≤ R < 1.5', () => {
    const out = analyzeCascade([
      { sampledAt: new Date('2026-04-30T10:00:00Z'), reach: 1000, velocity: 100 },
      { sampledAt: new Date('2026-04-30T11:00:00Z'), reach: 2200, velocity: 120 }, // R=1.2
    ]);
    expect(out.phase).toBe('steady');
  });

  it('classifies plateau when 0.5 ≤ R < 1.0', () => {
    const out = analyzeCascade([
      { sampledAt: new Date('2026-04-30T10:00:00Z'), reach: 1000, velocity: 100 },
      { sampledAt: new Date('2026-04-30T11:00:00Z'), reach: 1700, velocity: 60 }, // R=0.7
    ]);
    expect(out.phase).toBe('plateau');
  });

  it('classifies decay when R < 0.5', () => {
    const out = analyzeCascade([
      { sampledAt: new Date('2026-04-30T10:00:00Z'), reach: 1000, velocity: 100 },
      { sampledAt: new Date('2026-04-30T11:00:00Z'), reach: 1100, velocity: 30 }, // R=0.1
    ]);
    expect(out.phase).toBe('decay');
  });

  it('uses velocity ratio fallback when prior reach is 0', () => {
    const out = analyzeCascade([
      { sampledAt: new Date('2026-04-30T10:00:00Z'), reach: 0, velocity: 50 },
      { sampledAt: new Date('2026-04-30T11:00:00Z'), reach: 0, velocity: 200 }, // velRatio=4 → fast
    ]);
    expect(out.phase).toBe('fast-growing-initial');
    expect(out.R).toBeGreaterThan(1.5);
  });

  it('handles unsorted sample arrays', () => {
    const out = analyzeCascade([
      { sampledAt: new Date('2026-04-30T11:00:00Z'), reach: 3000, velocity: 200 },
      { sampledAt: new Date('2026-04-30T10:00:00Z'), reach: 1000, velocity: 100 },
    ]);
    expect(out.phase).toBe('fast-growing-initial');
  });
});

describe('analyzeCringeDecay', () => {
  it('returns null with <2 samples', () => {
    expect(analyzeCringeDecay([])).toBeNull();
    expect(analyzeCringeDecay([{ sampledAt: new Date(), cringe: 0.1, velocity: 100 }])).toBeNull();
  });

  it('flags hasPeaked when cringe rises faster than velocity', () => {
    const samples: CringeDecaySample[] = [
      { sampledAt: new Date('2026-04-30T10:00:00Z'), cringe: 0.10, velocity: 200 },
      { sampledAt: new Date('2026-04-30T14:00:00Z'), cringe: 0.50, velocity: 210 }, // cringe surge, velocity flat
    ];
    const out = analyzeCringeDecay(samples)!;
    expect(out.hasPeaked).toBe(true);
    expect(out.cringeSlope).toBeGreaterThan(0);
  });

  it('does not flag hasPeaked when both rise together', () => {
    const samples: CringeDecaySample[] = [
      { sampledAt: new Date('2026-04-30T10:00:00Z'), cringe: 0.10, velocity: 100 },
      { sampledAt: new Date('2026-04-30T14:00:00Z'), cringe: 0.15, velocity: 600 }, // cringe up tiny, velocity up huge
    ];
    const out = analyzeCringeDecay(samples)!;
    expect(out.hasPeaked).toBe(false);
  });

  it('does not flag hasPeaked when cringe is falling', () => {
    const samples: CringeDecaySample[] = [
      { sampledAt: new Date('2026-04-30T10:00:00Z'), cringe: 0.40, velocity: 100 },
      { sampledAt: new Date('2026-04-30T14:00:00Z'), cringe: 0.20, velocity: 150 },
    ];
    const out = analyzeCringeDecay(samples)!;
    expect(out.hasPeaked).toBe(false);
    expect(out.cringeSlope).toBeLessThan(0);
  });
});
