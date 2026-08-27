// Client side of the step-up flow.
//
// The server answers a destructive request with 403 `step_up_required` when the
// role allows it but no code has been verified recently. Something has to catch
// that, collect a code, and retry. Doing it per call site would mean five copies
// of a modal and five chances to forget, so it lives here once.
//
// The prompt itself is React and mounts once (StepUpPrompt). This module holds
// the seam between them: a single registered opener, so calling code stays a
// plain async function with no context plumbing through five component trees.

export interface DeleteResult {
  ok: boolean;
  /** 'cancelled' when the user dismissed the code prompt — not an error to
   *  report, just an action that did not happen. */
  reason?: 'forbidden' | 'unauthorized' | 'cancelled' | 'failed';
  message?: string;
  status?: number;
}

type Opener = () => Promise<boolean>;

let openPrompt: Opener | null = null;

/** Called by the mounted prompt. Returns a disposer so a remount cannot leave a
 *  stale opener pointing at an unmounted tree. */
export function registerStepUpPrompt(opener: Opener): () => void {
  openPrompt = opener;
  return () => { if (openPrompt === opener) openPrompt = null; };
}

/**
 * Perform a request that may need step-up, retrying once after verification.
 *
 * Returns a result rather than throwing, because every call site here is a
 * button handler where an exception becomes an unhandled rejection and a row
 * that silently fails to disappear.
 */
export async function requestWithStepUp(url: string, init?: RequestInit): Promise<DeleteResult> {
  const first = await send(url, init);
  if (first.ok) return { ok: true };

  if (first.status === 403 && first.body?.error === 'step_up_required') {
    if (!openPrompt) {
      // The prompt is not mounted. Better to say so than to appear to hang.
      return { ok: false, reason: 'failed', message: 'Verification is unavailable on this screen. Reload and try again.' };
    }
    const verified = await openPrompt();
    if (!verified) return { ok: false, reason: 'cancelled' };

    // Retry exactly once. If the window closed again between verifying and
    // retrying, that is a real failure, not a reason to loop.
    const second = await send(url, init);
    if (second.ok) return { ok: true };
    return failure(second);
  }

  return failure(first);
}

/** Convenience for the common case. */
export function deleteWithStepUp(url: string): Promise<DeleteResult> {
  return requestWithStepUp(url, { method: 'DELETE' });
}

interface Sent { ok: boolean; status: number; body: { error?: string; message?: string } | null }

async function send(url: string, init?: RequestInit): Promise<Sent> {
  try {
    const res = await fetch(url, init);
    let body: Sent['body'] = null;
    try { body = await res.json(); } catch { /* empty or non-JSON body is fine */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    // Network failure. Distinguished from a rejection by the server so the
    // message can say something true.
    return { ok: false, status: 0, body: { message: (e as Error).message } };
  }
}

function failure(s: Sent): DeleteResult {
  if (s.status === 401) {
    return { ok: false, reason: 'unauthorized', status: 401, message: 'Your session expired. Sign in again.' };
  }
  if (s.status === 403) {
    return { ok: false, reason: 'forbidden', status: 403, message: s.body?.message ?? 'You do not have permission to do that.' };
  }
  return {
    ok: false,
    reason: 'failed',
    status: s.status,
    message: s.body?.message ?? (s.status === 0 ? 'Network error.' : `Request failed (${s.status}).`),
  };
}
