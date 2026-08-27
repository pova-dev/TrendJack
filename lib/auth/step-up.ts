// Step-up authorisation for destructive actions.
//
// Deleting requires two things: an admin-or-owner role, AND proof that the
// person at the keyboard right now is the account holder. The role check alone
// is not enough, because a borrowed laptop or a stolen session cookie carries
// the role with it.
//
// Why this rather than a separate admin login:
//   - A second login page does not verify anything a first login did not. The
//     control is the check, not the URL.
//   - Two auth systems means two session mechanisms and two sets of bugs.
//   - Separate admin credentials get shared, and then the audit log can no
//     longer say who did anything.
//
// A verified step-up sets a short window on the session, so deleting five
// things does not mean five emails. The window is deliberately short: it
// authorises a task, not a shift.

import 'server-only';
import { getSession } from './session';

/** How long one verification stays good. Long enough for a cleanup task,
 *  short enough that a walked-away-from laptop is not a standing key. */
export const STEP_UP_WINDOW_MINUTES = 10;

declare module 'iron-session' {
  interface IronSessionData {
    /** Epoch ms until which destructive actions are authorised. */
    stepUpUntil?: number;
  }
}

export class StepUpRequiredError extends Error {
  constructor() {
    super('This action needs a fresh verification code.');
    this.name = 'StepUpRequiredError';
  }
}

/** Open the window after a successful code verification. */
export async function grantStepUp(): Promise<Date> {
  const session = await getSession();
  const until = Date.now() + STEP_UP_WINDOW_MINUTES * 60_000;
  (session as unknown as { stepUpUntil?: number }).stepUpUntil = until;
  await session.save();
  return new Date(until);
}

/** Is the window currently open? */
export async function hasStepUp(): Promise<boolean> {
  const session = await getSession();
  const until = (session as unknown as { stepUpUntil?: number }).stepUpUntil;
  return typeof until === 'number' && until > Date.now();
}

/**
 * Require an open window, or throw.
 *
 * Throws rather than returning a boolean so a handler cannot continue past a
 * failed check by ignoring the result, which is the usual way authorisation
 * gates get bypassed by accident.
 */
export async function requireStepUp(): Promise<void> {
  if (!(await hasStepUp())) throw new StepUpRequiredError();
}

/** Close the window. Called on sign-out, and after any action that should not
 *  leave a standing authorisation behind. */
export async function clearStepUp(): Promise<void> {
  const session = await getSession();
  (session as unknown as { stepUpUntil?: number }).stepUpUntil = undefined;
  await session.save();
}

/** Seconds left, for the UI to show a countdown rather than failing silently
 *  when the window closes mid-task. */
export async function stepUpSecondsRemaining(): Promise<number> {
  const session = await getSession();
  const until = (session as unknown as { stepUpUntil?: number }).stepUpUntil;
  if (typeof until !== 'number') return 0;
  return Math.max(0, Math.floor((until - Date.now()) / 1000));
}
