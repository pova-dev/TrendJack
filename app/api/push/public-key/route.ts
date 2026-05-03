import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getVapidConfig } from '@/lib/push-vapid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/push/public-key — returns the VAPID public key the browser
// needs to call PushManager.subscribe({ applicationServerKey }).
//
// The public key is, by design, public — but we still gate this behind
// auth so anonymous traffic can't probe whether push is configured at
// all. (The middleware already 401's anonymous /api/* hits.)

export async function GET() {
  const auth = await getCurrentContext();
  if (!auth?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const cfg = getVapidConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  return NextResponse.json({ configured: true, publicKey: cfg.publicKey });
}
