// Retention policy tests.
//
// The deletion itself is SQL against a live database, so these cover the
// decisions that determine whether that SQL is safe to run at all: the policy
// resolution, and the invariants the queries are built to preserve.
//
// Getting this wrong destroys data irreversibly, which is also why the cron is
// opt-in rather than on by default.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DEFAULT_POLICY, policyFromEnv } from '@/lib/retention';

const ORIGINAL = { ...process.env };
const env = () => process.env as Record<string, string | undefined>;

beforeEach(() => { process.env = { ...ORIGINAL }; });
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('policy defaults', () => {
  it('keeps enough samples for a forecast to still run', () => {
    // forecastPeak needs 3 samples. Pruning below that would silently disable
    // forecasting for every surviving trend.
    expect(DEFAULT_POLICY.minSamplesPerTrend).toBeGreaterThanOrEqual(3);
  });

  it('keeps trends longer than samples', () => {
    // Samples are the bulk of the rows; trends are the thing an operator
    // recognises. Expiring trends first would delete the record while keeping
    // its measurements, which is backwards.
    expect(DEFAULT_POLICY.trendRetentionDays).toBeGreaterThan(DEFAULT_POLICY.sampleRetentionDays);
  });

  it('uses defaults when nothing is configured', () => {
    delete env().TJ_SAMPLE_RETENTION_DAYS;
    delete env().TJ_TREND_RETENTION_DAYS;
    delete env().TJ_MIN_SAMPLES_PER_TREND;
    expect(policyFromEnv()).toEqual(DEFAULT_POLICY);
  });
});

describe('policy from environment', () => {
  it('accepts valid overrides', () => {
    env().TJ_SAMPLE_RETENTION_DAYS = '7';
    env().TJ_TREND_RETENTION_DAYS = '90';
    env().TJ_MIN_SAMPLES_PER_TREND = '10';

    expect(policyFromEnv()).toEqual({
      sampleRetentionDays: 7,
      trendRetentionDays: 90,
      minSamplesPerTrend: 10,
    });
  });

  it('ignores junk rather than deleting everything', () => {
    // A typo must never resolve to 0 days, which would wipe the database on
    // the next sweep.
    for (const bad of ['0', '-5', 'abc', '', 'NaN', 'Infinity']) {
      env().TJ_SAMPLE_RETENTION_DAYS = bad;
      expect(
        policyFromEnv().sampleRetentionDays,
        `"${bad}" must not become a retention window`,
      ).toBe(DEFAULT_POLICY.sampleRetentionDays);
    }
  });

  it('never yields a non-positive window for any field', () => {
    env().TJ_SAMPLE_RETENTION_DAYS = '-1';
    env().TJ_TREND_RETENTION_DAYS = '0';
    env().TJ_MIN_SAMPLES_PER_TREND = '-99';

    const p = policyFromEnv();
    expect(p.sampleRetentionDays).toBeGreaterThan(0);
    expect(p.trendRetentionDays).toBeGreaterThan(0);
    expect(p.minSamplesPerTrend).toBeGreaterThan(0);
  });
});

describe('cron is opt-in', () => {
  it('stays off unless explicitly enabled', async () => {
    delete env().TJ_RETENTION_ENABLED;
    const { getRetentionStatus } = await import('@/lib/retention');
    expect(getRetentionStatus().enabled).toBe(false);
  });

  it('reports enabled only for exactly "1"', async () => {
    const { getRetentionStatus } = await import('@/lib/retention');
    for (const v of ['true', 'yes', 'on', '0', '']) {
      env().TJ_RETENTION_ENABLED = v;
      expect(getRetentionStatus().enabled, `"${v}" should not enable deletion`).toBe(false);
    }
    env().TJ_RETENTION_ENABLED = '1';
    expect(getRetentionStatus().enabled).toBe(true);
  });
});
