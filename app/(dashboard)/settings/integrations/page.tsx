import { redirect } from 'next/navigation';

// Audit 2026-05-29 U1 — duplicate of `/integrations`. Canonicalized on top-level.
export default function IntegrationsSettingsRedirect(): never {
  redirect('/integrations');
}
