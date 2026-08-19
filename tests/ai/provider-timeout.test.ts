// Every AI provider call must have a wall-clock ceiling.
//
// Regression origin: none of the four provider fetches passed a signal, and
// Node's fetch has no default request timeout. A stalled connection hung
// forever. That wedged the Verifier Agent — its handler awaits verify() and
// only acks on success, so a hung call left the message un-acked with the
// handler pinned. 6,093 messages piled up on tj.trends.scored with
// deliveryCount:1 and NOT ONE error was logged: claim verification was dead
// while every health check still read green.
//
// The failure mode these tests defend against is specifically a silent hang,
// so "returns an error promptly" is the property under test — not the exact
// error text.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runChat } from '@/lib/ai/provider';
import type { OrgCredentials } from '@/lib/credentials';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

/** A server that accepts the connection and then never answers. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal → hangs forever, which is the bug
      signal.addEventListener('abort', () => reject((signal as AbortSignal).reason));
    }),
  );
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, TJ_AI_TIMEOUT_MS: '120' };
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

const PROVIDERS: { name: string; creds: OrgCredentials }[] = [
  { name: 'anthropic',  creds: { ANTHROPIC_API_KEY: 'k' } },
  { name: 'openai',     creds: { OPENAI_API_KEY: 'k' } },
  { name: 'google',     creds: { GOOGLE_API_KEY: 'k' } },
  { name: 'openrouter', creds: { OPENROUTER_API_KEY: 'k' } },
];

describe('provider calls cannot hang forever', () => {
  for (const p of PROVIDERS) {
    it(`${p.name} aborts instead of hanging`, async () => {
      const f = hangingFetch();
      globalThis.fetch = f as unknown as typeof fetch;

      const res = await runChat({
        tier: 'premium',
        messages: [{ role: 'user', content: 'hello' }],
        credentials: p.creds,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/timeout/i);
    });

    it(`${p.name} passes an AbortSignal to fetch`, async () => {
      const f = hangingFetch();
      globalThis.fetch = f as unknown as typeof fetch;

      await runChat({
        tier: 'premium',
        messages: [{ role: 'user', content: 'hello' }],
        credentials: p.creds,
      });

      expect(f).toHaveBeenCalled();
      const init = f.mock.calls[0][1] as RequestInit;
      expect(init.signal, `${p.name} fetch was called with no signal`).toBeInstanceOf(AbortSignal);
    });
  }

  it('resolves rather than rejecting, so callers can ack or retry deliberately', async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;

    // The Verifier depends on this: a rejected promise it can catch, never a
    // promise that never settles.
    await expect(
      runChat({
        tier: 'premium',
        messages: [{ role: 'user', content: 'hi' }],
        credentials: { ANTHROPIC_API_KEY: 'k' },
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('honours TJ_AI_TIMEOUT_MS', async () => {
    process.env.TJ_AI_TIMEOUT_MS = '80';
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;

    const started = performance.now();
    await runChat({
      tier: 'premium',
      messages: [{ role: 'user', content: 'hi' }],
      credentials: { ANTHROPIC_API_KEY: 'k' },
    });
    const elapsed = performance.now() - started;

    // Generous upper bound — asserting it aborts near the configured value
    // rather than running to some much larger default.
    expect(elapsed).toBeLessThan(3000);
  });
});
