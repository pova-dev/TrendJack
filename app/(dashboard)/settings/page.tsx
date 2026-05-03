import { redirect } from 'next/navigation';

// /settings → /settings/brand. Brand Profile is the most-edited section,
// so it's the default landing page when someone clicks the gear icon.
export default function SettingsIndex() {
  redirect('/settings/brand');
}
