'use client';
import * as React from 'react';
import type { SocialPlatform } from '@/lib/social/types';

export function platformLabel(p: SocialPlatform): string {
  return p === 'instagram' ? 'Instagram' : p === 'facebook' ? 'Facebook' : 'YouTube';
}

/** Monochrome outline glyphs, matching the left-rail icon language rather
 *  than each platform's brand colour — a wall of red/blue/pink badges would
 *  fight the board's palette and add no information. */
export function PlatformGlyph({ platform }: { platform: SocialPlatform }) {
  const base = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.75,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  return (
    <span className="text-ink-300 shrink-0" title={platformLabel(platform)} aria-label={platformLabel(platform)}>
      {platform === 'instagram' && (
        <svg {...base}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      )}
      {platform === 'facebook' && (
        <svg {...base}>
          <path d="M14.5 8.5h2.2M14.5 8.5V7a2 2 0 0 1 2-2h1.2" />
          <path d="M14.5 8.5V21" />
          <path d="M10 12.5h6" />
          <rect x="3" y="3" width="18" height="18" rx="4" />
        </svg>
      )}
      {platform === 'youtube' && (
        <svg {...base}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
          <path d="m10.5 9.5 4.5 2.5-4.5 2.5z" />
        </svg>
      )}
    </span>
  );
}
