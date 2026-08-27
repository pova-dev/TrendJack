// Client step-up retry logic.
//
// This module decides whether a failed destructive request gets a second
// chance. Getting it wrong is not cosmetic: retrying when it should not could
// double-delete, and not retrying when it should makes deletion impossible for
// everyone. Each test below pins one of those decisions.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { deleteWithStepUp, registerStepUpPrompt } from '@/lib/client/step-up';

type Reply = { status: number; body?: unknown };

/** Queue of replies, consumed one per call, so a test can describe a
 *  first-fails-then-succeeds sequence directly. */
function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 500 };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { calls };
}

const STEP_UP = { status: 403, body: { error: 'step_up_required', capability: 'resource:delete' } };

let disposers: Array<() => void> = [];

beforeEach(() => {
  disposers.forEach(d => d());
  disposers = [];
});

function prompt(answer: boolean) {
  const opener = vi.fn(async () => answer);
  disposers.push(registerStepUpPrompt(opener));
  return opener;
}

describe('happy path', () => {
  it('does not prompt when the server allows the delete', async () => {
    const opener = prompt(true);
    const { calls } = stubFetch([{ status: 200 }]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(true);
    // The prompt must never appear for a request that would have succeeded.
    // A code demanded on every delete trains people to ignore it.
    expect(opener).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('DELETE');
  });
});

describe('step-up', () => {
  it('prompts and retries once after verification', async () => {
    const opener = prompt(true);
    const { calls } = stubFetch([STEP_UP, { status: 200 }]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    // Same request both times. A retry that changed the target would be a bug
    // with real consequences on a delete.
    expect(calls[0].url).toBe(calls[1].url);
    expect(calls[1].init?.method).toBe('DELETE');
  });

  it('does not retry when the user cancels', async () => {
    const opener = prompt(false);
    const { calls } = stubFetch([STEP_UP, { status: 200 }]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cancelled');
    expect(opener).toHaveBeenCalledTimes(1);
    // Only the first attempt. Backing out of the prompt must not delete.
    expect(calls).toHaveLength(1);
  });

  it('gives up after one retry rather than looping', async () => {
    // The window can close between verifying and retrying. That is a real
    // failure; prompting again in a loop would trap the user.
    const opener = prompt(true);
    const { calls } = stubFetch([STEP_UP, STEP_UP]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('reports a clear failure when no prompt is mounted', async () => {
    // Nothing registered. Silently doing nothing here is the worst outcome:
    // the button appears dead with no explanation.
    stubFetch([STEP_UP]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });
});

describe('other refusals', () => {
  it('does not prompt for a plain permission denial', async () => {
    // A strategist cannot delete at all. Sending them for a code would be a
    // dead end: the code would verify and the retry would fail identically.
    const opener = prompt(true);
    const { calls } = stubFetch([
      { status: 403, body: { error: 'forbidden', capability: 'resource:delete', role: 'strategist', message: 'Your role (strategist) cannot perform "resource:delete".' } },
    ]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('forbidden');
    expect(res.message).toContain('strategist');
    expect(opener).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('surfaces an expired session as its own case', async () => {
    prompt(true);
    stubFetch([{ status: 401, body: { error: 'unauthorized' } }]);

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.reason).toBe('unauthorized');
  });

  it('survives a network failure without throwing', async () => {
    // Every caller is a click handler; an exception there becomes an unhandled
    // rejection and a button that silently does nothing.
    prompt(true);
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('failed');
    expect(res.message).toContain('offline');
  });

  it('survives a non-JSON error body', async () => {
    prompt(true);
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response)) as unknown as typeof fetch;

    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(res.ok).toBe(false);
    expect(res.message).toContain('502');
  });
});

describe('prompt registration', () => {
  it('stops using an opener after it is disposed', async () => {
    // A remount must not leave the old tree's resolver installed, or the
    // promise resolves into a component that no longer exists.
    const opener = vi.fn(async () => true);
    const dispose = registerStepUpPrompt(opener);
    dispose();

    stubFetch([STEP_UP]);
    const res = await deleteWithStepUp('/api/webhooks?id=1');

    expect(opener).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});
