// Outline-stroke SVG icons for the left rail. Hand-tuned at 22px so they
// read crisply in the war-room density without dwarfing the rail.

import * as React from 'react';

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconBoards = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3"  y="4" width="5"  height="16" rx="1.2" />
    <rect x="10" y="4" width="5"  height="11" rx="1.2" />
    <rect x="17" y="4" width="4"  height="7"  rx="1.2" />
  </svg>
);

export const IconQueue = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7h11" />
    <path d="M4 12h7" />
    <path d="M4 17h11" />
    <path d="m17 11 2 2 4-4" />
  </svg>
);

export const IconBrand = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 2.5l2.6 5.7 6.2.7-4.6 4.3 1.2 6.1L12 16.4l-5.4 2.9 1.2-6.1L3.2 8.9l6.2-.7L12 2.5z" />
  </svg>
);

export const IconConnectors = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M9 12a3 3 0 0 1 0-6h2" />
    <path d="M15 12a3 3 0 0 1 0 6h-2" />
    <path d="M9 9h6" />
    <path d="M9 15h6" />
  </svg>
);

export const IconScoring = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7h16" />
    <circle cx="9"  cy="7"  r="2" fill="currentColor" stroke="none" />
    <path d="M4 12h16" />
    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M4 17h16" />
    <circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconAlerts = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const IconIntegrations = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M16 3v4" /><path d="M8 17v4" />
    <path d="M3 8h4" /><path d="M17 16h4" />
    <rect x="13" y="3" width="6" height="6" rx="1.2" />
    <rect x="5"  y="13" width="6" height="6" rx="1.2" />
    <path d="m9 13 6-6" />
  </svg>
);

export const IconAudit = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" />
  </svg>
);

export const IconSettings = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const IconSparkle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3v3" /><path d="M12 18v3" />
    <path d="M3 12h3" /><path d="M18 12h3" />
    <path d="M5 5l2 2" /><path d="M17 17l2 2" />
    <path d="M5 19l2-2" /><path d="M17 7l2-2" />
  </svg>
);

export const IconLogout = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

// Social analytics — a rising trend line inside a frame, matching the
// outline language of the other rail icons rather than any platform logo.
export const IconSocial = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="m7 15 3.2-3.4 2.4 2.2L17 9" />
    <path d="M17 9h-2.6M17 9v2.6" />
  </svg>
);
