import * as React from 'react';
import Link from 'next/link';

interface Props { configured: boolean }

// Inline banner that nags users into setting up AI when they have no
// providers configured. Hides itself once any key is present.
export function AiSetupBanner({ configured }: Props) {
  if (configured) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-flare-500/30 bg-flare-500/5 text-xs">
      <span className="text-flare-400">✦</span>
      <p className="text-ink-100">
        AI features (research, co-pilot, draft generation) are off until you add a provider key.
      </p>
      <Link
        href="/settings/ai"
        className="ml-auto inline-flex items-center gap-1 rounded-md bg-flare-500 text-ink-950 px-2.5 py-1 text-2xs font-semibold hover:bg-flare-400"
      >
        Enable AI →
      </Link>
    </div>
  );
}
