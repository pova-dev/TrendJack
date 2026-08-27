'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { registerStepUpPrompt } from '@/lib/client/step-up';

// The code prompt for destructive actions.
//
// Mounts once in the dashboard layout and registers itself as the opener, so
// any delete anywhere in the app can raise it without prop-drilling or a
// context provider wrapping every tree.
//
// Opening it requests a code immediately. Making the user press "send" first
// adds a step that has exactly one possible answer.

type Resolver = (verified: boolean) => void;

const RESEND_COOLDOWN_SECONDS = 30;

export function StepUpPrompt() {
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);

  const resolverRef = React.useRef<Resolver | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const finish = React.useCallback((verified: boolean) => {
    resolverRef.current?.(verified);
    resolverRef.current = null;
    setOpen(false);
    // Cleared on close, not on open: a code left in the field is a code left on
    // screen for whoever walks past next.
    setCode('');
    setError(null);
    setNotice(null);
  }, []);

  const sendCode = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'step_up' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSentTo(body.to ?? null);
        setNotice(`Code sent to ${body.to ?? 'your email'}.`);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setError(body.message ?? 'Could not send a code.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Register the opener. The disposer keeps a remount from leaving a stale
  // reference behind that would resolve into an unmounted tree.
  React.useEffect(() => {
    return registerStepUpPrompt(() => {
      return new Promise<boolean>(resolve => {
        resolverRef.current = resolve;
        setOpen(true);
        void sendCode();
      });
    });
  }, [sendCode]);

  // Resend cooldown. Interval rather than a timestamp comparison in render, so
  // nothing derived from the clock is read during a render pass.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') finish(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, finish]);

  async function verify() {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/otp', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, purpose: 'step_up' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        finish(true);
      } else {
        setError(body.message ?? 'That code did not work.');
        setCode('');
        inputRef.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => finish(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stepup-title"
        className="relative w-full max-w-sm rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-pop"
      >
        <div className="text-2xs font-mono uppercase tracking-wider text-signal-red mb-1.5">
          Confirm deletion
        </div>
        <h2 id="stepup-title" className="text-sm font-semibold text-ink-100">
          Enter your verification code
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
          Deleting cannot be undone, so it needs a code from your email
          {sentTo ? <> at <span className="text-ink-200">{sentTo}</span></> : null}.
          One code covers the next 10 minutes.
        </p>

        <input
          ref={inputRef}
          value={code}
          onChange={e => {
            // Digits only: pasting from an email client often brings spaces
            // along, and rejecting the paste is worse than cleaning it.
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          onKeyDown={e => { if (e.key === 'Enter') void verify(); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Six-digit verification code"
          placeholder="000000"
          className={cn(
            'mt-4 w-full h-12 rounded-md bg-ink-800 border text-center',
            'font-mono text-xl tracking-[0.4em] text-ink-100 placeholder:text-ink-600',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400',
            error ? 'border-signal-red' : 'border-ink-700',
          )}
        />

        <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-xs">
          {error ? <span className="text-signal-red">{error}</span> : null}
          {!error && notice ? <span className="text-ink-500">{notice}</span> : null}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void verify()}
            disabled={code.length !== 6 || busy}
            className="flex-1 h-9 rounded-md bg-flare-400 text-ink-950 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => finish(false)}
            className="h-9 px-3 rounded-md border border-ink-700 text-sm text-ink-300 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400"
          >
            Cancel
          </button>
        </div>

        <button
          type="button"
          onClick={() => void sendCode()}
          disabled={busy || cooldown > 0}
          className="mt-3 text-2xs font-mono text-ink-500 hover:text-ink-300 disabled:opacity-50 disabled:hover:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded"
        >
          {cooldown > 0 ? `resend in ${cooldown}s` : 'resend code'}
        </button>
      </div>
    </div>
  );
}
