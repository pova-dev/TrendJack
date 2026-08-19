import { redirect } from 'next/navigation';

// Audit 2026-05-29 U1 — `/settings/scoring` and `/scoring` were duplicate
// page trees rendering the same WeightTuner. Canonicalized on the top-level
// route (richer UX — includes TopBar with brand switcher).
export default function ScoringSettingsRedirect(): never {
  redirect('/scoring');
}
