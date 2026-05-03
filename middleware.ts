// Next.js middleware — request-level auth backstop.
//
// History: prior to Phase 10, every API route called getCurrentContext()
// manually. Easy to forget — /api/integrations/[type] shipped without an
// auth check, exposing Slack/Notion tokens to anyone with the URL.
//
// This middleware blocks unauthenticated access to /api/* by default,
// using a small allowlist for routes that legitimately need to be public:
//
//   - /api/health         — uptime probe
//   - /api/devlog         — dev-only client error relay (NODE_ENV gate inside)
//   - /api/cron-tick      — Vercel Cron / TJ_CRON_TOKEN auth handled inside
//   - /api/cron/poll/*    — same
//   - /api/cron-status    — read-only status, no mutations
//
// Route-level handlers still call getCurrentContext() to get the user/
// brand context — middleware only does the binary "is there a session
// at all" gate so we fail fast on completely-anonymous traffic. This is
// belt-and-suspenders, not the only line of defense.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/devlog',
  '/api/cron-tick',
  '/api/cron/poll',
  '/api/cron-status',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /api/*. Page routes have their own redirect-to-signin
  // logic in (dashboard)/layout.tsx via requireUser().
  if (!pathname.startsWith('/api/')) return NextResponse.next();

  // Allowlist for cron / health / dev endpoints.
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return NextResponse.next();
    }
  }

  // Iron-session sets the cookie name `tj_session` (see lib/auth/session.ts).
  // We don't decrypt here — that requires server-side helpers iron-session
  // doesn't expose at the edge. Presence is sufficient as a fast gate; the
  // route handler still verifies + reads the session contents.
  const cookie = req.cookies.get('tj_session');
  if (!cookie || !cookie.value) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
