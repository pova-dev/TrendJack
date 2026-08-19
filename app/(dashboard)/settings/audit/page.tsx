import { redirect } from 'next/navigation';

// Audit 2026-05-29 U1 — duplicate of `/audit`. Canonicalized on top-level.
export default function AuditSettingsRedirect(): never {
  redirect('/audit');
}
