import { redirect } from 'next/navigation';

// Audit 2026-05-29 U1 — duplicate of `/alerts`. Canonicalized on top-level.
export default function AlertsSettingsRedirect(): never {
  redirect('/alerts');
}
