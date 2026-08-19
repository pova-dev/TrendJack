import { NextRequest, NextResponse } from 'next/server';

// Dev-only client-error sink. The layout's window-error listener POSTs here
// so I can read browser errors via `tail -f /tmp/trendjack-dev.log` instead
// of needing a working DevTools connection.
//
// SECURITY (Audit 2026-05-29 S4): belt-and-suspenders. If NODE_ENV is
// accidentally mis-set in a deploy, also require TJ_DEVLOG_TOKEN.

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ ok: false }, { status: 403 });
  const expected = process.env.TJ_DEVLOG_TOKEN;
  if (expected) {
    const got = req.headers.get('x-devlog-token') ?? req.nextUrl.searchParams.get('token');
    if (got !== expected) return NextResponse.json({ ok: false }, { status: 403 });
  }
  try {
    const body = await req.json();
    // Use stderr-style prefix so it stands out in the log.
    console.error('[CLIENT ERROR]', JSON.stringify(body));
  } catch {
    /* ignore malformed payloads */
  }
  return NextResponse.json({ ok: true });
}
