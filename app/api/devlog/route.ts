import { NextRequest, NextResponse } from 'next/server';

// Dev-only client-error sink. The layout's window-error listener POSTs here
// so I can read browser errors via `tail -f /tmp/trendjack-dev.log` instead
// of needing a working DevTools connection.

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const body = await req.json();
    // Use stderr-style prefix so it stands out in the log.
    console.error('[CLIENT ERROR]', JSON.stringify(body));
  } catch {
    /* ignore malformed payloads */
  }
  return NextResponse.json({ ok: true });
}
