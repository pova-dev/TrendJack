import { redirect } from 'next/navigation';

// Audit 2026-05-29 U1 — duplicate of `/connectors`. Canonicalized on top-level.
export default function ConnectorsSettingsRedirect(): never {
  redirect('/connectors');
}
