// CLAUDE.md hard-rule 8: SESSION_SECRET hard-fails in production.
//
// The guard used to run at MODULE LOAD, which made `npm run build` impossible
// — `next build` imports every route module with NODE_ENV=production to
// collect page data, so the throw fired on a build machine that legitimately
// has no runtime secret. (The Dockerfile builds before SESSION_SECRET is ever
// supplied, so the image could never be produced.)
//
// It's now resolved lazily. These tests pin BOTH halves of that contract:
// importing must be safe, and actually using a credential must still throw.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL = { ...process.env };

// @types/node declares NODE_ENV readonly, so assigning it directly fails
// `tsc --noEmit` even though it is perfectly writable at runtime.
//
// Resolve process.env on every call rather than aliasing it once: afterEach
// REPLACES the object, so a captured reference goes stale after the first
// test and silently stops affecting the real environment.
function setEnv(key: string, value?: string): void {
  const e = process.env as Record<string, string | undefined>;
  if (value === undefined) delete e[key];
  else e[key] = value;
}

beforeEach(() => vi.resetModules());
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('SESSION_SECRET guard — production', () => {
  it('lets the module be IMPORTED without a secret (the build path)', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SESSION_SECRET', undefined);

    // Must not throw. This is exactly what `next build` does.
    await expect(import('@/lib/security/crypto')).resolves.toBeDefined();
  });

  it('still throws when a credential is actually encrypted (rule 8)', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SESSION_SECRET', undefined);

    const { encrypt } = await import('@/lib/security/crypto');
    expect(() => encrypt('x-bearer-token')).toThrow(/SESSION_SECRET must be set/);
  });

  it('still throws when the secret is present but too short', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SESSION_SECRET', 'too-short');

    const { encrypt } = await import('@/lib/security/crypto');
    expect(() => encrypt('x-bearer-token')).toThrow(/32\+ char/);
  });

  it('round-trips a credential when a real secret is supplied', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SESSION_SECRET', 'a'.repeat(64));

    const { encrypt, decrypt } = await import('@/lib/security/crypto');
    const envelope = encrypt('x-bearer-token');

    expect(envelope).not.toContain('x-bearer-token'); // actually encrypted
    expect(decrypt(envelope)).toBe('x-bearer-token');
  });
});

describe('SESSION_SECRET guard — development', () => {
  it('falls back to the labelled dev placeholder', async () => {
    setEnv('NODE_ENV', 'development');
    setEnv('SESSION_SECRET', undefined);

    const { encrypt, decrypt } = await import('@/lib/security/crypto');
    expect(decrypt(encrypt('local-token'))).toBe('local-token');
  });
});
