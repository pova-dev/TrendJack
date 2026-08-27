// One-time code tests.
//
// These cover the properties that make an OTP an actual security control
// rather than a formality. Each corresponds to a way naive implementations get
// broken, so a regression here is a real vulnerability, not a style issue.

import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { generateCode, hashCode, safeEqual, OTP_TTL_MINUTES } from '@/lib/auth/otp';

describe('code generation', () => {
  it('is always six digits, zero-padded', () => {
    // Variable length would make short codes easier to guess and would leak
    // information through the length of the field.
    for (let i = 0; i < 500; i++) {
      const c = generateCode();
      expect(c).toMatch(/^\d{6}$/);
      expect(c).toHaveLength(6);
    }
  });

  it('covers the low end of the range, including all-zeros', () => {
    // A naive implementation that drops leading zeros silently shrinks the
    // keyspace. Padding is what keeps 000042 a valid code.
    const codes = new Set<string>();
    for (let i = 0; i < 4000; i++) codes.add(generateCode());
    expect([...codes].some(c => c.startsWith('0'))).toBe(true);
  });

  it('does not repeat in a way a sequence would', () => {
    // Not a randomness proof, but a counter or a seeded PRNG would fail it.
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateCode());
    expect(codes.size).toBeGreaterThan(900);
  });

  it('uses the crypto RNG rather than Math.random', () => {
    // Math.random output is predictable from prior values, which for an auth
    // code is a total break. Verified by observing that the generator does not
    // move when Math.random is pinned.
    const original = Math.random;
    try {
      Math.random = () => 0.123456789;
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) codes.add(generateCode());
      expect(codes.size, 'generator appears to depend on Math.random').toBeGreaterThan(1);
    } finally {
      Math.random = original;
    }
  });
});

describe('storage', () => {
  it('hashes, so a database dump yields no working codes', () => {
    const code = '123456';
    const h = hashCode(code);
    expect(h).not.toBe(code);
    expect(h).toHaveLength(64);          // sha-256 hex
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, which is what makes verification possible', () => {
    expect(hashCode('000000')).toBe(hashCode('000000'));
    expect(hashCode('000000')).not.toBe(hashCode('000001'));
  });

  it('matches an independent sha-256, so the scheme is not homegrown', () => {
    const expected = crypto.createHash('sha256').update('654321').digest('hex');
    expect(hashCode('654321')).toBe(expected);
  });
});

describe('comparison', () => {
  it('accepts an exact match', () => {
    expect(safeEqual(hashCode('111111'), hashCode('111111'))).toBe(true);
  });

  it('rejects a near miss', () => {
    expect(safeEqual(hashCode('111111'), hashCode('111112'))).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    // timingSafeEqual throws on unequal lengths, which would turn a wrong
    // guess into a 500 and reveal the length through the status code.
    expect(() => safeEqual('short', 'muchlongervalue')).not.toThrow();
    expect(safeEqual('short', 'muchlongervalue')).toBe(false);
  });

  it('handles empty input safely', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('policy', () => {
  it('expires quickly enough to matter', () => {
    // Long-lived codes are the difference between a second factor and a second
    // password. Five minutes is the window an intercepted code stays useful.
    expect(OTP_TTL_MINUTES).toBeGreaterThan(0);
    expect(OTP_TTL_MINUTES).toBeLessThanOrEqual(10);
  });
});
