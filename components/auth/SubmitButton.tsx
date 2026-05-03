'use client';
import * as React from 'react';
import { useFormStatus } from 'react-dom';

// Auth-form submit button with React 19 useFormStatus integration.
// Disables itself + shows the busy label while the server action is in
// flight, so a second click before the redirect lands cannot re-submit.
//
// Round 3 audit found the previous bare `<button type="submit">` had no
// pending-state feedback — operators tapping "Sign in" twice triggered
// duplicate signup attempts.
export function SubmitButton({
  idleLabel,
  busyLabel,
}: {
  idleLabel: string;
  busyLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full h-9 rounded-md bg-flare-500 text-ink-950 font-semibold hover:bg-flare-400 disabled:opacity-60 disabled:cursor-wait text-sm motion-safe:transition-opacity"
    >
      {pending ? busyLabel : idleLabel}
    </button>
  );
}
